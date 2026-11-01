// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The one place that calls an AI provider on behalf of 2J. Shared by the member Coach (jobs.js),
 * the trainer panel (trainer-jobs.js) and the vision scans (lib/ai-vision.js), so every flow
 * classifies, retries, falls back and gives up in exactly the same way.
 *
 * A call goes: provider → classify the failure → (transient?) wait with exponential backoff and
 * jitter → try again → (still failing, and a fallback is configured?) next candidate → give up.
 * Every step is bounded by a BUDGET shared by the whole user-visible request: a maximum number of
 * provider calls and a maximum wall-clock time. Whatever happens, the loop ends.
 *
 * Retried: a timeout, a crashed/aborted runtime, HTTP 408/429/5xx, "overloaded", a dropped
 * connection, an empty answer. Never retried on the same candidate: credentials, a missing
 * runtime, an invalid request — those need the owner, not another paid call (a configured
 * fallback is still tried for credential/runtime/model problems, since it may use another
 * account or model). The protocol repair round (in the callers) is separate: it happens only
 * after a usable answer that fails validation, and it spends from the same budget.
 *
 * Logs never carry the prompt, the answer, credentials or member data: only ids, the provider,
 * the attempt number, timings and a short error class/status.
 */

/* ---------- policies ---------- */

/** Defaults kept for callers that pass no policy: three calls, a short wait between them. */
export const MAX_ATTEMPTS = 3;
const DEFAULT_POLICY = { maxAttempts: 3, maxCalls: 3, maxMs: Infinity, backoffMs: [1500, 4000], maxTimeouts: 2, jitter: 0.25, minCallMs: 0 };

/**
 * Budgets per flow. `maxAttempts` bounds the calls on ONE candidate (primary or fallback);
 * `maxCalls` bounds the whole request including repair rounds and fallbacks; `maxMs` bounds the
 * wall clock. Typical requests use ONE call: these are ceilings for the worst day, not targets.
 */
export const POLICIES = {
  // routine creation for a member: 1 call normally; ≤8 calls only when the provider is struggling
  member_routine: { maxAttempts: 4, maxCalls: 8, maxMs: 9 * 60000, backoffMs: [1500, 3000, 6000, 12000], maxTimeouts: 2, jitter: 0.25, minCallMs: 20000 },
  // the trainer can wait a little longer
  trainer_routine: { maxAttempts: 5, maxCalls: 8, maxMs: 12 * 60000, backoffMs: [1500, 3000, 6000, 12000, 20000], maxTimeouts: 2, jitter: 0.25, minCallMs: 20000 },
  coach_review: { maxAttempts: 4, maxCalls: 6, maxMs: 8 * 60000, backoffMs: [1500, 3000, 6000, 12000], maxTimeouts: 2, jitter: 0.25, minCallMs: 20000 },
  // vision reads: short calls, so many fast tries, but never ten reads of one photo
  scan: { maxAttempts: 4, maxCalls: 6, maxMs: 100000, backoffMs: [1500, 3000, 6000, 10000], maxTimeouts: 2, jitter: 0.25, minCallMs: 8000, callTimeoutMs: 40000 },
  // the synchronous endpoints that older app versions still call must answer inside nginx's 60 s
  scan_sync: { maxAttempts: 3, maxCalls: 4, maxMs: 48000, backoffMs: [1000, 2500, 5000], maxTimeouts: 1, jitter: 0.25, minCallMs: 8000, callTimeoutMs: 25000 }
};

let BACKOFF_OVERRIDE = null;
/** Tests shorten the waits (no jitter either); production never calls this. */
export function setBackoffForTests(ms) { BACKOFF_OVERRIDE = Array.isArray(ms) ? ms : null; }
const abortableSleep = (ms, signal) => new Promise(resolve => {
  if (!ms || ms <= 0) return resolve();
  const timer = setTimeout(done, ms);
  function done() { clearTimeout(timer); signal?.removeEventListener?.('abort', done); resolve(); }
  signal?.addEventListener?.('abort', done, { once: true });
});

