/* Running "generate a routine with AI" jobs from the trainer desktop panel.
 *
 * A sibling to ./jobs.js, not a branch of it: that file runs a member's own consent-gated
 * request through whichever provider the instance owner picked for the member-facing Coach.
 * This one always runs Claude, is triggered by a trainer building for a specific member, and
 * the member's own consent flag plays no role — the trainer already has direct read/write
 * access to that member's routines/programs (see server.js's member-routine/member-program),
 * same trusted-role pattern, just drafted by a model first instead of typed by hand.
 *
 * Reuses jobs.js's prompt assembly (buildPrompt) and state reader (readState) rather than
 * duplicating them, and validate.js's validatePlan — same output contract, same exercise
 * library, same safety rules baked into prompts/common.md and create.md. Only the provider,
 * credentials and trigger differ. Kept in-memory (no on-disk job record): a generation is
 * seconds-to-minutes and the trainer is looking at the screen, so a restart mid-job is fine to
 * just show as "try again" rather than something worth persisting across a container restart.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as trainerAI from './trainer-ai.js';
import { adapterFor } from './adapters/index.js';
import * as payloadLib from './payload.js';
import { buildPrompt, readState } from './jobs.js';
import { extractJSON, validatePlan, contractOK } from './validate.js';

export const TIMEOUT_MS = 5 * 60000;
const MAX_CONCURRENT = 2;

export class TrainerAIError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const keyOf = (trainerId, memberId) => trainerId + ':' + memberId;
const jobsByKey = new Map();   // key -> { id, state:'queued'|'running'|'done'|'failed', startedAt, pending, errorClass }
const queue = [];
let running = 0;
const inflight = new Set();

/** What the client polls. */
export function status(trainerId, memberId) {
  const rec = jobsByKey.get(keyOf(trainerId, memberId));
  if (!rec) return { job: null, pending: null, errorClass: null };
  return {
    job: rec.state === 'queued' || rec.state === 'running' ? { id: rec.id, state: rec.state, startedAt: rec.startedAt } : null,
    pending: rec.pending || null,
    errorClass: rec.state === 'failed' ? rec.errorClass : null
  };
}

/** The trainer discarded the draft, or is about to ask for a fresh one. */
export function discard(trainerId, memberId) {
  jobsByKey.delete(keyOf(trainerId, memberId));
  return { ok: true };
}

export function enqueue(trainerId, memberId, brief) {
  if (!trainerAI.isEnabled() || !trainerAI.isConnected()) throw new TrainerAIError('off', 'la IA del panel de entrenador no está configurada');
  const key = keyOf(trainerId, memberId);
  if (inflight.has(key)) throw new TrainerAIError('busy', 'ya se está generando una rutina para este socio');
  const caps = trainerAI.load().caps || {};
  if (caps.instanceDaily > 0 && trainerAI.jobsToday() >= caps.instanceDaily) throw new TrainerAIError('cap', 'se ha alcanzado el límite diario de generaciones con IA');

  const S = readState(memberId);
  if (!S) throw new TrainerAIError('nostate', 'este socio nunca ha sincronizado — todavía no hay nada sobre lo que generar');

  const job = { id: crypto.randomBytes(8).toString('hex'), trainerId, memberId, brief, startedAt: Date.now() };
  inflight.add(key);
  jobsByKey.set(key, { id: job.id, state: 'queued', startedAt: job.startedAt, pending: null, errorClass: null });
  queue.push(job);
  pump();
  return { id: job.id };
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    execute(job)
      .catch(e => { console.error('trainer-ai job crashed', job.id, e); setResult(job, { state: 'failed', errorClass: 'internal' }); })
      .finally(() => { running--; inflight.delete(keyOf(job.trainerId, job.memberId)); pump(); });
  }
}

function setResult(job, patch) {
  jobsByKey.set(keyOf(job.trainerId, job.memberId), { id: job.id, startedAt: job.startedAt, pending: null, errorClass: null, ...patch });
  trainerAI.logJob({
    at: new Date().toISOString(), memberHandle: job.memberId.slice(0, 6),
    outcome: patch.state === 'done' ? 'ready' : 'failed', errorClass: patch.errorClass || null,
    ms: Date.now() - job.startedAt
  });
}

async function execute(job) {
  jobsByKey.set(keyOf(job.trainerId, job.memberId), { id: job.id, state: 'running', startedAt: job.startedAt, pending: null, errorClass: null });

  const S = readState(job.memberId);
  if (!S) return setResult(job, { state: 'failed', errorClass: 'nostate' });

  const adapter = adapterFor('claude');
  const payload = payloadLib.build(S, job.memberId, { kind: 'create', intake: job.brief });
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-ai-'));
  const env = trainerAI.jobEnv(jobDir);
  try {
    const ids = (await import('./adapters/spawn.js')).unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);

    let attempt = await invoke(adapter, payload, jobDir, env, null);
    if (!attempt.ok && attempt.repairable) {
      // One repair round, same rule as jobs.js's execute() (FR-48 there): a second failure is a
      // provider problem, not a prompting problem.
      attempt = await invoke(adapter, payload, jobDir, env, { previous: attempt.raw, errors: attempt.errors });
    }
    if (!attempt.ok) return setResult(job, { state: 'failed', errorClass: attempt.errorClass });
    return setResult(job, { state: 'done', pending: { bundle: attempt.bundle, createdAt: Date.now() } });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

async function invoke(adapter, payload, jobDir, env, repair) {
  const prompt = buildPrompt('create', payload, repair);
  const r = await adapter.invoke({ prompt, jobDir, env, model: null, timeoutMs: TIMEOUT_MS });

  if (r.timedOut) return { ok: false, errorClass: 'timeout' };
  if (r.spawnError) return { ok: false, errorClass: 'missing' };
  if (r.code !== 0) {
    const err = (r.stderr || r.text || '').toLowerCase();
    const authish = /auth|unauthor|api key|credential|token|401|403|login/.test(err);
    return { ok: false, errorClass: authish ? 'auth' : 'provider' };
  }

  const parsed = extractJSON(r.text);
  if (parsed.error) return { ok: false, repairable: !repair, errors: [parsed.error], raw: r.text, errorClass: 'unusable' };
  if (!contractOK(parsed.value)) return { ok: false, repairable: !repair, errors: [`coach_contract must be ${payloadLib.CONTRACT}`], raw: r.text, errorClass: 'unusable' };

  const v = validatePlan(parsed.value, { workingWeights: payload.history?.workingWeights, daysPerWeek: payload.coachProfile?.daysPerWeek });
  if (!v.ok) return { ok: false, repairable: !repair, errors: v.errors, raw: r.text, errorClass: 'unusable' };
  return { ok: true, bundle: v.bundle };
}
