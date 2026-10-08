// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// HTTP surface of Coach & Seguimiento PRO V3. Everything here is STAFF-only (requireTrainer = trainer or admin) and scoped by an explicit assignment:
//   admin      → every member
//   trainer    → only members whose roster entry lists them in `assignedTrainers` (an admin sets it; empty/absent = admin only)
//   member     → none of it (403)
// A trainer who is not assigned gets the same 403 as a member, so ids cannot be probed. The legacy trainer-panel endpoints (plan editing, routine cycles) keep
// their role-based access untouched — this ACL guards the new health/check-in/notes/analysis surface, which until now was admin-only anyway.
// The roster entry holds the staff data (followUp.goalPlan, followUp.flag, the encrypted notes/events). Nothing is written to the member's synced state.
import crypto from 'node:crypto';
import { sanitizeFollowUp, templateKeys } from './followup.js';
import { routineReviews } from './routine-review.js';
import { memberView, overviewRow, bucketRows, sanitizeGoal, aiFacts, cleanStructure } from './coach-followup.js';
import { emptyPrivate, normalizePrivate, pushEvent, addNote, deleteNote, timeline, DECISION_KINDS } from './coach-followup-private.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const todayISO = () => new Date().toISOString().slice(0, 10);

/** The one access rule. `isAdmin` comes from the server so ADMIN_UIDS-configured admins count too. */
export function canAccessMember(staff, member, isAdmin) {
  if (!staff || !member) return false;
  if (isAdmin(staff)) return true;
  return Array.isArray(member.assignedTrainers) && member.assignedTrainers.includes(staff.id);
}

