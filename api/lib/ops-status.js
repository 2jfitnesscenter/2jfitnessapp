// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Minimal operations view for the administrator: is the backup recent, has a restore been rehearsed, which release is running, is the
 * disk filling up, and what failed on the server lately. Backend only, no external service. Everything is READ from small files the ops
 * scripts leave in <data>/ops (backup-status.json, restore-status.json, deploy-marker.json): this module never runs a script and never
 * writes anything but its in-memory error ring. Contains no secret, path, address or request body. */
import fs from 'node:fs';
import path from 'node:path';

export const BACKUP_STALE_HOURS = 36;     // a nightly backup older than this is an alarm
export const REHEARSAL_DUE_DAYS = 100;    // a restore rehearsal is due roughly every quarter
export const DISK_LOW_PERCENT = 15;
const HOUR = 3600000, DAY = 86400000;

const clip = v => (typeof v === 'string' ? v.slice(0, 120) : typeof v === 'number' || typeof v === 'boolean' ? v : undefined);
function readJson(file) {
  try { const v = JSON.parse(fs.readFileSync(file, 'utf8')); return v && typeof v === 'object' && !Array.isArray(v) ? v : null; } catch { return null; }
}
const pick = (o, keys) => Object.fromEntries(keys.filter(k => clip(o[k]) !== undefined).map(k => [k, clip(o[k])]));
const ageMs = (iso, now) => { const t = Date.parse(iso); return Number.isFinite(t) ? Math.max(0, now - t) : null; };

/** The last N server-side failures (route + status + time), enough to see "something is breaking" without logging bodies or users. */
export function createErrorRing(max = 20) {
  const last = []; let total = 0;
  return {
    record(route, status, now = Date.now()) {
      total++; last.push({ at: new Date(now).toISOString(), route: String(route).slice(0, 80), status: Number(status) || 500 });
      if (last.length > max) last.shift();
    },
    snapshot: () => ({ total, last: last.slice().reverse() }),
  };
}

export function opsStatus({ dataDir, now = Date.now(), startedAt = now, users = null, errors = { total: 0, last: [] }, disk } = {}) {
  const ops = path.join(dataDir, 'ops');
  const alerts = [];

  const b = readJson(path.join(ops, 'backup-status.json'));
  let backup = { state: 'never' };
  if (b) {
    const age = ageMs(b.at, now);
    const state = b.ok !== true ? 'failed' : age === null || age > BACKUP_STALE_HOURS * HOUR ? 'stale' : 'ok';
    backup = { state, ...pick(b, ['at', 'file', 'bytes', 'remote', 'secretInArchive', 'reason', 'stage', 'seconds']), ageHours: age === null ? null : Math.round(age / HOUR * 10) / 10 };
  }
  if (backup.state === 'never') alerts.push('backup_never');
  else if (backup.state === 'failed') alerts.push('backup_failed');
  else if (backup.state === 'stale') alerts.push('backup_stale');
  if (backup.secretInArchive === 'no') alerts.push('secret_not_in_archive');

  const r = readJson(path.join(ops, 'restore-status.json'));
  let restore = { state: 'never' };
  if (r) {
    const age = ageMs(r.at, now);
    const state = r.ok !== true ? 'failed' : age === null || age > REHEARSAL_DUE_DAYS * DAY ? 'due' : 'ok';
    restore = { state, ...pick(r, ['at', 'file', 'users', 'states', 'boot', 'verifySeconds', 'restoreSeconds', 'validateSeconds', 'reason', 'stage']), ageDays: age === null ? null : Math.floor(age / DAY) };
  }
  if (restore.state === 'never') alerts.push('restore_never');
  else if (restore.state === 'failed') alerts.push('restore_failed');
  else if (restore.state === 'due') alerts.push('restore_due');

  const d = readJson(path.join(ops, 'deploy-marker.json'));
  const deploy = d ? { ...pick(d, ['sha', 'at', 'note']), ageDays: ageMs(d.at, now) === null ? null : Math.floor(ageMs(d.at, now) / DAY) } : null;

  let diskInfo = null;
  try {
    const s = disk || fs.statfsSync(dataDir);
    const total = Number(s.blocks) * Number(s.bsize), free = Number(s.bavail) * Number(s.bsize);
    if (total > 0) diskInfo = { freePercent: Math.round(free / total * 1000) / 10, freeMb: Math.floor(free / 1048576) };
  } catch { /* statfs unavailable on this platform */ }
  if (diskInfo && diskInfo.freePercent < DISK_LOW_PERCENT) alerts.push('disk_low');

  return {
    at: new Date(now).toISOString(), uptimeSec: Math.floor((now - startedAt) / 1000), users,
    backup, restore, deploy, disk: diskInfo, errors, alerts, ok: alerts.length === 0,
  };
}
