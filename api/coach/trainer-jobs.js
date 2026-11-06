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
 * Reuses jobs.js's prompt assembly (buildPrompt) and state reader (readState), and
 * ai-generate.js for generate → validate → protocol gate → repair — same output contract, same
 * exercise library, same safety rules baked into prompts/common.md and create.md. Only the
 * provider, credentials and trigger differ.
 *
 * Persistence: the job table lives in data/trainer-ai-jobs.json (atomic writes, 0600). A
 * generation can take minutes when the provider is struggling and the trainer may well have
 * moved on to another screen, so a container restart no longer throws it away: a queued/running
 * job is started again once from its saved request, and a finished draft waits for the trainer
 * for up to a day. The request (the brief) is dropped from the file as soon as the job ends.
 * Cancelling (discard) stops the retries at the next opportunity.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as trainerAI from './trainer-ai.js';
import { adapterFor } from './adapters/index.js';
import * as payloadLib from './payload.js';
import { buildPrompt, readState } from './jobs.js';
import { generateWithRepair } from './ai-generate.js';
import { aiLog, POLICIES, makeBudget } from './ai-run.js';
import * as metrics from '../lib/ai-metrics.js';

export const TIMEOUT_MS = POLICIES.trainer_routine.callTimeoutMs;
const MAX_CONCURRENT = 2;
const KEEP_RESULT_MS = 24 * 3600000;

const DATA = () => process.env.DATA_DIR || '/data';
const FILE = () => path.join(DATA(), 'trainer-ai-jobs.json');

// Tests drive the trainer flow through the fixture provider; production always runs Claude.
let adapterOverride = null;
export function setAdapterForTests(adapter) { adapterOverride = adapter; }

export class TrainerAIError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

const keyOf = (trainerId, memberId) => trainerId + ':' + memberId;
// key -> { id, trainerId, memberId, state:'queued'|'running'|'done'|'failed', phase, startedAt, endedAt, pending, errorClass, brief, resumes }
const jobsByKey = new Map();
const queue = [];
let running = 0;
const inflight = new Set();
const controllers = new Map();       // job id -> AbortController, in memory only

/* ---------- the job file ---------- */

function persist() {
  try {
    const rows = [...jobsByKey.values()].map(r => ({ ...r }));
    const file = FILE(), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, jobs: rows }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch (e) { console.error('trainer-ai jobs: could not save', e?.message); }
}

function put(rec) { jobsByKey.set(keyOf(rec.trainerId, rec.memberId), rec); persist(); return rec; }
function patch(job, fields) {
  const key = keyOf(job.trainerId, job.memberId);
  const rec = jobsByKey.get(key);
  if (!rec || rec.id !== job.id) return null;       // discarded or replaced: do not resurrect it
  Object.assign(rec, fields); persist();
  return rec;
}

/** What the client polls. */
export function status(trainerId, memberId) {
  const rec = jobsByKey.get(keyOf(trainerId, memberId));
  if (!rec) return { job: null, pending: null, errorClass: null };
  if (rec.endedAt && Date.now() - rec.endedAt > KEEP_RESULT_MS) { jobsByKey.delete(keyOf(trainerId, memberId)); persist(); return { job: null, pending: null, errorClass: null }; }
  return {
    job: rec.state === 'queued' || rec.state === 'running' ? { id: rec.id, state: rec.state, phase: rec.phase || rec.state, startedAt: rec.startedAt } : null,
    pending: rec.pending || null,
    errorClass: rec.state === 'failed' ? rec.errorClass : null
  };
}

/** The trainer discarded the draft, or is about to ask for a fresh one. Running work stops. */
export function discard(trainerId, memberId) {
  const key = keyOf(trainerId, memberId);
  const rec = jobsByKey.get(key);
  if (rec) controllers.get(rec.id)?.abort();
  jobsByKey.delete(key);
  const at = queue.findIndex(j => j.trainerId === trainerId && j.memberId === memberId);
  if (at >= 0) { queue.splice(at, 1); inflight.delete(key); }
  persist();
  return { ok: true };
}

/** An erased member leaves no draft behind. */
export function forgetMember(memberId) {
  for (const [key, rec] of [...jobsByKey]) if (rec.memberId === memberId) { controllers.get(rec.id)?.abort(); jobsByKey.delete(key); }
  for (let i = queue.length - 1; i >= 0; i--) if (queue[i].memberId === memberId) queue.splice(i, 1);
  persist();
}

export function enqueue(trainerId, memberId, brief) {
  if (!trainerAI.isEnabled() || !trainerAI.isConnected()) throw new TrainerAIError('off', 'la IA del panel de entrenador no está configurada');
  const key = keyOf(trainerId, memberId);
  if (inflight.has(key)) throw new TrainerAIError('busy', 'ya se está generando una rutina para este socio');
  const caps = trainerAI.load().caps || {};
  if (caps.instanceDaily > 0 && trainerAI.jobsToday() >= caps.instanceDaily) throw new TrainerAIError('cap', 'se ha alcanzado el límite diario de generaciones con IA');

  const S = readState(memberId);
  if (!S) throw new TrainerAIError('nostate', 'este socio nunca ha sincronizado — todavía no hay nada sobre lo que generar');
  const job = { id: crypto.randomBytes(8).toString('hex'), trainerId, memberId, brief, startedAt: Date.now(), resumes: 0 };
  inflight.add(key);
  put({ id: job.id, trainerId, memberId, state: 'queued', phase: 'queued', startedAt: job.startedAt, endedAt: 0, pending: null, errorClass: null, brief, resumes: 0 });
  queue.push(job);
  pump();
  return { id: job.id };
}