export function coachFollowUpRoutes(d) {
  const { db, json, readBody, requireTrainer, requireAdmin, isAdmin, isTrainer, saveDb, readState, encryptAtRest, decryptAtRest, info, ai, cycleView } = d;
  const isMember = u => !u.disabled && !isTrainer(u);
  const names = () => Object.fromEntries(db.users.filter(isTrainer).map(u => [u.id, u.name]));

  // Resolves caller + member, answering 401/403/404 itself. `write` also refuses a disabled member.
  function access(req, res, { id, write = false } = {}) {
    const staff = requireTrainer(req, res); if (!staff) return null;
    const memberId = id ?? new URL(req.url, 'http://x').searchParams.get('id');
    const u = db.users.find(x => x.id === memberId);
    if (!u || isTrainer(u) || !canAccessMember(staff, u, isAdmin)) { json(res, isAdmin(staff) && !u ? 404 : 403, { error: isAdmin(staff) && !u ? 'ese usuario no existe' : 'prohibido' }); return null; }
    if (write && u.disabled) { json(res, 409, { error: 'esta cuenta está desactivada' }); return null; }
    return { staff, u };
  }
  // Decrypts the private blob of a member. { priv } (a normalized blob), { priv:null, none:true } (no follow-up yet) or { priv:null, corrupt:true } (never overwritten).
  function readPriv(u) {
    const f = u.followUp;
    if (!f) return { priv: null, none: true };
    if (!f.privateNotesEncrypted) return { priv: emptyPrivate() };
    const priv = normalizePrivate(decryptAtRest(f.privateNotesEncrypted, info));
    return priv ? { priv } : { priv: null, corrupt: true };
  }
  const writePriv = (u, priv) => { u.followUp.privateNotesEncrypted = encryptAtRest(priv, info); saveDb(); };
  const needPriv = (u, res) => {
    const r = readPriv(u);
    if (r.none) { json(res, 400, { error: 'activa el seguimiento antes de guardar notas o decisiones' }); return null; }
    if (r.corrupt) { json(res, 409, { error: 'no se pudo leer la nota privada guardada; no se ha sobrescrito' }); return null; }
    return r.priv;
  };
  const publicFollowUp = f => { if (!f) return null; const { privateNotesEncrypted, ...pub } = f; return { ...pub, keys: templateKeys(f) }; };
  const noteView = (priv, nm) => (priv ? priv.entries.slice().reverse().map(e => ({ id: e.id, at: e.at, by: nm[e.by] || null, mine: false, text: e.text, ref: e.ref || null })) : []);

  return {
    /* ------------------------------ the list: one request, every member this staff may see ------------------------------ */
    'GET /api/trainer/followup/overview': async (req, res) => {
      const staff = requireTrainer(req, res); if (!staff) return;
      const today = todayISO();
      const rows = [];
      for (const u of db.users) {
        if (!isMember(u) || !canAccessMember(staff, u, isAdmin)) continue;
        let S = null;
        try { S = readState(u.id); } catch { /* an unreadable state never hides the other members */ }
        rows.push(overviewRow({ S: S || {}, u, today }));
      }
      const b = bucketRows(rows);
      json(res, 200, { today, counts: b.counts, attention: b.attention, upcoming: b.upcoming, stable: b.stable, scope: isAdmin(staff) ? 'all' : 'assigned', assigned: rows.length });
    },

    /* ------------------------------ the sheet of one member ------------------------------ */
    'GET /api/trainer/followup/member': async (req, res) => {
      const a = access(req, res); if (!a) return;
      const { staff, u } = a;
      const today = todayISO();
      let S = null;
      try { S = readState(u.id); } catch { return json(res, 503, { error: 'el estado de este socio no se puede leer' }); }
      const view = memberView({ S: S || {}, u, today });
      const pr = readPriv(u);
      const nm = names();
      const notes = noteView(pr.priv, nm).map(n => ({ ...n, mine: pr.priv.entries.find(e => e.id === n.id)?.by === staff.id }));
      json(res, 200, {
        member: { id: u.id, name: u.name, avatar: u.avatar || null, created: u.created || null, disabled: !!u.disabled, synced: !!S },
        view, followUp: publicFollowUp(u.followUp),
        // The same cycle shape the existing Routine Review editor consumes (date overrides, 'reviewed'), so the sheet reuses that editor instead of copying it.
        routineCycles: routineReviews(S || {}, today).map(cycleView),
        privateAvailable: !pr.corrupt, legacyNote: pr.priv ? pr.priv.notes.slice(0, 2000) : '', notes,
        timeline: timeline({ S: S || {}, f: u.followUp, priv: pr.priv, names: nm }),
        sync: S?._sync ? { revision: S._sync.revision, generation: S._sync.generation } : null,
        trainers: isAdmin(staff) ? { assigned: (u.assignedTrainers || []).filter(id => nm[id]), options: Object.entries(nm).filter(([id]) => !isAdmin(db.users.find(x => x.id === id))).map(([id, name]) => ({ id, name })) } : null,
        ai: { available: ai.available() },
      });
    },

    /* ------------------------------ writes (roster only) ------------------------------ */
    'POST /api/trainer/followup/start': async (req, res) => {
      const body = await readBody(req);
      const a = access(req, res, { id: body.id, write: true }); if (!a) return;
      if (a.u.followUp) return json(res, 200, { ok: true, followUp: publicFollowUp(a.u.followUp) });
      const r = sanitizeFollowUp({ template: 'basic', cadence: 'monthly' }, null, todayISO());
      a.u.followUp = r.value; saveDb();
      json(res, 200, { ok: true, followUp: publicFollowUp(a.u.followUp) });
    },

    // body: { id, primary?, label?, targetDate?, priority?, comment? } — a missing key is left as is, null/'' clears it.
    'POST /api/trainer/followup/goal': async (req, res) => {
      const body = await readBody(req);
      const a = access(req, res, { id: body.id, write: true }); if (!a) return;
      const { staff, u } = a;
      const priv = needPriv(u, res); if (!priv) return;
      const g = sanitizeGoal(body, u.followUp.goalPlan);
      if (g.error) return json(res, 400, { error: g.error });
      if (JSON.stringify(g.value || null) === JSON.stringify(u.followUp.goalPlan || null)) return json(res, 200, { ok: true, goalPlan: u.followUp.goalPlan || null, changed: false });
      if (g.value) u.followUp.goalPlan = { ...g.value, by: staff.id, at: new Date().toISOString() }; else delete u.followUp.goalPlan;
      writePriv(u, pushEvent(priv, { kind: 'goal_changed', by: staff.id, text: typeof body.comment === 'string' ? body.comment.trim() : '' }));
      json(res, 200, { ok: true, goalPlan: u.followUp.goalPlan || null, changed: true });
    },

    // body: { id, text, ref?: { kind: 'program'|'routine', id } }
    'POST /api/trainer/followup/note': async (req, res) => {
      const body = await readBody(req);
      const a = access(req, res, { id: body.id, write: true }); if (!a) return;
      const priv = needPriv(a.u, res); if (!priv) return;
      const r = addNote(priv, { by: a.staff.id, text: body.text, ref: body.ref, id: crypto.randomBytes(6).toString('hex') });
      if (r.error) return json(res, 400, { error: r.error });
      writePriv(a.u, r.value);
      json(res, 200, { ok: true, notes: noteView(r.value, names()) });
    },
    'POST /api/trainer/followup/note/delete': async (req, res) => {
      const body = await readBody(req);
      const a = access(req, res, { id: body.id, write: true }); if (!a) return;
      const priv = needPriv(a.u, res); if (!priv) return;
      const own = priv.entries.find(e => e.id === body.noteId);
      if (own && own.by !== a.staff.id && !isAdmin(a.staff)) return json(res, 403, { error: 'prohibido' });
      const r = deleteNote(priv, body.noteId, a.staff.id);
      if (r.error) return json(res, 404, { error: r.error });
      writePriv(a.u, r.value);
      json(res, 200, { ok: true, notes: noteView(r.value, names()) });
    },

    // body: { id, kind: recommendation_accepted|recommendation_rejected|program_changed|rescheduled, ref?, text? } — what the trainer decided, and why.
    'POST /api/trainer/followup/decision': async (req, res) => {
      const body = await readBody(req);
      const a = access(req, res, { id: body.id, write: true }); if (!a) return;
      if (!DECISION_KINDS.includes(body.kind)) return json(res, 400, { error: 'decisión no válida' });
      const priv = needPriv(a.u, res); if (!priv) return;
      writePriv(a.u, pushEvent(priv, { kind: body.kind, by: a.staff.id, ref: body.ref, text: typeof body.text === 'string' ? body.text.trim() : '' }));
      json(res, 200, { ok: true, timeline: timeline({ S: readState(a.u.id) || {}, f: a.u.followUp, priv: readPriv(a.u).priv, names: names() }) });
    },

    // body: { id, on: boolean } — the staff's own "keep an eye on this member" mark (never shown to the member).
    'POST /api/trainer/followup/flag': async (req, res) => {
      const body = await readBody(req);
      const a = access(req, res, { id: body.id, write: true }); if (!a) return;
      const priv = needPriv(a.u, res); if (!priv) return;
      const on = body.on === true;
      if (on === !!a.u.followUp.flag) return json(res, 200, { ok: true, flagged: on });
      if (on) a.u.followUp.flag = { at: new Date().toISOString(), by: a.staff.id }; else delete a.u.followUp.flag;
      writePriv(a.u, pushEvent(priv, { kind: on ? 'flag_set' : 'flag_cleared', by: a.staff.id }));
      json(res, 200, { ok: true, flagged: on });
    },

    // Assign trainers to a member — admin only. body: { id, trainerIds: [...] } (empty = admin only).
    'POST /api/admin/user/trainers': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return;
      const body = await readBody(req);
      const u = db.users.find(x => x.id === body.id);
      if (!u || isTrainer(u)) return json(res, 404, { error: 'ese usuario no existe' });
      const ids = [...new Set(Array.isArray(body.trainerIds) ? body.trainerIds.map(String) : [])];
      const bad = ids.find(id => { const t = db.users.find(x => x.id === id); return !t || t.disabled || !isTrainer(t); });
      if (bad) return json(res, 400, { error: 'solo se pueden asignar entrenadores activos' });
      if (ids.length) u.assignedTrainers = ids; else delete u.assignedTrainers;
      saveDb();
      json(res, 200, { ok: true, assigned: u.assignedTrainers || [] });
    },

    /* ------------------------------ "Analizar seguimiento" ------------------------------ */
    // body: { id, structure?: findings of the active plan, lang?: 'es'|'en' }. Always answers with the deterministic analysis; the AI answer is polled separately.
    'POST /api/trainer/followup/analyze': async (req, res) => {
      const body = await readBody(req);
      const a = access(req, res, { id: body.id }); if (!a) return;
      const { staff, u } = a;
      let S = null;
      try { S = readState(u.id); } catch { /* handled below */ }
      if (!S) return json(res, 400, { error: 'este socio nunca ha sincronizado: todavía no hay datos que analizar' });
      const structure = cleanStructure(body.structure);
      const view = memberView({ S, u, today: todayISO(), structure });
      const pr = readPriv(u);
      const nm = names();
      const recent = timeline({ S, f: u.followUp, priv: pr.priv, names: nm, limit: 5 }).map(e => ({ kind: e.kind, d: e.d }));
      const facts = aiFacts(view, { structure, recent });
      const base = { analysis: view.analysis, signals: view.signals.filter(s => s.severity !== 'info').length };
      if (!ai.available()) return json(res, 200, { ...base, source: 'deterministic', ai: { available: false } });
      try {
        const job = ai.enqueue(staff.id, u.id, facts, body.lang === 'en' ? 'en' : 'es');
        json(res, 202, { ...base, source: 'ai', job, ai: { available: true } });
      } catch (e) {
        if (!e.code) throw e;
        json(res, 200, { ...base, source: 'deterministic', ai: { available: true, error: e.code } });
      }
    },
    'GET /api/trainer/followup/analysis': async (req, res) => {
      const a = access(req, res); if (!a) return;
      json(res, 200, ai.status(a.staff.id, a.u.id));
    },
  };
}

/** Best-effort decision trail for actions that already exist elsewhere (e.g. moving a review date). Never throws, never blocks the action; no follow-up = nothing to write to. */
export function recordPrivateEvent(d, u, event) {
  try {
    const f = u?.followUp;
    if (!f) return false;
    const priv = f.privateNotesEncrypted ? normalizePrivate(d.decryptAtRest(f.privateNotesEncrypted, d.info)) : emptyPrivate();
    if (!priv) return false;          // an unreadable blob is never overwritten
    f.privateNotesEncrypted = d.encryptAtRest(pushEvent(priv, event), d.info);
    d.saveDb();
    return true;
  } catch { return false; }
}
