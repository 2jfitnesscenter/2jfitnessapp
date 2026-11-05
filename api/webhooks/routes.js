// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Member-owned webhook endpoints. Same auth as the other member routes: a normal session cookie for the caller's own account, nothing else.
   Off unless the server runs with WEBHOOKS_ENABLED=1 (every route answers 403 webhooks_disabled). The signing secret is returned
   exactly once, by POST /api/webhooks and POST /api/webhooks/rotate; no read route ever returns it. */
import { WEBHOOK_EVENTS, DEFAULT_EVENTS } from './events.js';

export function webhookRoutes({ json, readBody, readSession, store, service }) {
  const guard = (req, res) => {
    const u = readSession(req);
    if (!u) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
    if (!service.enabled()) { json(res, 403, { error: 'los webhooks están desactivados en este servidor', code: 'webhooks_disabled' }); return null; }
    return u;
  };
  const fail = (res, code) => {
    const status = { WEBHOOK_NOT_FOUND: 404, WEBHOOK_LIMIT: 409 }[code] || 400;
    const msg = {
      WEBHOOK_NOT_FOUND: 'webhook no encontrado',
      WEBHOOK_LIMIT: 'has alcanzado el número máximo de webhooks',
      WEBHOOK_EVENTS_INVALID: 'tipo de evento no permitido',
    }[code] || 'dirección no válida: solo https:// en el puerto 443, sin credenciales y sin redes privadas';
    json(res, status, { error: msg, code });
  };
  return {
    'GET /api/webhooks': async (req, res) => {
      const u = guard(req, res); if (!u) return;
      json(res, 200, { endpoints: store.list(u.id), deliveries: store.deliveriesFor(u.id), events: [...WEBHOOK_EVENTS], defaultEvents: [...DEFAULT_EVENTS] });
    },
    'POST /api/webhooks': async (req, res) => {
      const u = guard(req, res); if (!u) return;
      const b = await readBody(req, 4096);
      const out = store.create({ uid: u.id, url: b.url, events: b.events });
      if (out.error) return fail(res, out.error);
      // Shown once: this response is the only place the secret is ever returned.
      json(res, 201, { endpoint: out.endpoint, secret: out.secret, secretShownOnce: true });
    },
    'POST /api/webhooks/update': async (req, res) => {
      const u = guard(req, res); if (!u) return;
      const b = await readBody(req, 2048);
      const out = store.update({ uid: u.id, id: String(b.id || ''), enabled: b.enabled, events: b.events });
      if (out.error) return fail(res, out.error);
      json(res, 200, { endpoint: out.endpoint });
    },
    'POST /api/webhooks/rotate': async (req, res) => {
      const u = guard(req, res); if (!u) return;
      const b = await readBody(req, 2048);
      const out = store.rotate({ uid: u.id, id: String(b.id || '') });
      if (out.error) return fail(res, out.error);
      json(res, 200, { endpoint: out.endpoint, secret: out.secret, secretShownOnce: true });
    },
    'POST /api/webhooks/delete': async (req, res) => {
      const u = guard(req, res); if (!u) return;
      const b = await readBody(req, 2048);
      const out = store.remove({ uid: u.id, id: String(b.id || '') });
      if (out.error) return fail(res, out.error);
      json(res, 200, { ok: true });
    },
  };
}
