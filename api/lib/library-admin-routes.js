// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* /api/admin/library/* — Exercise Library quality, curated from the app (admin only).
 *
 * Reads for every client go through the public GET /api/config (`libraryOverlay`, without the
 * admin-only notes), exactly like the gym's equipment, so the corrections reach offline caches
 * the same way. Writes are admin-only and every rule (no chains or cycles, same movement, real
 * ids, unambiguous names, never a duplicate that active official content still uses) runs here.
 */
import * as library from './library-admin.js';

export function libraryAdminRoutes({ json, readBody, requireAdmin }) {
  const reply = (res, r) => r.error ? json(res, r.status || 400, { error: r.error, ...(r.errors ? { errors: r.errors } : {}) }) : json(res, 200, r);
  return {
    // The full overlay, notes included, for the admin tool.
    'GET /api/admin/library': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { overlay: library.overlay() });
    },
    // body: { id, patch: { n?, es?, aliases?, movement?, equipment?, recommended?, preferredId?, note? } }
    //     | { id, reset: true } | { variant: [a, b], keep: true|false }
    'POST /api/admin/library/save': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      reply(res, library.edit(body && typeof body === 'object' ? body : {}));
    },
  };
}
