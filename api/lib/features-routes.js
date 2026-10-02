// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* App feature switches. Any signed-in user reads them; only an admin writes (trainers are refused). */
import * as features from './features-store.js';

export function featuresRoutes({ json, readBody, readSession, requireAdmin }) {
  return {
    'GET /api/features': async (req, res) => {
      if (!readSession(req)) return json(res, 401, { error: 'no has iniciado sesión' });
      json(res, 200, { features: features.all(), updatedAt: features.updatedAt() });
    },
    // body: { features: { key: boolean, … } }  (only the keys being changed)
    'POST /api/admin/features': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const r = features.set(body && typeof body === 'object' ? body.features : null);
      if (r.error) return json(res, r.status || 400, { error: r.error });
      json(res, 200, r);
    },
  };
}
