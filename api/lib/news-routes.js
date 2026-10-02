// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Home news / notices. Any signed-in member reads the visible ones; every write is admin-only and is
 * checked here (trainers are refused too). Images reuse the private-upload storage (saveImage /
 * deleteImage from server.js) and are served by the existing GET /api/social/media?id=… */
import * as news from './news-store.js';

export function newsRoutes({ json, readBody, readSession, requireAdmin, saveImage, deleteImage }) {
  const reply = (res, r) => r.error ? json(res, r.status || 400, { error: r.error }) : json(res, 200, r);
  return {
    'GET /api/news': async (req, res) => {
      if (!readSession(req)) return json(res, 401, { error: 'no has iniciado sesión' });
      json(res, 200, { news: news.visible(), now: Date.now() });
    },
    'GET /api/admin/news': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { news: news.all(), now: Date.now() });
    },
    // body: { id?, title, body, accentColor, active, publishAt, expiresAt, imageData?: dataURL | null }
    // imageData sets a new image, null removes the current one, omitted keeps it.
    'POST /api/admin/news/save': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      const input = body && typeof body === 'object' ? { ...body } : {};
      delete input.image;
      let stored = null;
      if ('imageData' in input) {
        if (input.imageData === null) input.image = null;
        else { try { stored = saveImage(input.imageData); input.image = stored; } catch (e) { return json(res, 400, { error: e.message }); } }
      }
      delete input.imageData;
      const r = news.upsert(input);
      if (r.error) { if (stored) deleteImage(stored); return reply(res, r); }
      if (r.previousImage) deleteImage(r.previousImage);
      json(res, 200, { item: r.item });
    },
    'POST /api/admin/news/active': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const b = await readBody(req);
      reply(res, news.setActive(b?.id, b?.active));
    },
    'POST /api/admin/news/reorder': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const b = await readBody(req);
      reply(res, news.reorder(b?.ids));
    },
    'POST /api/admin/news/delete': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const b = await readBody(req);
      const r = news.remove(b?.id);
      if (r.image) deleteImage(r.image);
      reply(res, r.error ? r : { ok: true });
    },
  };
}