/** exponential backoff table + ±jitter; `retryAfterMs` from the provider is honoured (capped). */
export function backoffDelay(policy, retryNumber, retryAfterMs = 0, rand = Math.random) {
  if (BACKOFF_OVERRIDE) return BACKOFF_OVERRIDE[Math.min(retryNumber - 1, BACKOFF_OVERRIDE.length - 1)] || 0;
  const table = policy.backoffMs || DEFAULT_POLICY.backoffMs;
  const base = table[Math.min(retryNumber - 1, table.length - 1)] || 0;
  const jitter = policy.jitter ?? 0.25;
  const jittered = Math.round(base * (1 - jitter + rand() * 2 * jitter));
  return Math.max(jittered, Math.min(15000, Number(retryAfterMs) || 0));
}

/** The shared allowance of one user-visible request. Pass the same object to every step of it. */
export function makeBudget(policy = DEFAULT_POLICY, signal = null, now = Date.now()) {
  return { policy, signal, startedAt: now, deadline: policy.maxMs === Infinity ? Infinity : now + policy.maxMs, calls: 0 };
}
export const budgetLeft = b => ({ calls: Math.max(0, b.policy.maxCalls - b.calls), ms: b.deadline === Infinity ? Infinity : Math.max(0, b.deadline - Date.now()) });
export const budgetCancelled = b => !!b.signal?.aborted;
export const budgetExhausted = b => b.calls >= b.policy.maxCalls || Date.now() >= b.deadline;

/* ---------- classification ---------- */

// "token" alone is not auth: max_tokens, tokens exceeded… Only real credential failures count.
const AUTH_RE = /\b(401|403)\b|unauthori[sz]ed|authentication|(invalid|incorrect)[ _-]?(api[ _-]?key|x-api-key|token)|oauth|credential|not logged in|please (run )?.*login|permission[ _-]denied|billing|org(anization)? not allowed/i;
const TRANSIENT_RE = /\b(408|429|500|502|503|504|529)\b|overloaded|rate[ _-]?limit|too many requests|server[ _-]error|internal server error|bad gateway|service unavailable|gateway time-?out|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|network|process exited with code|terminated by signal|stream (closed|ended)|premature close|returned no result|empty response|no content|high demand|try again later|resource.?exhausted/i;
const MISSING_RE = /ENOENT|failed to spawn|not installed|no such file|native binary|cannot find module/i;

/**
 * Classify one adapter result ({ code, text, stderr, timedOut, spawnError, status? }).
 * @returns {{ ok: true } | { ok: false, errorClass: 'timeout'|'provider'|'auth'|'missing'|'empty', transient: boolean, status?: number }}
 */
export function classify(r) {
  if (!r) return { ok: false, errorClass: 'provider', transient: true };
  if (r.timedOut) return { ok: false, errorClass: 'timeout', transient: true };
  const err = String(r.stderr || '') + ' ' + (r.code !== 0 ? String(r.text || '') : '');
  // A status read from the text must look like an HTTP status, not a port (":443") or an address.
  const status = Number(r.status ?? r.providerStatus) || Number((err.match(/(?<![:.\d])\b(400|401|403|404|408|409|413|422|429|500|502|503|504|529)\b(?![.:]?\d)/) || [])[1]) || undefined;
  if (r.spawnError) {
    if (AUTH_RE.test(err)) return { ok: false, errorClass: 'auth', transient: false, status };
    return MISSING_RE.test(err) || !TRANSIENT_RE.test(err)
      ? { ok: false, errorClass: 'missing', transient: false, status }
      : { ok: false, errorClass: 'provider', transient: true, status };
  }
  if (r.code !== 0) {
    if (status === 408 || status === 429 || (status >= 500 && status <= 599)) return { ok: false, errorClass: 'provider', transient: true, status };
    if (status === 401 || status === 403) return { ok: false, errorClass: 'auth', transient: false, status };
    if (AUTH_RE.test(err)) return { ok: false, errorClass: 'auth', transient: false, status };
    if (status && status >= 400 && status < 500) return { ok: false, errorClass: 'provider', transient: false, status };
    if (r.networkError) return { ok: false, errorClass: 'provider', transient: true, status };
    return { ok: false, errorClass: 'provider', transient: TRANSIENT_RE.test(err), status };
  }
  if (!String(r.text || '').trim()) return { ok: false, errorClass: 'empty', transient: true };
  return { ok: true };
}

/** A failure another candidate (other account/model) could still fix. */
const fallbackable = c => c.transient || c.errorClass === 'auth' || c.errorClass === 'missing' || c.status === 404;

