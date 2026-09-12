/* HTTP surface for the Strava connection — factory taking server.js's own helpers, same shape as
 * api/coach/routes.js. Per-member tokens live encrypted on db.users[].stravaAuth (server.js owns
 * saving db.json; this module just mutates the user object it's handed and calls back into
 * `saveDb`), separate from the instance-level Client ID/Secret in ./config.js.
 */
import crypto from 'node:crypto';
import * as cfg from './config.js';
import * as oauth from './oauth.js';
import * as client from './client.js';
import { encrypt, decrypt } from '../lib/crypto.js';

const TOKEN_INFO = 'opengym-strava-token-v1';
const STATE_TTL = 10 * 60000;

export function stravaRoutes({ json, readBody, readSession, requireAdmin, saveDb, origin }) {
  // CSRF state for the authorize→callback round trip — short-lived, in-memory, one shot.
  const states = new Map(); // state -> { uid, exp }
  setInterval(() => { const now = Date.now(); for (const [k, v] of states) if (v.exp < now) states.delete(k); }, 60000).unref();

  const redirectUri = () => `${origin}/api/strava/callback`;

  async function validAccessToken(user) {
    const auth = user.stravaAuth;
    if (!auth) return null;
    const data = decrypt(auth.data, TOKEN_INFO);
    if (!data) return null;
    if (data.expires_at && data.expires_at * 1000 > Date.now() + 60000) return data.access_token;
    try {
      const fresh = await oauth.refreshTokens(data.refresh_token);
      user.stravaAuth = { ...auth, data: encrypt(fresh, TOKEN_INFO) };
      saveDb();
      return fresh.access_token;
    } catch { return null; }
  }

  return {
    'GET /api/strava/authorize': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      if (!cfg.isConfigured()) return json(res, 503, { error: 'Strava no está configurado en este servidor' });
      const state = crypto.randomBytes(16).toString('hex');
      states.set(state, { uid: user.id, exp: Date.now() + STATE_TTL });
      res.writeHead(302, { Location: oauth.authorizeUrl(redirectUri(), state) });
      res.end();
    },

    'GET /api/strava/callback': async (req, res) => {
      const user = readSession(req);
      const url = new URL(req.url, 'http://x');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const authError = url.searchParams.get('error');
      const back = `${origin}/#/connected-apps`;
      const entry = state ? states.get(state) : null;
      states.delete(state);
      if (!user || authError || !code || !entry || entry.uid !== user.id) {
        res.writeHead(302, { Location: back + '?strava=error' });
        return res.end();
      }
      try {
        const tokens = await oauth.exchangeCode(code);
        user.stravaAuth = { connectedAt: new Date().toISOString(), athleteId: tokens.athleteId, data: encrypt(tokens, TOKEN_INFO) };
        saveDb();
        res.writeHead(302, { Location: back + '?strava=connected' });
      } catch {
        res.writeHead(302, { Location: back + '?strava=error' });
      }
      res.end();
    },

    'POST /api/strava/disconnect': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      user.stravaAuth = null;
      saveDb();
      json(res, 200, { ok: true });
    },

    // Fire-and-forget from the client right after a workout finishes — always 200s (a disconnected
    // member, an unconfigured instance, or a Strava-side hiccup are all "nothing to do here",
    // never a reason to surface an error into the finish-workout flow).
    'POST /api/strava/activities': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      const body = await readBody(req);
      if (!user.stravaAuth) return json(res, 200, { ok: true, skipped: true });
      const token = await validAccessToken(user);
      if (!token) return json(res, 200, { ok: true, skipped: true });
      try { await client.createActivity(token, body); json(res, 200, { ok: true }); }
      catch (e) { json(res, 200, { ok: false, error: e.message }); }
    },

    /* ---------- admin: the one instance-wide Strava app ---------- */

    'GET /api/admin/strava/config': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { configured: cfg.isConfigured(), clientId: cfg.clientId() });
    },
    'POST /api/admin/strava/config': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      if (!String(body.clientId || '').trim() || !String(body.clientSecret || '').trim()) {
        return json(res, 400, { error: 'se requieren el Client ID y el Client Secret' });
      }
      cfg.save({ clientId: body.clientId, clientSecret: body.clientSecret });
      json(res, 200, { ok: true });
    },
    'POST /api/admin/strava/config/clear': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      cfg.clear();
      json(res, 200, { ok: true });
    }
  };
}
