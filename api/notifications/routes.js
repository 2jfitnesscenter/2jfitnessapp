import * as store from './store.js';

export function notificationRoutes({ json, readBody, readSession }) {
  const guard = (req, res) => { const u = readSession(req); if (!u) { json(res, 401, { error: 'no has iniciado sesión' }); return null; } return u; };
  return {
    'GET /api/notifications': async (req, res) => { const u = guard(req, res); if (!u) return; json(res, 200, { notifications: store.list(u.id), unread: store.unreadCount(u.id) }); },
    'POST /api/notifications/read': async (req, res) => { const u = guard(req, res); if (!u) return; const b = await readBody(req); if (!store.markRead(u.id, String(b.id || ''))) return json(res, 404, { error: 'notificación no encontrada' }); json(res, 200, { ok: true, unread: store.unreadCount(u.id) }); },
    'POST /api/notifications/read-all': async (req, res) => { const u = guard(req, res); if (!u) return; store.markAllRead(u.id); json(res, 200, { ok: true, unread: 0 }); },
    'GET /api/social/preferences': async (req, res) => { const u = guard(req, res); if (!u) return; json(res, 200, { privacy: store.privacyFor(u.id), notifications: store.preferencesFor(u.id) }); },
    'POST /api/social/preferences': async (req, res) => { const u = guard(req, res); if (!u) return; const b = await readBody(req); const privacy = b.privacy ? store.setPrivacy(u.id, b.privacy) : store.privacyFor(u.id); const notifications = b.notifications ? store.setPreferences(u.id, b.notifications) : store.preferencesFor(u.id); json(res, 200, { privacy, notifications }); }
  };
}
