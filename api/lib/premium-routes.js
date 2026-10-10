// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* /api/premium/* — Premium Training Programs.
 *
 * Reads: any signed-in person, filtered by role (members: the published catalogue; trainers: + their own programs; admins: everything). While the
 * admin's global `premium` switch is OFF, members get 403 feature_off (no catalogue, no new activations); trainers and admins keep working so the
 * catalogue can be prepared. A member's running program is unaffected: it lives in their own state with its pinned snapshot.
 * Writes, with the existing roles only (checked in lib/premium-store.js before anything else): trainers manage their OWN personal programs and can never
 * publish globally; admins manage the catalogue, publish, hide, feature, archive, order, promote a trainer's program and restore versions.
 */
import * as store from './premium-store.js';

export function premiumRoutes({ json, readBody, readSession, requireTrainer, requireAdmin, isAdmin, isTrainer, featureOn }) {
  const roles = u => ({ admin: isAdmin(u), trainer: isTrainer(u) });
  const staff = u => isAdmin(u) || isTrainer(u);
  const reply = (res, r) => (r.error ? json(res, r.status || 400, { error: r.error, ...(r.issues ? { issues: r.issues } : {}), ...(r.code ? { code: r.code } : {}) }) : json(res, 200, r));
  const off = (user, res) => {
    if (featureOn() || staff(user)) return false;
    json(res, 403, { error: 'esta función está desactivada por el gimnasio', code: 'feature_off' });
    return true;
  };
  return {
    'GET /api/premium': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      if (off(user, res)) return;
      const r = roles(user);
      json(res, 200, { enabled: featureOn(), rev: store.contentRev(), uid: user.id, canEdit: r.admin, canAuthor: r.trainer || r.admin, programs: store.listFor(user, r) });
    },
    // ?id= or ?slug= — the full program (with its definition), as this person may read it.
    'GET /api/premium/program': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      if (off(user, res)) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const p = store.detail(q.get('id') || q.get('slug') || '', user, roles(user));
      if (!p) return json(res, 404, { error: 'programa no encontrado' });
      json(res, 200, { program: p });
    },
    // body: { programId } — a member started a program (best effort; keeps usage honest). Never an error for the member.
    'POST /api/premium/started': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const body = await readBody(req);
      store.noteStarted(String(body?.programId || ''));
      json(res, 200, { ok: true });
    },
    // body: { program: { id?, scope?, ...editorial, programDefinition }, dryRun? }
    'POST /api/premium/save': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.upsert(user, isAdmin(user), body.program || {}, { dryRun: !!body.dryRun }));
    },
    // body: { id, catalog? } — a trainer copies into their own programs; an admin may copy into a catalogue draft (catalog: true).
    'POST /api/premium/duplicate': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.duplicate(user, isAdmin(user), isTrainer(user), String(body.id || ''), { catalog: !!body.catalog }));
    },
    // body: { id, status: 'draft' | 'published' | 'hidden' | 'archived' }
    'POST /api/premium/status': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.setStatus(user, isAdmin(user), String(body.id || ''), String(body.status || '')));
    },
    // body: { id, featured?, badge?, order? } — merchandising only (admin)
    'POST /api/premium/feature': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.curate(user, String(body.id || ''), body));
    },
    'POST /api/premium/reorder': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.reorder(user, body.ids));
    },
    'POST /api/premium/promote': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.promote(user, String(body.id || '')));
    },
    'POST /api/premium/delete': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.remove(user, isAdmin(user), String(body.id || '')));
    },
    'GET /api/premium/history': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      json(res, 200, { versions: store.historyOf(new URL(req.url, 'http://x').searchParams.get('id') || '') });
    },
    'POST /api/premium/restore': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.restoreVersion(user, String(body.id || ''), String(body.at || '')));
    },
  };
}
