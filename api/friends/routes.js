/* HTTP surface for Amigos (friends) — a factory taking server.js's own helpers rather than
 * importing them, same reasoning as api/coach/routes.js: readSession/sendPush are closures over
 * db and the session secret, and passing them in keeps this module free of a cycle.
 */
import * as store from './store.js';

export function friendsRoutes({ json, readBody, readSession, sendPush, users }) {
  const guard = (req, res) => {
    const user = readSession(req);
    if (!user) { json(res, 401, { error: 'no has iniciado sesión' }); return null; }
    return user;
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
      json(res, 200, { friends, incoming, outgoing });
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
      let target = null;
      if (body.code) target = findById(store.userIdForCode(String(body.code)));
      else if (body.username) target = findByUsername(String(body.username).trim().toLowerCase());
      if (!target) return json(res, 404, { error: 'no se ha encontrado a esa persona' });
      if (target.id === me.id) return json(res, 400, { error: 'no puedes añadirte a ti mismo' });
      const existing = store.activeStatusBetween(me.id, target.id);
      if (existing?.status === 'accepted') return json(res, 400, { error: 'ya sois amigos' });
      if (existing?.status === 'pending') return json(res, 400, { error: 'ya hay una solicitud pendiente' });
      const request = store.createRequest(me.id, target.id);
      sendPush(target.id, { title: 'Nueva solicitud de amistad', body: `${me.name} quiere añadirte como amigo`, tag: 'friend-request', url: '#/friends' });
      json(res, 200, { ok: true, request });
    },

    'POST /api/friends/accept': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      const request = store.findRequest(body.requestId);
      if (!request || request.toId !== me.id || request.status !== 'pending') return json(res, 404, { error: 'esa solicitud ya no existe' });
      store.respond(request.id, 'accepted');
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
      store.respond(request.id, 'declined');
      json(res, 200, { ok: true });
    },

    'POST /api/friends/remove': async (req, res) => {
      const me = guard(req, res); if (!me) return;
      const body = await readBody(req);
      store.removeFriendship(me.id, String(body.friendId || ''));
      json(res, 200, { ok: true });
    }
  };
}
