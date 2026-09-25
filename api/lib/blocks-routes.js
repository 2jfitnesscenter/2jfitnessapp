/* /api/blocks/* — the block library for the trainer builder (Constructor V2).
 *
 * Reuses the existing roles only: any trainer (requireTrainer, which admins pass too) reads the
 * library and manages their OWN personal blocks; official blocks are admin-only. Every write is
 * validated server-side under the 2J protocol (lib/blocks-store.js); a FAIL is never stored.
 * Members never reach these routes — a block reaches a member only as a copy inside a routine.
 */
import * as store from './blocks-store.js';
import { PROTOCOL_VERSION } from './protocol/index.js';

export function blocksRoutes({ json, readBody, requireTrainer, isAdmin, unavailableEq }) {
  const reply = (res, r) => r.error ? json(res, r.status || 400, { error: r.error, ...(r.validation ? { validation: r.validation } : {}) }) : json(res, 200, r);
  return {
    'GET /api/blocks': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const admin = isAdmin(user);
      json(res, 200, { protocolVersion: PROTOCOL_VERSION, seed: store.seedInfo(), canEditOfficial: admin, uid: user.id, ...store.listFor(user.id, admin) });
    },
    // body: { block: {id?, scope?:'official', name, goal, level, focus, type, variant, style, description, reason, ex, customExDefs?} }
    'POST /api/blocks/save': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.upsert(user, isAdmin(user), body.block || {}, { unavailableEq: unavailableEq() }));
    },
    'POST /api/blocks/duplicate': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.duplicate(user, String(body.id || '')));
    },
    'POST /api/blocks/active': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.setActive(user, isAdmin(user), String(body.id || ''), body.active !== false));
    },
    'POST /api/blocks/delete': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.remove(user, isAdmin(user), String(body.id || '')));
    },
    'POST /api/blocks/favorite': async (req, res) => {
      const user = requireTrainer(req, res); if (!user) return;
      const body = await readBody(req);
      reply(res, store.favorite(user, String(body.id || ''), body.on !== false));
    },
  };
}
