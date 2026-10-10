// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A light, DERIVED summary of each member's state file, so the admin member list does not decrypt every state-<uid>.json on every poll.
 *
 * It is a cache, never a source of truth: the canonical state stays in state-<uid>.json (lib/state-store.js). A summary holds only what the list shows:
 * lastSync (the state's own `_ts`), workoutCount and lastWorkoutAt (the newest workout DATE). No workouts, routines, weight, measurements, health or notes.
 *
 *  - Updated at the one place state is written (writeState → noteWrite), from the state already in memory.
 *  - Checked against the state file's fingerprint (mtime + size) before it is trusted, so a file changed by anything else (a restore, a legacy writer, a
 *    manual copy) is detected without decrypting; only that one member is rebuilt.
 *  - Missing, unreadable or from an older shape → rebuilt from the state; a state that cannot be read yields a flagged empty summary, never an error for the list.
 *  - Persisted (encrypted, domain 'user-summary') in user-summaries.json so a restart does not decrypt everybody again; losing the file only costs a rebuild.
 */
import fs from 'node:fs';
import path from 'node:path';
import { encrypt, decrypt } from './crypto.js';

const FILE = () => path.join(process.env.DATA_DIR || '/data', 'user-summaries.json');
const INFO = 'user-summary';
const VERSION = 1;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}/;
const SAVE_DELAY_MS = 3000;

let cache = null;          // Map uid -> { v, fp, lastSync, workoutCount, lastWorkoutAt, unreadable? }
let dirty = false, timer = null;
const counters = { hits: 0, rebuilds: 0, notes: 0 };
export const counts = () => ({ ...counters });
export function resetCounts() { counters.hits = 0; counters.rebuilds = 0; counters.notes = 0; }

function load() {
  if (cache) return cache;
  cache = new Map();
  try {
    const raw = fs.readFileSync(FILE(), 'utf8').trim();
    const data = raw ? decrypt(raw, INFO) : null;
    if (data && data.v === VERSION && data.users && typeof data.users === 'object') {
      for (const [uid, s] of Object.entries(data.users)) if (s && s.v === VERSION) cache.set(uid, s);
    }
  } catch { /* absent or unreadable: everything is rebuilt on demand */ }
  return cache;
}
function persist() {
  dirty = false; timer = null;
  try {
    const tmp = FILE() + '.tmp';
    fs.writeFileSync(tmp, encrypt({ v: VERSION, users: Object.fromEntries(load()) }, INFO), { mode: 0o600 });
    fs.renameSync(tmp, FILE());
  } catch { /* a derived cache: failing to save it is not an error */ }
}
function schedule() {
  dirty = true;
  if (!timer) { timer = setTimeout(persist, SAVE_DELAY_MS); timer.unref?.(); }
}
/** Writes any pending change now (tests, shutdown). */
export function flush() { if (timer) { clearTimeout(timer); timer = null; } if (dirty) persist(); }
/** Forgets everything in memory (tests). The file is left alone. */
export function resetMemory() { if (timer) { clearTimeout(timer); timer = null; } cache = null; dirty = false; }

/** The summary of one state, pure. `fp` is the fingerprint of the file it was read from. */
export function summarize(state, fp = null) {
  const workouts = Array.isArray(state?.workouts) ? state.workouts : [];
  let last = null;
  for (const w of workouts) { const d = typeof w?.d === 'string' && ISO_DAY.test(w.d) ? w.d.slice(0, 10) : null; if (d && (!last || d > last)) last = d; }
  const ts = Number(state?._ts);
  return { v: VERSION, fp, lastSync: Number.isFinite(ts) && ts > 0 ? ts : null, workoutCount: workouts.length, lastWorkoutAt: last };
}
const EMPTY = Object.freeze({ lastSync: null, workoutCount: 0, lastWorkoutAt: null });

/** Called by state-store right after a successful write, with the state in memory and the new file fingerprint. */
export function noteWrite(uid, state, fp) {
  counters.notes++;
  load().set(uid, summarize(state, fp));
  schedule();
}
export function forget(uid) { if (load().delete(uid)) schedule(); }
/** Drops summaries of people who no longer exist. */
export function prune(uids) {
  const keep = new Set(uids);
  let changed = false;
  for (const uid of [...load().keys()]) if (!keep.has(uid)) { cache.delete(uid); changed = true; }
  if (changed) schedule();
}

/**
 * The summary for the list. `fingerprint()` is a cheap stat of the state file (null when there is none); `read()` decrypts the state (only called to rebuild).
 * Returns { lastSync, workoutCount, lastWorkoutAt, unreadable? } — never throws.
 */
export function summaryFor(uid, { fingerprint, read }) {
  let fp = null;
  try { fp = fingerprint(); } catch { fp = null; }
  if (!fp) { load().delete(uid); return { ...EMPTY }; }       // no state yet (a member who never synced)
  const known = load().get(uid);
  if (known && known.fp === fp) { counters.hits++; return pick(known); }
  counters.rebuilds++;
  let next;
  try { next = summarize(read(), fp); }
  catch { next = { v: VERSION, fp, ...EMPTY, unreadable: true }; }   // corrupt or unreadable: flagged, and the list still renders
  load().set(uid, next);
  schedule();
  return pick(next);
}
const pick = s => ({ lastSync: s.lastSync, workoutCount: s.workoutCount, lastWorkoutAt: s.lastWorkoutAt, ...(s.unreadable ? { unreadable: true } : {}) });
