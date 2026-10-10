// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* /api/guided/* — "Entrena con 2J": the official guided routines, programs and collections.
 *
 * Reads: any signed-in person (the member catalogue). Writes, with the existing roles only:
 * trainers keep their own routines (duplicate, edit, delete — theirs alone); admins change the
 * official catalogue (content, status, featured/order/badge), its programs and its collections.
 * Members change nothing; a trainer who is not an admin never changes an official master — the
 * role is checked here, on the server, before anything else. Assigning a routine to a member is NOT
 * here: it is the existing POST /api/trainer/member-routine, with the routine copied in as a
 * snapshot, so the same policy and Sync V2 receipts apply.
 */
import * as store from './guided-store.js';
import { PROTOCOL_VERSION } from './protocol/index.js';

export function guidedRoutes({ json, readBody, readSession, requireTrainer, requireAdmin, isAdmin, isTrainer, unavailableEq, hiddenExercises = () => new Set(), availableEquipment = () => null }) {
  const reply = (res, r) => r.error
    ? json(res, r.status || 400, { error: r.error, ...(r.validation ? { validation: r.validation } : {}), ...(r.issues ? { issues: r.issues } : {}), ...(r.problems ? { problems: r.problems } : {}) })
    : json(res, 200, r);
  const officialOpts = () => ({ unavailableEq: unavailableEq(), hidden: hiddenExercises(), availableEquipment: availableEquipment() });
  return {
    'GET /api/guided': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const admin = isAdmin(user), trainer = isTrainer(user);
      json(res, 200, { protocolVersion: PROTOCOL_VERSION, seed: store.seedInfo(), rev: store.contentRev(), canEdit: admin, canAssign: trainer, uid: user.id,
        ...store.listFor(user, { trainer, admin }) });
    },
    // body: { routine: { id?, scope?: 'official', status?, name, subtitle, description, category, goal, level, focus, purpose?, cover?, notes?, ex, blocks, curatedTags?, customExDefs? }, dryRun? }
    'POST /api/guided/save': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.upsert(user, isAdmin(user), body.routine || {}, { ...officialOpts(), dryRun: !!body.dryRun }));
    },
    'POST /api/guided/duplicate': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      // An admin can also copy an official routine into an editable official DRAFT (body.official).
      if (body.official) { if (!requireAdmin(req, res)) return; return reply(res, store.duplicateOfficial(user, String(body.id || ''))); }
      reply(res, store.duplicate(user, String(body.id || '')));
    },
    'POST /api/guided/active': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.setActive(user, isAdmin(user), String(body.id || ''), body.active !== false));
    },
    // body: { id, status: 'draft' | 'active' | 'hidden' }
    'POST /api/guided/status': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.setStatus(user, isAdmin(user), String(body.id || ''), String(body.status || '')));
    },
    'POST /api/guided/delete': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.remove(user, isAdmin(user), String(body.id || '')));
    },
    // body: { id, featured?: n|null, order?: n|null, badge?: 'new'|'featured'|… }
    'POST /api/guided/curate': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.curate(user, String(body.id || ''), body));
    },
    // The kept versions of one official item (admin). Newest first; no bodies.
    'GET /api/guided/history': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const id = new URL(req.url, 'http://x').searchParams.get('id') || '';
      json(res, 200, { versions: store.historyOf(id) });
    },
    // body: { id, at } — puts a kept version back through the normal (validated) save path.
    'POST /api/guided/restore': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.restoreVersion(user, String(body.id || ''), String(body.at || ''), officialOpts()));
    },
    // body: { kind: 'routines' | 'programs' | 'collections', ids: [...] } — the order, as the position
    'POST /api/guided/reorder': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.reorder(user, String(body.kind || ''), body.ids));
    },
    'POST /api/guided/program/curate': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.curateProgram(user, String(body.id || ''), body));
    },
    // body: { program: { id?, name, description, goal, level, cover, featured, status?, weeks: [{ sessions: [{ day, routineId }] }] }, dryRun? }
    'POST /api/guided/program/save': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.saveProgram(user, body.program || {}, { dryRun: !!body.dryRun }));
    },
    'POST /api/guided/program/duplicate': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.duplicateProgram(user, String(body.id || '')));
    },
    'POST /api/guided/program/delete': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.removeProgram(user, String(body.id || '')));
    },
    // body: { collection: { id?, name, description, style, order, active, featured, routineIds, programIds } }
    'POST /api/guided/collection': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.saveCollection(user, body.collection || {}));
    },
    'POST /api/guided/collection/delete': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.removeCollection(user, String(body.id || '')));
    },
  };
}
