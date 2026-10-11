// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* /api/opposition/* — the Oposiciones profile catalogue.
 *
 * Reads: any signed-in person gets the published profiles; an administrator gets all of them (drafts, hidden and archived too). The feature follows the
 * same `premium` switch as the Premium catalogue it lives in: OFF → members get 403 feature_off, staff keep working so profiles can be prepared; a plan
 * already under way is unaffected (it lives in the member's own state with its pinned profile snapshot).
 * Writes: administrators only (create, edit, version, publish, hide, archive). A trainer can read; nothing else.
 */
import * as store from './opposition-store.js';

export function oppositionRoutes({ json, readBody, readSession, requireAdmin, isAdmin, isTrainer, featureOn }) {
  const reply = (res, r) => (r.error ? json(res, r.status || 400, { error: r.error, ...(r.issues ? { issues: r.issues } : {}), ...(r.code ? { code: r.code } : {}) }) : json(res, 200, r));
  const off = (user, res) => {
    if (featureOn() || isAdmin(user) || isTrainer(user)) return false;
    json(res, 403, { error: 'esta función está desactivada por el gimnasio', code: 'feature_off' });
    return true;
  };
  return {
    'GET /api/opposition': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      if (off(user, res)) return;
      json(res, 200, { enabled: featureOn(), rev: store.contentRev(), canEdit: isAdmin(user), profiles: store.listFor({ admin: isAdmin(user) }) });
    },
    // ?id= or ?slug= — the full profile (with every test and scale), as this person may read it.
    'GET /api/opposition/profile': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      if (off(user, res)) return;
      const q = new URL(req.url, 'http://x').searchParams;
      const p = store.detail(q.get('id') || q.get('slug') || '', { admin: isAdmin(user) });
      if (!p) return json(res, 404, { error: 'perfil no encontrado' });
      json(res, 200, { profile: p });
    },
    // A member's plan pins a version: this serves exactly that version while it is kept (the live one, or the history for the admin), so a screen can show "what changed".
    'GET /api/opposition/version': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const q = new URL(req.url, 'http://x').searchParams;
      const id = q.get('id') || '', version = Number(q.get('version'));
      const live = store.detail(id, { admin: isAdmin(user) });
      const p = live && live.version === version ? live : (isAdmin(user) ? store.versionOf(id, version) : null);
      if (!p) return json(res, 404, { error: 'versión no disponible' });
      json(res, 200, { profile: p });
    },
    // body: { profileId } — a member started a plan (best effort; keeps usage honest). Never an error for the member.
    'POST /api/opposition/started': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const body = await readBody(req);
      store.noteStarted(String(body?.profileId || ''));
      json(res, 200, { ok: true });
    },
    // body: { profile: { id?, ...fields }, dryRun? }
    'POST /api/opposition/save': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.upsert(user, body.profile || {}, { dryRun: !!body.dryRun }));
    },
    // body: { id, status: 'draft' | 'published' | 'hidden' | 'archived' }
    'POST /api/opposition/status': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.setStatus(user, String(body.id || ''), String(body.status || '')));
    },
    'POST /api/opposition/delete': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.remove(user, String(body.id || '')));
    },
    'GET /api/opposition/history': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      json(res, 200, { versions: store.historyOf(new URL(req.url, 'http://x').searchParams.get('id') || '') });
    },
  };
}
