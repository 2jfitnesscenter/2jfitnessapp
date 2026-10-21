// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Scans as short background jobs: POST → job id → the app polls → ready.
 *
 * Why: a scan can legitimately need several provider calls (retries while the provider is
 * overloaded, a second read to confirm a doubtful number). Holding one HTTP request open for that
 * long would hit nginx's 60 s limit, so the work runs after the request returned and the app asks
 * "is it ready?" every couple of seconds. The app hides all of it behind the same one-tap scan.
 *
 * What is kept, and for how long: the photo only in this process's memory, only while the job
 * runs, and it is dropped the moment the job ends (success, failure or cancellation). A finished
 * job keeps just the result (numbers / names the member is about to review) for ten minutes so a
 * reload of the page can still pick it up. Nothing here touches the disk; a restart loses the job,
 * and the app then simply offers the scan again (the daily scan slot is given back on failure).
 */
import crypto from 'node:crypto';

const RESULT_TTL_MS = 10 * 60000;
const RUN_TTL_MS = 6 * 60000;          // a job that outlives its own budget is dead
const MAX_RUNNING_TOTAL = 6;           // one gym, one provider key: this is generous
const jobs = new Map();

function purge(now = Date.now()) {
  for (const [id, j] of jobs) {
    if (j.state === 'running' ? now - j.startedAt > RUN_TTL_MS : now - j.endedAt > RESULT_TTL_MS) {
      j.controller?.abort(); j.image = null; jobs.delete(id);
    }
  }
}

export class ScanJobError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

/**
 * @param opts { uid, kind, image, run }  run(image, { signal, onPhase }) → the scan's own result
 *             ({ ok: true, ... } | { ok: false, code, error }).
 */
export function startScanJob({ uid, kind, image, run }) {
  purge();
  const mine = [...jobs.values()].find(j => j.uid === uid && j.state === 'running');
  if (mine) throw new ScanJobError('busy', 'ya hay una lectura en curso');
  if ([...jobs.values()].filter(j => j.state === 'running').length >= MAX_RUNNING_TOTAL) throw new ScanJobError('busy', 'hay muchas lecturas en curso; prueba en un momento');

  const job = { id: crypto.randomBytes(9).toString('base64url'), uid, kind, state: 'running', phase: 'reading', startedAt: Date.now(), endedAt: 0, controller: new AbortController(), image, result: null };
  jobs.set(job.id, job);
  const finish = patch => { Object.assign(job, patch, { endedAt: Date.now(), image: null }); };
  Promise.resolve()
    .then(() => run(job.image, { signal: job.controller.signal, onPhase: p => { if (job.state === 'running') job.phase = p; } }))
    .then(r => finish(r?.ok ? { state: 'done', result: r } : { state: job.controller.signal.aborted ? 'cancelled' : 'failed', result: { ok: false, code: r?.code || 'INTERNAL', error: r?.error || '' } }))
    .catch(() => finish({ state: 'failed', result: { ok: false, code: 'INTERNAL', error: '' } }));
  return { id: job.id };
}

/** @returns null when the job is unknown or belongs to somebody else. */
export function scanJobStatus(uid, id) {
  purge();
  const j = jobs.get(String(id));
  if (!j || j.uid !== uid) return null;
  return { id: j.id, kind: j.kind, state: j.state, phase: j.state === 'running' ? j.phase : null, elapsedMs: (j.endedAt || Date.now()) - j.startedAt, result: j.state === 'running' ? null : j.result };
}

export function cancelScanJob(uid, id) {
  const j = jobs.get(String(id));
  if (!j || j.uid !== uid) return false;
  if (j.state === 'running') { j.controller.abort(); }
  return true;
}

/** An erased account leaves nothing behind, not even a ten-minute result. */
export function dropScanJobsFor(uid) {
  for (const [id, j] of jobs) if (j.uid === uid) { j.controller?.abort(); j.image = null; jobs.delete(id); }
}

export const _jobsForTests = jobs;