/** One compact line per event; `fields` must never include prompts, answers or secrets. */
export function aiLog(event, fields = {}) {
  const parts = Object.entries(fields).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_').slice(0, 80)}`);
  console.log(['[coach]', event, ...parts].join(' '));
}

/* ---------- the loop ---------- */

/**
 * Call the adapter with the full reliability policy.
 *
 * @param adapter  { invoke(args) } — the primary provider adapter.
 * @param args     what adapter.invoke() takes (prompt, jobDir, env, model, timeoutMs, image…).
 * @param ctx      { flow, job, provider, repair,
 *                   budget      — a makeBudget() shared with the rest of the request,
 *                   track       — ai-metrics.begin() tracker,
 *                   onPhase     — (phase: 'retrying'|'fallback') => void, for the job status,
 *                   fallbacks   — [{ id, adapter?, args? }]: tried in order once the previous
 *                                 candidate is exhausted. `args` overrides e.g. the model. }
 * @param policy   one of POLICIES (default: 3 calls).
 * @returns the last adapter result plus `attempts` (calls spent here), `usedFallback`, and — when
 *          nothing usable came back — `failure` (classify() result, with `budget`/`cancelled`).
 */
export async function invokeWithRetry(adapter, args, ctx = {}, policy = DEFAULT_POLICY) {
  const budget = ctx.budget || makeBudget(policy, ctx.signal);
  const candidates = [{ id: ctx.provider || adapter?.id, adapter, args: {} }, ...(ctx.fallbacks || []).map(f => ({ id: f.id, adapter: f.adapter || adapter, args: f.args || {} }))];
  let last = null, failure = null, spent = 0, usedFallback = false;

  outer: for (let ci = 0; ci < candidates.length; ci++) {
    const cand = candidates[ci];
    let timeouts = 0;
    if (ci > 0) { usedFallback = true; ctx.track?.usedFallback(); ctx.onPhase?.('fallback'); aiLog('AI_FALLBACK', { flow: ctx.flow, job: ctx.job, from: candidates[ci - 1].id, to: cand.id }); }
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      if (budgetCancelled(budget)) { failure = { ok: false, errorClass: 'cancelled', transient: false, cancelled: true }; ctx.track?.cancelled(); break outer; }
      if (budgetExhausted(budget)) { failure = { ...(failure || { ok: false, errorClass: 'provider', transient: true }), budget: true }; break outer; }
      const t0 = Date.now();
      budget.calls++; spent++;
      aiLog('AI_ATTEMPT', { flow: ctx.flow, job: ctx.job, provider: cand.id, attempt, call: budget.calls, repair: ctx.repair ? 1 : null });
      try { last = await cand.adapter.invoke({ ...args, ...cand.args }); }
      catch (e) { last = { code: -1, text: '', stderr: e?.message || String(e), timedOut: false, spawnError: false }; }
      const c = classify(last);
      ctx.track?.call(c.ok ? null : c);
      if (c.ok) return { ...last, attempts: spent, usedFallback, ms: Date.now() - t0 };
      failure = c;
      aiLog(c.errorClass === 'timeout' ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR', {
        flow: ctx.flow, job: ctx.job, provider: cand.id, attempt, class: c.errorClass, status: c.status,
        transient: c.transient ? 1 : 0, ms: Date.now() - t0
      });
      if (!c.transient) break;                                   // the same candidate cannot fix it
      if (c.errorClass === 'timeout' && ++timeouts >= (policy.maxTimeouts ?? 2)) break;   // a timeout already cost a whole window
      if (attempt === policy.maxAttempts) break;
      const wait = backoffDelay(policy, attempt, last?.retryAfterMs);
      // Not enough time left for a wait plus a worthwhile call: stop instead of starting one that cannot finish.
      if (Date.now() + wait + (policy.minCallMs || 0) >= budget.deadline) { failure = { ...failure, budget: true }; break outer; }
      ctx.track?.retried(); ctx.onPhase?.('retrying');
      await abortableSleep(wait, budget.signal);
    }
    if (!fallbackable(failure)) break;                           // a permanent request error: no other candidate will like it more
  }
  return { ...last, failure, attempts: spent, usedFallback };
}
