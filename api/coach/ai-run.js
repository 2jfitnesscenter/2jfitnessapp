// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* One provider call with an honest failure class, a short retry for transient failures, and a
 * compact log line per step. Shared by the member Coach (jobs.js) and the trainer panel
 * (trainer-jobs.js), so both classify and retry the same way.
 *
 * Retry policy: at most MAX_ATTEMPTS calls in total, only for failures that a second call can
 * fix — a timeout, a crashed/aborted runtime, HTTP 429/5xx, "overloaded", a dropped connection,
 * an empty answer. Never for auth/config, a missing runtime or an invalid request: those need
 * the owner, not another paid call. The protocol repair round (one, in the callers) is separate
 * and happens only after a usable answer that fails validation.
 *
 * Logs never carry the prompt, the answer, credentials or member data: only ids, the provider,
 * the attempt number, timings and a short error class/status.
 */

export const MAX_ATTEMPTS = 3;
let BACKOFF_MS = [1500, 4000];
/** Tests shorten the waits; production never calls this. */
export function setBackoffForTests(ms) { BACKOFF_MS = ms; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// "token" alone is not auth: max_tokens, tokens exceeded… Only real credential failures count.
const AUTH_RE = /\b(401|403)\b|unauthori[sz]ed|authentication|(invalid|incorrect)[ _-]?(api[ _-]?key|x-api-key|token)|oauth|credential|not logged in|please (run )?.*login|permission[ _-]denied|billing|org(anization)? not allowed/i;
const TRANSIENT_RE = /\b(429|500|502|503|504|529)\b|overloaded|rate[ _-]?limit|too many requests|server[ _-]error|internal server error|bad gateway|service unavailable|gateway time-?out|timed? ?out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN|ENOTFOUND|EPIPE|socket hang up|fetch failed|network|process exited with code|terminated by signal|stream (closed|ended)|premature close|returned no result|empty response|no content/i;
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
    if (status === 429 || (status >= 500 && status <= 599)) return { ok: false, errorClass: 'provider', transient: true, status };
    if (status === 401 || status === 403) return { ok: false, errorClass: 'auth', transient: false, status };
    if (AUTH_RE.test(err)) return { ok: false, errorClass: 'auth', transient: false, status };
    if (status && status >= 400 && status < 500) return { ok: false, errorClass: 'provider', transient: false, status };
    return { ok: false, errorClass: 'provider', transient: TRANSIENT_RE.test(err), status };
  }
  if (!String(r.text || '').trim()) return { ok: false, errorClass: 'empty', transient: true };
  return { ok: true };
}

/** One compact line per event; `fields` must never include prompts, answers or secrets. */
export function aiLog(event, fields = {}) {
  const parts = Object.entries(fields).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${String(v).replace(/\s+/g, '_').slice(0, 80)}`);
  console.log(['[coach]', event, ...parts].join(' '));
}

/**
 * Call the adapter, retrying transient failures (max MAX_ATTEMPTS calls, short backoff).
 * @param ctx { flow, job, provider } — for the log only
 * @returns the last adapter result plus `failure` (classify() result) when it did not succeed,
 *          and `attempts`.
 */
export async function invokeWithRetry(adapter, args, ctx = {}) {
  let last = null, failure = null, attempt = 0;
  for (attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    aiLog('AI_ATTEMPT', { flow: ctx.flow, job: ctx.job, provider: ctx.provider, attempt, repair: ctx.repair ? 1 : null });
    try { last = await adapter.invoke(args); }
    catch (e) { last = { code: -1, text: '', stderr: e?.message || String(e), timedOut: false, spawnError: false }; }
    const c = classify(last);
    if (c.ok) return { ...last, attempts: attempt, ms: Date.now() - t0 };
    failure = c;
    aiLog(c.errorClass === 'timeout' ? 'AI_TIMEOUT' : 'AI_PROVIDER_ERROR', {
      flow: ctx.flow, job: ctx.job, provider: ctx.provider, attempt, class: c.errorClass, status: c.status,
      transient: c.transient ? 1 : 0, ms: Date.now() - t0
    });
    // A timeout already cost a full timeout window: one more try at most (2 calls), not 3.
    if (!c.transient || attempt === MAX_ATTEMPTS || (c.errorClass === 'timeout' && attempt >= 2)) break;
    await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)] || 0);
  }
  return { ...last, failure, attempts: Math.min(attempt, MAX_ATTEMPTS) };
}
