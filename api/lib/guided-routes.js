// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* /api/guided/* — "Entrena con 2J": the official guided routines and their collections.
 *
 * Reads: any signed-in person (the member catalogue). Writes, with the existing roles only:
 * trainers keep their own routines (duplicate, edit, delete — theirs alone); admins change the
 * official catalogue (content, active, featured/order/badge) and its collections. Assigning a
 * routine to a member is NOT here: it is the existing POST /api/trainer/member-routine, with the
 * routine copied in as a snapshot, so the same policy and Sync V2 receipts apply.
 */
import * as store from './guided-store.js';
import { PROTOCOL_VERSION } from './protocol/index.js';

export function guidedRoutes({ json, readBody, readSession, requireTrainer, requireAdmin, isAdmin, isTrainer, unavailableEq }) {
  const reply = (res, r) => r.error ? json(res, r.status || 400, { error: r.error, ...(r.validation ? { validation: r.validation } : {}) }) : json(res, 200, r);
  return {
    'GET /api/guided': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const admin = isAdmin(user), trainer = isTrainer(user);
      json(res, 200, { protocolVersion: PROTOCOL_VERSION, seed: store.seedInfo(), canEdit: admin, canAssign: trainer, uid: user.id,
        ...store.listFor(user, { trainer, admin }) });
    },
    // body: { routine: { id?, scope?: 'official', name, subtitle, description, category, goal, level, focus, ex, blocks, curatedTags?, customExDefs? } }
    'POST /api/guided/save': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.upsert(user, isAdmin(user), body.routine || {}, { unavailableEq: unavailableEq() }));
    },
    'POST /api/guided/duplicate': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.duplicate(user, String(body.id || '')));
    },
    'POST /api/guided/active': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.setActive(user, isAdmin(user), String(body.id || ''), body.active !== false));
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
    // body: { collection: { id?, name, description, style, order, active, routineIds } }
    'POST /api/guided/collection': async (req, res) => {
      const user = requireAdmin(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.saveCollection(user, body.collection || {}));
    },
  };
}
