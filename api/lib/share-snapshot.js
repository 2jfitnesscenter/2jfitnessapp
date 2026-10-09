// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Private shares of a routine or a program: what travels is a SNAPSHOT of the plan content, cleaned field by field here, never a reference to the
 * sender's routine. Same fields a plan file already carries (frontend/src/lib/plan-share.js `cleanEx`): exercise id, sets, reps/time/cardio, weight,
 * progression. Notes, history, body data and anything unknown are dropped on the way in, so a snapshot cannot carry more than the plan itself.
 */
import crypto from 'node:crypto';

export const SNAPSHOT_KINDS = ['routine', 'program'];
const LEVELS = ['beginner', 'intermediate', 'advanced'];
const GOALS = ['hypertrophy', 'toning', 'fatloss', 'power', 'plyometrics', 'longevity'];
const ORIGINS = ['plan', '2j', 'community'];
const MODES = ['reps', 'time', 'cardio'];
const MAX_EX = 40, MAX_ROUTINES = 14, MAX_BYTES = 80_000;

const text = (v, n) => String(v ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const num = (v, lo, hi) => { const n = Number(v); return v === null || v === '' || !Number.isFinite(n) ? undefined : Math.min(hi, Math.max(lo, n)); };

function cleanEx(e) {
  if (!e || typeof e !== 'object' || typeof e.id !== 'string' || !e.id || e.id.length > 40) return null;
  const o = { id: e.id };
  const sets = num(e.sets, 1, 30); if (sets !== undefined) o.sets = Math.round(sets);
  if (MODES.includes(e.mode)) o.mode = e.mode;
  for (const [key, lo, hi] of [['reps', 0, 500], ['repsMin', 0, 500], ['sec', 0, 7200], ['min', 0, 600], ['speed', 0, 60], ['weight', 0, 2000], ['inc', 0, 200]]) {
    const v = num(e[key], lo, hi); if (v !== undefined) o[key] = v;
  }
  if (typeof e.reps === 'string' && /^\d{1,3}(-\d{1,3})?$/.test(e.reps)) o.reps = e.reps;
  if (e.prog) o.prog = text(e.prog, 20);
  if (e.sg !== undefined && e.sg !== null && e.sg !== '' && e.sg !== false) o.sg = text(e.sg, 20);
  return o;
}
function cleanDefs(raw, ex) {
  const defs = (Array.isArray(raw) ? raw : []).filter(d => d && typeof d.id === 'string' && typeof d.n === 'string')
    .slice(0, MAX_EX * 2).map(d => ({ id: text(d.id, 40), n: text(d.n, 60), ...(d.bp ? { bp: text(d.bp, 30) } : {}), ...(d.mgKey ? { mgKey: text(d.mgKey, 40) } : {}), ...(d.desc ? { desc: text(d.desc, 300) } : {}) }));
  const have = new Set(defs.map(d => d.id));
  // A custom exercise id travels with its definition, or it would read as "Unknown exercise" for the receiver.
  return ex.some(e => e.id.startsWith('c') && !have.has(e.id)) ? null : defs;
}
function cleanRoutine(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const name = text(raw.name, 60);
  const ex = (Array.isArray(raw.ex) ? raw.ex : []).slice(0, MAX_EX).map(cleanEx).filter(Boolean);
  if (!name || !ex.length) return null;
  const customExDefs = cleanDefs(raw.customExDefs, ex);
  if (!customExDefs) return null;
  return { name, emoji: text(raw.emoji, 20) || 'dumbbell', ...(raw.prog ? { prog: text(raw.prog, 20) } : {}), ex, customExDefs };
}

/** Validates and cleans a snapshot. Returns { snapshot, meta, targetId } or { error }. */
export function cleanSnapshot(kind, raw, extra = {}) {
  if (!SNAPSHOT_KINDS.includes(kind) || !raw || typeof raw !== 'object') return { error: 'contenido no válido' };
  let snapshot;
  if (kind === 'routine') {
    snapshot = cleanRoutine(raw);
    if (!snapshot) return { error: 'la rutina necesita un nombre y al menos un ejercicio válido' };
  } else {
    const name = text(raw.name, 60);
    const routines = (Array.isArray(raw.routines) ? raw.routines : []).slice(0, MAX_ROUTINES).map(cleanRoutine);
    if (!name || !routines.length || routines.some(r => !r)) return { error: 'el programa necesita un nombre y rutinas válidas' };
    snapshot = { name, emoji: text(raw.emoji, 20) || 'folder', routines };
    const days = num(raw.daysPerWeek ?? extra.daysPerWeek, 1, 7); if (days !== undefined) snapshot.daysPerWeek = Math.round(days);
  }
  if (JSON.stringify(snapshot).length > MAX_BYTES) return { error: 'el contenido es demasiado grande para compartirlo' };
  const meta = { title: snapshot.name };
  if (LEVELS.includes(extra.level)) meta.level = extra.level;
  if (GOALS.includes(extra.goal)) meta.goal = extra.goal;
  const duration = text(extra.duration, 30); if (duration) meta.duration = duration;
  meta.origin = ORIGINS.includes(extra.origin) ? extra.origin : 'plan';
  const targetId = 'snap-' + crypto.createHash('sha256').update(kind + JSON.stringify(snapshot)).digest('base64url').slice(0, 16);
  return { snapshot, meta, targetId };
}

/** The small card a chat bubble or a notification shows: title, size, date. */
export function snapshotCard(share) {
  const s = share.snapshot || {};
  return {
    title: text(share.meta?.title || s.name, 90),
    metric: share.kind === 'program' ? `${(s.routines || []).length} routines` : `${(s.ex || []).length} exercises`,
    date: new Date(share.createdAt).toISOString().slice(0, 10),
  };
}
