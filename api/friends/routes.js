// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* HTTP surface for Amigos (friends) — a factory taking server.js's own helpers rather than
 * importing them, same reasoning as api/coach/routes.js: readSession/sendPush are closures over
 * db and the session secret, and passing them in keeps this module free of a cycle.
 */
import * as store from './store.js';
import * as notifications from '../notifications/store.js';
import { canViewProfile } from '../notifications/privacy.js';
import { LIMITS, REQUEST_COOLDOWN_MS } from '../lib/social-limits.js';

export function friendsRoutes({ json, readBody, readSession, sendPush, users, notify = () => {}, limit = () => ({ ok: true }), now = Date.now }) {
  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
    return user;
  };
  const throttle = (res, user, [bucket, max, windowMs]) => {
    const r = limit(user.id, bucket, max, windowMs);
    if (r.ok) return false;
    json(res, 429, { error: 'demasiadas solicitudes; espera un poco', code: 'rate_limited' }, { 'Retry-After': String(r.retryAfter) });
    return true;
  };
  const publicOf = u => (u ? { id: u.id, name: u.name } : null);
  const findById = id => users().find(u => u.id === id);
  const findByUsername = username => users().find(u => u.username === username);

  return {
    'GET /api/friends': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const friends = store.friendIdsOf(me.id).map(id => publicOf(findById(id))).filter(Boolean);
      const incoming = store.incomingOf(me.id).map(r => ({ id: r.id, from: publicOf(findById(r.fromId)), createdAt: r.createdAt }));
      const outgoing = store.outgoingOf(me.id).map(r => ({ id: r.id, to: publicOf(findById(r.toId)), createdAt: r.createdAt }));
      const blocked = store.blockedOf(me.id).map(id => publicOf(findById(id))).filter(Boolean);
      json(res, 200, { friends, incoming, outgoing, blocked });
    },

    'GET /api/friends/code': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      json(res, 200, { code: store.codeFor(me.id) });
    },

    'POST /api/friends/code/reset': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      json(res, 200, { code: store.resetCode(me.id) });
    },

    'POST /api/friends/lookup': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      if (throttle(res, me, LIMITS.lookup)) return;
      const username = String(body.username || '').trim().toLowerCase();
      if (!username) return json(res, 400, { error: 'se requiere un nombre de usuario' });
      const u = findByUsername(username);
      if (!u) return json(res, 404, { error: 'no existe ningún usuario con ese nombre' });
      if (u.id === me.id) return json(res, 400, { error: 'ese eres tú' });
      json(res, 200, { user: publicOf(u) });
    },

    // body: { code } (from a shared QR/link) or { username } — either resolves to the same
    // pending-request flow.
    'POST /api/friends/request': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      if (throttle(res, me, LIMITS.friendRequest)) return;
      let target = null;
      if (body.code) target = findById(store.userIdForCode(String(body.code)));
      else if (body.username) target = findByUsername(String(body.username).trim().toLowerCase());
      if (!target) return json(res, 404, { error: 'no se ha encontrado a esa persona' });
      if (target.id === me.id) return json(res, 400, { error: 'no puedes añadirte a ti mismo' });
      if (store.isBlocked(target.id, me.id) || store.isBlocked(me.id, target.id)) return json(res, 404, { error: 'no se ha encontrado a esa persona' });
      const existing = store.activeStatusBetween(me.id, target.id);
      if (existing?.status === 'accepted') return json(res, 400, { error: 'ya sois amigos' });
      if (existing?.status === 'pending') return json(res, 400, { error: 'ya hay una solicitud pendiente' });
      const declinedAt = store.lastDeclineBetween(me.id, target.id);
      if (declinedAt && now() - declinedAt < REQUEST_COOLDOWN_MS) {
        const wait = Math.ceil((declinedAt + REQUEST_COOLDOWN_MS - now()) / 1000);
        return json(res, 429, { error: 'no puedes enviar otra solicitud a esta persona todavía', code: 'cooldown' }, { 'Retry-After': String(wait) });
      }
      const request = store.createRequest(me.id, target.id);
      notify(target.id, { type: 'friend_request', actor: { id: me.id, name: me.name }, target: { kind: 'friend-request', id: request.id }, deepLink: '/friends' });
      sendPush(target.id, { title: 'Nueva solicitud de amistad', body: `${me.name} quiere añadirte como amigo`, tag: 'friend-request', url: '#/friends' });
      json(res, 200, { ok: true, request });
    },

    'POST /api/friends/accept': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      const request = store.findRequest(body.requestId);
      if (!request || request.toId !== me.id || request.status !== 'pending') return json(res, 404, { error: 'esa solicitud ya no existe' });
      store.respond(request.id, 'accepted');
      notify(request.fromId, { type: 'friend_accepted', actor: { id: me.id, name: me.name }, target: { kind: 'friend', id: me.id }, deepLink: '/friends' });
      sendPush(request.fromId, { title: 'Solicitud aceptada', body: `${me.name} ha aceptado tu solicitud de amistad`, tag: 'friend-accept', url: '#/friends' });
      json(res, 200, { ok: true, friend: publicOf(findById(request.fromId)) });
    },

    'POST /api/friends/decline': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      const request = store.findRequest(body.requestId);
      if (!request || request.toId !== me.id || request.status !== 'pending') return json(res, 404, { error: 'esa solicitud ya no existe' });
      store.respond(request.id, 'declined');
      json(res, 200, { ok: true });
    },

    // Sender-side withdrawal of a still-pending outgoing request — the counterpart to decline.
    'POST /api/friends/cancel': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      const request = store.findRequest(body.requestId);
      if (!request || request.fromId !== me.id || request.status !== 'pending') return json(res, 404, { error: 'esa solicitud ya no existe' });
      store.respond(request.id, 'cancelled');
      json(res, 200, { ok: true });
    },

    'POST /api/friends/remove': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      store.removeFriendship(me.id, String(body.friendId || ''));
      json(res, 200, { ok: true });
    },

    'POST /api/friends/block': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req); const id = String(body.userId || '');
      if (!findById(id) || id === me.id) return json(res, 400, { error: 'socio no válido' });
      store.blockUser(me.id, id); json(res, 200, { ok: true });
    },

    'POST /api/friends/unblock': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req); store.unblockUser(me.id, String(body.userId || '')); json(res, 200, { ok: true });
    },

    'GET /api/social/profile': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const id = new URL(req.url, 'http://x').searchParams.get('id') || me.id;
      const target = findById(id); if (!target) return json(res, 404, { error: 'perfil no disponible' });
      if (store.isBlocked(id, me.id) || store.isBlocked(me.id, id)) return json(res, 404, { error: 'perfil no disponible' });
      const pref = notifications.privacyFor(id);
      const allowed = canViewProfile({ profileId: id, viewerId: me.id, privacy: pref, isFriend: (a, b) => store.friendIdsOf(b).includes(a), blocked: store.isBlocked(id, me.id) || store.isBlocked(me.id, id) });
      if (!allowed) return json(res, 403, { error: 'este perfil es privado' });
      // Strict allow-list: health, measurements, admin fields, restrictions and notes never leave the server.
      json(res, 200, { profile: { id: target.id, name: target.name, avatar: target.avatar || null, isFriend: store.friendIdsOf(me.id).includes(id) } });
    }
  };
}