/**
 * Server start: a job that was queued or running is started again ONCE from its saved request; a
 * second interruption (or a job whose request is gone) ends as 'restart'. Old results are dropped.
 */
export function recoverOnBoot() {
  let rows = [];
  try { rows = JSON.parse(fs.readFileSync(FILE(), 'utf8')).jobs || []; } catch { return 0; }
  let resumed = 0;
  for (const rec of rows) {
    if (!rec?.id || !rec.trainerId || !rec.memberId) continue;
    const key = keyOf(rec.trainerId, rec.memberId);
    if (rec.endedAt && Date.now() - rec.endedAt > KEEP_RESULT_MS) continue;
    if (rec.state === 'queued' || rec.state === 'running') {
      if (rec.brief && !(rec.resumes >= 1) && trainerAI.isEnabled() && trainerAI.isConnected()) {
        jobsByKey.set(key, { ...rec, state: 'queued', phase: 'queued', resumes: 1 });
        inflight.add(key);
        queue.push({ id: rec.id, trainerId: rec.trainerId, memberId: rec.memberId, brief: rec.brief, startedAt: rec.startedAt, resumes: 1 });
        resumed++;
        continue;
      }
      jobsByKey.set(key, { ...rec, state: 'failed', phase: null, errorClass: 'restart', endedAt: Date.now(), brief: null });
      continue;
    }
    jobsByKey.set(key, rec);
  }
  persist();
  if (resumed) { console.log(`trainer-ai: restarted ${resumed} interrupted job(s)`); pump(); }
  return resumed;
}

function pump() {
  while (running < MAX_CONCURRENT && queue.length) {
    const job = queue.shift();
    running++;
    execute(job)
      .catch(e => { console.error('trainer-ai job crashed', job.id, e); setResult(job, { state: 'failed', errorClass: 'internal' }); })
      .finally(() => { running--; controllers.delete(job.id); inflight.delete(keyOf(job.trainerId, job.memberId)); pump(); });
  }
}

function setResult(job, fields) {
  const rec = patch(job, { ...fields, phase: null, endedAt: Date.now(), brief: null });
  if (!rec) return;      // the trainer discarded it meanwhile
  trainerAI.logJob({
    at: new Date().toISOString(), memberHandle: job.memberId.slice(0, 6),
    outcome: fields.state === 'done' ? 'ready' : 'failed', errorClass: fields.errorClass || null,
    ms: Date.now() - job.startedAt
  });
}

async function execute(job) {
  const controller = new AbortController();
  controllers.set(job.id, controller);
  if (!patch(job, { state: 'running', phase: 'generating' })) return;      // discarded while queued

  const S = readState(job.memberId);
  if (!S) return setResult(job, { state: 'failed', errorClass: 'nostate' });
  const adapter = adapterOverride || adapterFor('claude');
  const payload = payloadLib.buildTrainer(S, job.memberId, job.brief);
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-ai-'));
  const env = trainerAI.jobEnv(jobDir);
  const policy = POLICIES.trainer_routine;
  const track = metrics.begin('trainer_routine');
  const cfg = trainerAI.load();
  const fb = cfg.fallbackModel && cfg.fallbackModel !== cfg.model ? [{ id: 'claude:' + cfg.fallbackModel, args: { model: cfg.fallbackModel } }] : [];
  try {
    const ids = (await import('./adapters/spawn.js')).unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);

    aiLog('AI_REQUEST_START', { flow: 'trainer-create', job: job.id, provider: 'claude' });
    const attempt = await generateWithRepair({
      flow: 'trainer-create', job: job.id, provider: 'claude', adapter, kind: 'create', payload, buildPrompt,
      args: { jobDir, env, model: cfg.model || null, timeoutMs: TIMEOUT_MS },
      policy, budget: makeBudget(policy, controller.signal), track, fallbacks: fb,
      onPhase: p => patch(job, { phase: p })
    });
    if (controller.signal.aborted) { track.finish(false); return; }       // discarded: nothing to report
    if (!attempt.ok) {
      track.finish(false);
      aiLog('AI_FINAL_FAILURE', {
        flow: 'trainer-create', job: job.id, class: attempt.errorClass, attempts: attempt.attempts,
        timeouts: attempt.timeoutCount, fallback: attempt.usedFallback ? 1 : 0, timeoutMs: TIMEOUT_MS,
        cause: attempt.errorClass === 'timeout' ? 'provider_call_deadline_exceeded' : undefined,
        ms: Date.now() - job.startedAt
      });
      return setResult(job, { state: 'failed', errorClass: attempt.errorClass });
    }
    track.finish(true);
    aiLog('AI_SUCCESS', { flow: 'trainer-create', job: job.id, ms: Date.now() - job.startedAt });
    return setResult(job, { state: 'done', pending: { bundle: attempt.bundle, createdAt: Date.now() } });
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
