// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Internal reliability counters for every AI flow. Numbers only: no prompts, images, answers,
 * member ids or credentials ever reach this module, so the file it keeps (data/ai-metrics.json)
 * is safe to read, back up and show to an admin.
 *
 * One tracker per user-visible request (`begin(flow)`); the retry layer reports each provider
 * call into it and the caller closes it with `finish(ok)`. The outcome of a request is exactly
 * one of first_try_success | retry_success | repair_success | fallback_success | final_failure.
 */
import fs from 'node:fs';
import path from 'node:path';

export const FLOWS = ['member_routine', 'trainer_routine', 'coach_review', 'routine_scan', 'measurement_scan', 'machine_scan'];
const COUNTERS = ['requests', 'first_try_success', 'retry_success', 'repair_success', 'fallback_success', 'final_failure',
  'calls', 'http_429', 'http_5xx', 'http_503', 'timeout', 'bad_json', 'validation_failure', 'second_read', 'third_read', 'cancelled'];

const DATA = () => process.env.DATA_DIR || '/data';
const FILE = () => path.join(DATA(), 'ai-metrics.json');
let state = null;
let flushTimer = null;

const blank = () => ({ ...Object.fromEntries(COUNTERS.map(k => [k, 0])), attemptsTotal: 0, latencyTotalMs: 0, latencyMaxMs: 0 });

function load() {
  if (state) return state;
  state = {};
  try {
    const stored = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    for (const [flow, row] of Object.entries(stored.flows || {})) state[flow] = { ...blank(), ...row };
  } catch { /* first run, or an unreadable file: counters simply start again */ }
  return state;
}
const row = flow => { const s = load(); return s[flow] || (s[flow] = blank()); };

function flush() {
  flushTimer = null;
  try {
    const file = FILE(), tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ v: 1, updatedAt: new Date().toISOString(), flows: load() }), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch { /* metrics must never break a request */ }
}
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flush, 5000);
  flushTimer.unref?.();
}
/** Tests and shutdown. */
export function flushNow() { if (flushTimer) clearTimeout(flushTimer); flush(); }
export function resetForTests() { state = null; if (flushTimer) clearTimeout(flushTimer); flushTimer = null; }

/** Read-only view for the admin panel. Derived rates are computed here, never stored. */
export function snapshot() {
  const out = {};
  for (const [flow, r] of Object.entries(load())) {
    out[flow] = { ...r,
      avgAttempts: r.requests ? Math.round((r.attemptsTotal / r.requests) * 100) / 100 : 0,
      avgLatencyMs: r.requests ? Math.round(r.latencyTotalMs / r.requests) : 0 };
  }
  return out;
}

const STATUS_BUCKET = status => status === 429 ? 'http_429' : status === 503 ? 'http_503' : status >= 500 && status <= 599 ? 'http_5xx' : null;

/** Start counting one request. Every method is safe to call any number of times. */
export function begin(flow) {
  const started = Date.now();
  const t = { calls: 0, retried: false, repaired: false, fallback: false, closed: false };
  const bump = (k, n = 1) => { row(flow)[k] += n; scheduleFlush(); };
  return {
    /** One provider call finished; `failure` is ai-run.classify()'s result, or null on success. */
    call(failure) {
      t.calls++; bump('calls');
      if (!failure) return;
      const b = STATUS_BUCKET(failure.status);
      if (b) bump(b);
      if (failure.errorClass === 'timeout') bump('timeout');
    },
    retried() { t.retried = true; },
    repaired() { t.repaired = true; },
    usedFallback() { t.fallback = true; },
    badJson() { bump('bad_json'); },
    validationFailure() { bump('validation_failure'); },
    extraRead(n) { bump(n >= 3 ? 'third_read' : 'second_read'); },
    cancelled() { bump('cancelled'); },
    /** Close the request. `ok` = the user got a usable result. */
    finish(ok) {
      if (t.closed) return;
      t.closed = true;
      const ms = Date.now() - started;
      const r = row(flow);
      r.requests++; r.attemptsTotal += t.calls; r.latencyTotalMs += ms; r.latencyMaxMs = Math.max(r.latencyMaxMs, ms);
      const outcome = !ok ? 'final_failure' : t.repaired ? 'repair_success' : t.fallback ? 'fallback_success' : (t.retried || t.calls > 1) ? 'retry_success' : 'first_try_success';
      r[outcome]++; scheduleFlush();
      return outcome;
    }
  };
}
