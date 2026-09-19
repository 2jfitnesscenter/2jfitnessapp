/* HTTP surface for the Bunker (gym-floor kiosk). Same factory-of-closures shape as
 * friends/routes.js — server.js's own helpers are passed in rather than imported, so this
 * module never needs to know about `db` or the session secret directly.
 *
 * Three trust levels meet here, and keeping them straight is the entire point of this file:
 *  - a normal signed-in session (readSession/cookie) — a member's own phone, e.g. reading/
 *    resetting their own check-in PIN, or a trainer/admin managing the room from their phone.
 *  - a bunker token (Authorization: Bearer, minted by /checkin) — the shared kiosk screen,
 *    scoped to exactly one checked-in member and nothing else: it can read that member's
 *    today's plan and recent results, write their in-progress workout, and finish it. It
 *    cannot touch measurements, settings, social, chat, or any other member's data — there is
 *    no generic "read/write this account's whole state" route reachable with it.
 *  - an admin-kiosk token (Authorization: Bearer, minted by /admin-checkin from a trainer's own
 *    FIXED code entered on the shared screen itself) — read the room's live sessions and close
 *    one, nothing else.
 */
import * as store from './store.js';
import { readState, writeState } from '../lib/state-store.js';

const PIN_TOKEN_TTL = 4 * 3600000;      // a training session comfortably fits in 4 hours
const ADMIN_TOKEN_TTL = 30 * 60000;     // the kiosk's own admin overlay re-locks after 30 min

