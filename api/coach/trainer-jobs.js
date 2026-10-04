// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
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
import { expandBlocks, gatePlan, ctxFromPayload } from './protocol-gate.js';
import { invokeWithRetry, aiLog } from './ai-run.js';

export const TIMEOUT_MS = 5 * 60000;
const MAX_CONCURRENT = 2;

// Tests drive the trainer flow through the fixture provider; production always runs Claude.
let adapterOverride = null;
export function setAdapterForTests(adapter) { adapterOverride = adapter; }

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
  // Trainer/admin access to a member's plan is NOT consent to send that member's data to an external AI provider. The member's own
  // Coach consent (the one the consent screen records) is required here too; without it nothing leaves the server.
  if (!S.coach?.consent?.agreedAt) throw new TrainerAIError('consent', 'este socio no ha aceptado el uso de IA — no se envía nada al proveedor');

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
  // Consent can be withdrawn while the job waits in the queue: check again right before anything is built for the provider.
  if (!S.coach?.consent?.agreedAt) return setResult(job, { state: 'failed', errorClass: 'consent' });

  const adapter = adapterOverride || adapterFor('claude');
  const payload = payloadLib.build(S, job.memberId, { kind: 'create', intake: job.brief });
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-ai-'));
  const env = trainerAI.jobEnv(jobDir);
  try {
    const ids = (await import('./adapters/spawn.js')).unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);

    aiLog('AI_REQUEST_START', { flow: 'trainer-create', job: job.id, provider: 'claude' });
    let attempt = await invoke(adapter, payload, jobDir, env, null, job);
    if (!attempt.ok && attempt.repairable) {
      // One repair round, same rule as jobs.js's execute() (FR-48 there): a second failure is a
      // provider problem, not a prompting problem.
      aiLog('AI_REPAIR', { flow: 'trainer-create', job: job.id, errors: attempt.errors?.length || 0 });
      attempt = await invoke(adapter, payload, jobDir, env, { previous: attempt.raw, errors: attempt.errors }, job);
    }
    if (!attempt.ok) {
      aiLog('AI_FINAL_FAILURE', { flow: 'trainer-create', job: job.id, class: attempt.errorClass, ms: Date.now() - job.startedAt });
      return setResult(job, { state: 'failed', errorClass: attempt.errorClass });
    }
    aiLog('AI_SUCCESS', { flow: 'trainer-create', job: job.id, ms: Date.now() - job.startedAt });
    return setResult(job, { state: 'done', pending: { bundle: attempt.bundle, createdAt: Date.now() } });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}

async function invoke(adapter, payload, jobDir, env, repair, job = {}) {
  const prompt = buildPrompt('create', payload, repair);
  const r = await invokeWithRetry(adapter, { prompt, jobDir, env, model: null, timeoutMs: TIMEOUT_MS },
    { flow: 'trainer-create', job: job.id, provider: 'claude', repair: !!repair });
  if (r.failure) return { ok: false, errorClass: r.failure.errorClass === 'empty' ? 'provider' : r.failure.errorClass };

  const parsed = extractJSON(r.text);
  if (parsed.error) {
    aiLog('AI_PARSE_ERROR', { flow: 'trainer-create', job: job.id, chars: String(r.text || '').length });
    return { ok: false, repairable: !repair, errors: [parsed.error], raw: r.text, errorClass: 'unusable' };
  }
  if (!contractOK(parsed.value)) return { ok: false, repairable: !repair, errors: [`coach_contract must be ${payloadLib.CONTRACT}`], raw: r.text, errorClass: 'unusable' };

  const expanded = expandBlocks(parsed.value);
  let v = expanded.errors.length ? { ok: false, errors: expanded.errors }
    : validatePlan(expanded.data, { workingWeights: payload.history?.workingWeights, daysPerWeek: payload.coachProfile?.daysPerWeek });
  // Same 2J protocol gate as the member Coach: a FAIL goes to repair, never to the trainer.
  if (v.ok) { const g = gatePlan(v.bundle, ctxFromPayload(payload)); v = g.ok ? { ok: true, bundle: g.bundle } : { ok: false, errors: g.errors }; }
  if (!v.ok) return { ok: false, repairable: !repair, errors: v.errors, raw: r.text, errorClass: 'unusable' };
  return { ok: true, bundle: v.bundle };
}
