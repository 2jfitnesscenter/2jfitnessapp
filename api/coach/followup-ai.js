// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* "Analizar seguimiento" — the professional assistant. A sibling of trainer-jobs.js (same Claude credential and daily cap as the trainer panel's AI, no new
 * provider, no new secret) but with a different input and output: it receives ONLY the compact facts built by lib/coach-followup.js (aiFacts) — never raw state,
 * names, ids or notes — and returns a short, tagged analysis (fact / inference / suggestion) that the trainer reads. It cannot apply anything: the answer is
 * validated to a fixed shape and is refused if it carries medical wording or anything that looks like an applicable change. When the AI is off, busy or
 * returns something unusable, the caller keeps the deterministic analysis, so the screen is never empty.
 *
 * Cost: one provider call per (trainer, member, facts); an identical fact set within CACHE_MS is served from memory (the answer depends on nothing else).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import * as trainerAI from './trainer-ai.js';
import { adapterFor } from './adapters/index.js';
import { invokeWithRetry, aiLog } from './ai-run.js';
import { extractJSON } from './validate.js';
import { validateAiAnswer, AI_PAYLOAD_MAX } from '../lib/coach-followup.js';

export const TIMEOUT_MS = 90000;
export const CACHE_MS = 30 * 60000;
const PROMPT = fs.readFileSync(new URL('./prompts/followup.md', import.meta.url), 'utf8');

let adapterOverride = null;
export function setAdapterForTests(adapter) { adapterOverride = adapter; }

export class FollowUpAIError extends Error { constructor(code, message) { super(message); this.code = code; } }

const keyOf = (trainerId, memberId) => trainerId + ':' + memberId;
const records = new Map();    // key -> { id, state:'running'|'done'|'failed', startedAt, hash, result, errorClass }
const inflight = new Set();
let lastCleanup = 0;

export const available = () => trainerAI.isEnabled() && trainerAI.isConnected();
export const factsHash = facts => crypto.createHash('sha256').update(JSON.stringify(facts)).digest('hex').slice(0, 16);

export function status(trainerId, memberId) {
  const rec = records.get(keyOf(trainerId, memberId));
  if (!rec) return { job: null, result: null, errorClass: null };
  return {
    job: rec.state === 'running' ? { id: rec.id, state: 'running', startedAt: rec.startedAt } : null,
    result: rec.state === 'done' ? { ...rec.result, cached: !!rec.cached, at: rec.finishedAt } : null,
    errorClass: rec.state === 'failed' ? rec.errorClass : null,
  };
}
export function discard(trainerId, memberId) { records.delete(keyOf(trainerId, memberId)); return { ok: true }; }

/** Starts (or reuses) an analysis. Throws FollowUpAIError('off'|'busy'|'cap'|'size'). Returns { id, cached }. */
export function enqueue(trainerId, memberId, facts, lang = 'es') {
  if (!available()) throw new FollowUpAIError('off', 'la IA profesional no está configurada');
  if (JSON.stringify(facts).length > AI_PAYLOAD_MAX) throw new FollowUpAIError('size', 'los datos superan el límite de la IA');
  const key = keyOf(trainerId, memberId);
  if (inflight.has(key)) throw new FollowUpAIError('busy', 'ya se está analizando este socio');
  const hash = factsHash({ facts, lang });
  const prev = records.get(key);
  if (prev && prev.state === 'done' && prev.hash === hash && Date.now() - prev.finishedAt < CACHE_MS) { prev.cached = true; return { id: prev.id, cached: true }; }
  const caps = trainerAI.load().caps || {};
  if (caps.instanceDaily > 0 && trainerAI.jobsToday() >= caps.instanceDaily) throw new FollowUpAIError('cap', 'se ha alcanzado el límite diario de la IA');
  const id = crypto.randomBytes(8).toString('hex');
  inflight.add(key);
  records.set(key, { id, state: 'running', startedAt: Date.now(), hash });
  if (Date.now() - lastCleanup > 600000) { lastCleanup = Date.now(); for (const [k, r] of records) if (Date.now() - (r.finishedAt || r.startedAt) > 6 * 3600000) records.delete(k); }
  run({ id, key, trainerId, memberId, facts, lang, hash }).finally(() => inflight.delete(key));
  return { id, cached: false };
}

async function run(job) {
  const t0 = Date.now();
  const set = patch => records.set(job.key, { id: job.id, startedAt: t0, hash: job.hash, ...patch });
  const fail = errorClass => { set({ state: 'failed', errorClass, finishedAt: Date.now() }); trainerAI.logJob({ at: new Date().toISOString(), flow: 'followup', memberHandle: job.memberId.slice(0, 6), outcome: 'failed', errorClass, ms: Date.now() - t0 }); };
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-ai-'));
  try {
    const adapter = adapterOverride || adapterFor('claude');
    const ids = (await import('./adapters/spawn.js')).unprivilegedIds();
    if (ids) fs.chownSync(jobDir, ids.uid, ids.gid);
    const prompt = PROMPT + '\n\nlang: ' + (job.lang === 'en' ? 'en' : 'es') + '\n\nFACTS (JSON):\n' + JSON.stringify(job.facts);
    aiLog('AI_REQUEST_START', { flow: 'followup', job: job.id, provider: 'claude', chars: prompt.length });
    const r = await invokeWithRetry(adapter, { prompt, jobDir, env: trainerAI.jobEnv(jobDir), model: null, timeoutMs: TIMEOUT_MS }, { flow: 'followup', job: job.id, provider: 'claude' });
    if (r.failure) return fail(r.failure.errorClass === 'empty' ? 'provider' : r.failure.errorClass);
    const parsed = extractJSON(r.text);
    if (parsed.error) return fail('unusable');
    const v = validateAiAnswer(parsed.value);
    if (!v.ok) { aiLog('AI_UNUSABLE', { flow: 'followup', job: job.id, why: v.error }); return fail('unusable'); }
    set({ state: 'done', result: v.value, finishedAt: Date.now() });
    trainerAI.logJob({ at: new Date().toISOString(), flow: 'followup', memberHandle: job.memberId.slice(0, 6), outcome: 'ready', errorClass: null, ms: Date.now() - t0 });
    aiLog('AI_SUCCESS', { flow: 'followup', job: job.id, ms: Date.now() - t0 });
  } catch (e) {
    console.error('followup-ai crashed', job.id, e?.message);
    fail('internal');
  } finally {
    fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
