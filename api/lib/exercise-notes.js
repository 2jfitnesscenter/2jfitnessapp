// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Shared exercise note: ONE text per member + exercise, edited by the member and by the staff who may reach that member (same value, last save wins).
 *
 * It lives in its own file (DATA/exercise-notes.json), not in a routine and not in the member's synced state: it survives deleting or duplicating a routine,
 * a program change, and the exercise coming back months later; and a trainer's edit never conflicts with the member's own pending sync operations.
 * Access reuses the existing member-access rule (canAccessMember): a member only their own notes; a trainer any member the rule allows; an admin everyone.
 * No history of versions (first version): the last valid save is the current value. An empty text deletes the note.
 */
import fs from 'node:fs';
import path from 'node:path';

export const NOTE_MAX = 500;
const EXERCISE_ID = /^[A-Za-z0-9_-]{1,60}$/;
const FILE = () => path.join(process.env.DATA_DIR || '/data', 'exercise-notes.json');

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE(), 'utf8'));
    if (s && typeof s === 'object' && s.members && typeof s.members === 'object') return s;
  } catch { /* absent = no notes yet */ }
  return { v: 1, members: {} };
}
function save(s) {
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s));
  fs.renameSync(tmp, f);
}

export const notesOf = uid => ({ ...(load().members[uid] || {}) });

export function setNote(uid, exerciseId, text, by) {
  const s = load();
  const mine = s.members[uid] = s.members[uid] || {};
  const clean = String(text ?? '').replace(/\r\n/g, '\n').trim().slice(0, NOTE_MAX);
  if (!clean) { delete mine[exerciseId]; if (!Object.keys(mine).length) delete s.members[uid]; save(s); return null; }
  mine[exerciseId] = { text: clean, updatedAt: new Date().toISOString(), updatedBy: by };
  save(s);
  return mine[exerciseId];
}

/** Account export / erasure hooks (lib/account-erasure.js). */
export const exportUser = uid => notesOf(uid);
export function removeUser(uid) {
  const s = load();
  const n = Object.keys(s.members[uid] || {}).length;
  if (s.members[uid]) { delete s.members[uid]; save(s); }
  return n;
}

export function exerciseNoteRoutes({ db, json, readBody, readSession, isAdmin, isTrainer, canAccessMember }) {
  // The member whose notes are meant: the caller's own, or (staff) the one named by memberId, if the access rule allows it.
  const target = (req, res, wanted) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
    const id = String(wanted || user.id);
    if (id === user.id) return { user, memberId: id };
    const m = db.users.find(x => x.id === id);
    if (!m && isAdmin(user)) { json(res, 404, { error: 'ese miembro no existe' }); return null; }
    if (!isTrainer(user) || !m || !canAccessMember(user, m, isAdmin)) { json(res, 403, { error: 'prohibido' }); return null; }
    return { user, memberId: id };
  };
  return {
    // → { notes: { [exerciseId]: { text, updatedAt, updatedBy } } }
    'GET /api/exercise-notes': async (req, res) => {
      const t = target(req, res, new URL(req.url, 'http://x').searchParams.get('memberId')); if (!t) return;
      json(res, 200, { notes: notesOf(t.memberId) });
    },
    // body: { memberId?, exerciseId, text } — create or edit; an empty text deletes. → { ok, note: {...} | null }
    'POST /api/exercise-notes': async (req, res) => {
      const body = await readBody(req);
      const t = target(req, res, body.memberId); if (!t) return;
      const exerciseId = String(body.exerciseId || '');
      if (!EXERCISE_ID.test(exerciseId)) return json(res, 400, { error: 'ejercicio no válido' });
      if (typeof body.text !== 'string') return json(res, 400, { error: 'la nota debe ser un texto' });
      json(res, 200, { ok: true, note: setNote(t.memberId, exerciseId, body.text, t.user.id) });
    },
  };
}