export function bunkerRoutes({ json, readBody, readSession, sign, verifySig, users, isTrainer }) {
  const bearer = req => {
    const h = req.headers.authorization || '';
    return h.startsWith('Bearer ') ? h.slice(7) : '';
  };
  const readBunkerToken = req => {
    const payload = verifySig(bearer(req));
    if (!payload) return null;
    const [kind, uid, exp] = payload.split(':');
    if (kind !== 'bunker' || Date.now() > Number(exp)) return null;
    return uid;
  };
  const readAdminToken = req => {
    const payload = verifySig(bearer(req));
    if (!payload) return null;
    const [kind, uid, exp] = payload.split(':');
    if (kind !== 'bunker-admin' || Date.now() > Number(exp)) return null;
    return uid;
  };
  // The two ways to reach the admin endpoints: the trainer's own phone (normal cookie), or the
  // kiosk's admin overlay (its own short-lived token, from the trainer's fixed code).
  const guardAdmin = req => {
    const cookieUser = readSession(req);
    if (cookieUser && isTrainer(cookieUser)) return cookieUser.id;
    const kioskUid = readAdminToken(req);
    if (kioskUid) return kioskUid;
    return null;
  };
  const publicName = uid => (users().find(u => u.id === uid) || {}).name || 'Socio';

  return {
    /* ---------- a member's own PIN (their phone, normal session) ---------- */
    'GET /api/bunker/pin': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'no has iniciado sesión' });
      json(res, 200, { pin: store.pinFor(me.id) });
    },
    'POST /api/bunker/pin/reset': async (req, res) => {
      const me = readSession(req);
      if (!me) return json(res, 401, { error: 'no has iniciado sesión' });
      json(res, 200, { pin: store.resetPin(me.id) });
    },
    // A trainer/admin's own fixed kiosk-unlock code — generated once, never reset (see
    // store.js's own comment on why).
    'GET /api/bunker/admin-code': async (req, res) => {
      const me = readSession(req);
      if (!me || !isTrainer(me)) return json(res, 401, { error: 'no autorizado' });
      json(res, 200, { code: store.adminCodeFor(me.id) });
    },

    /* ---------- the shared kiosk screen — no session of its own ---------- */
    'GET /api/bunker/board': async (req, res) => {
      json(res, 200, { sessions: store.listSessions().map(s => ({
        uid: s.uid, name: s.name, exName: s.exName, setIdx: s.setIdx, setsTotal: s.setsTotal, restEndsAt: s.restEndsAt,
      })) });
    },
    'GET /api/bunker/settings': async (req, res) => json(res, 200, store.getSettings()),

    // body: { pin }. A wrong PIN just fails — no lockout/rate-limit yet (4 digits over a LAN
    // kiosk, not an internet-facing login; worth revisiting if this ever needs to survive a
    // hostile network, not just a crowded gym floor).
    'POST /api/bunker/checkin': async (req, res) => {
      const body = await readBody(req);
      const pin = String(body.pin || '').trim();
      const uid = store.userIdForPin(pin);
      if (!uid) return json(res, 400, { error: 'PIN incorrecto' });
      const name = publicName(uid);
      store.startSession(uid, name);
      const exp = Date.now() + PIN_TOKEN_TTL;
      json(res, 200, { token: sign('bunker:' + uid + ':' + exp), exp, uid, name });
    },

    // Today's plan + recent results — deliberately narrow (see the module doc comment above):
    // the routine for today, a trimmed slice of recent finished workouts (for "last time"
    // reference), any in-progress S.active (resuming after a minimize), and the handful of
    // other fields the logger UI itself needs (exWeights, customEx, unit). Never the whole S.
    'GET /api/bunker/session': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      const S = readState(uid) || {};
      json(res, 200, {
        name: publicName(uid),
        unit: S.unit || 'kg',
        week: S.week || {},
        routines: S.routines || [],
        customEx: S.customEx || [],
        exWeights: S.exWeights || {},
        recentWorkouts: (S.workouts || []).slice(-40),
        active: S.active || null,
      });
    },

    // body: { active, exName, setIdx, setsTotal } — the in-progress workout (same shape the
    // phone logger already builds) plus what the room dashboard's card should show right now.
    // Written to S.active only — see the module doc comment on why nothing else is reachable.
    'POST /api/bunker/active': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      const body = await readBody(req);
      const S = readState(uid) || {};
      S.active = body.active || null;
      writeState(uid, S);
      store.touchSession(uid, { exId: body.exId || null, exName: body.exName || null, setIdx: body.setIdx || 0, setsTotal: body.setsTotal || 0 });
      json(res, 200, { ok: true });
    },

    // body: { sec } — starts (or extends) the room dashboard's own rest countdown for this
    // member's card; the kiosk ticks it down locally from restEndsAt, same as the phone
    // logger's own rest timer does, so this is just telling every OTHER screen what to show.
    'POST /api/bunker/rest': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      const body = await readBody(req);
      const sec = Math.max(0, Math.min(1800, Number(body.sec) || 0));
      store.touchSession(uid, { restEndsAt: sec ? Date.now() + sec * 1000 : null });
      json(res, 200, { ok: true });
    },

    // body: { workout } — a fully-formed finished-workout object (the kiosk builds it with the
    // exact same lib/history.js helpers the phone logger uses to finish one; this endpoint just
    // appends it where the server trusts the token's own uid to put it, not wherever the
    // request claims). Clears S.active and the room-dashboard card in the same call.
    'POST /api/bunker/finish': async (req, res) => {
      const uid = readBunkerToken(req);
      if (!uid) return json(res, 401, { error: 'sesión de bunker no válida' });
      const body = await readBody(req);
      const w = body.workout;
      if (!w || !w.d || !Array.isArray(w.entries)) return json(res, 400, { error: 'entreno no válido' });
      const S = readState(uid) || {};
      const workouts = [...(S.workouts || [])];
      let i = workouts.length;
      while (i > 0 && workouts[i - 1].d > w.d) i--;
      workouts.splice(i, 0, w);
      S.workouts = workouts;
      S.active = null;
      writeState(uid, S);
      store.endSession(uid);
      json(res, 200, { ok: true });
    },

    // Minimizing back to the room dashboard without ending the session — the kiosk just stops
    // showing the member's own panel; their card (and any running rest countdown) stays on the
    // board exactly as /active or /rest last left it. Nothing to do server-side, so there is no
    // endpoint for it — this comment exists so that absence reads as a decision, not a gap.

    /* ---------- room admin — a trainer's phone, or the kiosk's own admin-code overlay ---------- */
    'POST /api/bunker/admin-checkin': async (req, res) => {
      const body = await readBody(req);
      const code = String(body.code || '').trim();
      const uid = store.userIdForAdminCode(code);
      if (!uid) return json(res, 400, { error: 'código incorrecto' });
      const exp = Date.now() + ADMIN_TOKEN_TTL;
      json(res, 200, { token: sign('bunker-admin:' + uid + ':' + exp), exp });
    },
    'GET /api/bunker/admin/sessions': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      json(res, 200, { sessions: store.listSessions() });
    },
    'POST /api/bunker/admin/close': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const body = await readBody(req);
      if (!body.uid) return json(res, 400, { error: 'falta uid' });
      store.endSession(String(body.uid));
      json(res, 200, { ok: true });
    },
    'POST /api/bunker/admin/settings': async (req, res) => {
      const admin = guardAdmin(req);
      if (!admin) return json(res, 401, { error: 'no autorizado' });
      const body = await readBody(req);
      const patch = {};
      if (Number.isFinite(body.columns)) patch.columns = Math.max(2, Math.min(8, Math.round(body.columns)));
      if (typeof body.soundAlerts === 'boolean') patch.soundAlerts = body.soundAlerts;
      if (typeof body.header === 'string') patch.header = body.header.slice(0, 60);
      json(res, 200, store.setSettings(patch));
    },
  };
}
