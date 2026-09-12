/* HTTP surface for the Whoop connection — factory taking server.js's own helpers, same shape as
 * api/strava/routes.js and api/coach/routes.js. Per-member tokens live encrypted on
 * db.users[].whoopAuth; the instance-level Client ID/Secret lives in ./config.js.
 */
import crypto from 'node:crypto';
import * as cfg from './config.js';
import * as oauth from './oauth.js';
import * as client from './client.js';
import { encrypt, decrypt } from '../lib/crypto.js';

const TOKEN_INFO = 'opengym-whoop-token-v1';
const STATE_TTL = 10 * 60000;
const RECOVERY_CACHE_MS = 15 * 60000;   // recovery only updates once a day — no reason to refetch every Home visit

export function whoopRoutes({ json, readBody, readSession, requireAdmin, saveDb, origin }) {
  const states = new Map(); // state -> { uid, exp }
  setInterval(() => { const now = Date.now(); for (const [k, v] of states) if (v.exp < now) states.delete(k); }, 60000).unref();
  const recoveryCache = new Map(); // uid -> { data, exp }

  const redirectUri = () => `${origin}/api/whoop/callback`;

  async function validAccessToken(user) {
    const auth = user.whoopAuth;
    if (!auth) return null;
    const data = decrypt(auth.data, TOKEN_INFO);
    if (!data) return null;
    if (data.expires_at && data.expires_at * 1000 > Date.now() + 60000) return data.access_token;
    try {
      const fresh = await oauth.refreshTokens(data.refresh_token);
      user.whoopAuth = { ...auth, data: encrypt(fresh, TOKEN_INFO) };
      saveDb();
      return fresh.access_token;
    } catch { return null; }
  }

  return {
    'GET /api/whoop/authorize': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      if (!cfg.isConfigured()) return json(res, 503, { error: 'Whoop no está configurado en este servidor' });
      const state = crypto.randomBytes(16).toString('hex');
      states.set(state, { uid: user.id, exp: Date.now() + STATE_TTL });
      res.writeHead(302, { Location: oauth.authorizeUrl(redirectUri(), state) });
      res.end();
    },

    'GET /api/whoop/callback': async (req, res) => {
      const user = readSession(req);
      const url = new URL(req.url, 'http://x');
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const authError = url.searchParams.get('error');
      const back = `${origin}/#/connected-apps`;
      const entry = state ? states.get(state) : null;
      states.delete(state);
      if (!user || authError || !code || !entry || entry.uid !== user.id) {
        res.writeHead(302, { Location: back + '?whoop=error' });
        return res.end();
      }
      try {
        const tokens = await oauth.exchangeCode(code, redirectUri());
        user.whoopAuth = { connectedAt: new Date().toISOString(), data: encrypt(tokens, TOKEN_INFO) };
        saveDb();
        res.writeHead(302, { Location: back + '?whoop=connected' });
      } catch {
        res.writeHead(302, { Location: back + '?whoop=error' });
      }
      res.end();
    },

    'POST /api/whoop/disconnect': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      user.whoopAuth = null;
      recoveryCache.delete(user.id);
      saveDb();
      json(res, 200, { ok: true });
    },

    'GET /api/whoop/recovery': async (req, res) => {
      const user = readSession(req);
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' });
      if (!user.whoopAuth) return json(res, 200, { connected: false });
      const cached = recoveryCache.get(user.id);
      if (cached && cached.exp > Date.now()) return json(res, 200, { connected: true, recovery: cached.data });
      const token = await validAccessToken(user);
      if (!token) return json(res, 200, { connected: false });
      try {
        const recovery = await client.fetchLatestRecovery(token);
        recoveryCache.set(user.id, { data: recovery, exp: Date.now() + RECOVERY_CACHE_MS });
        json(res, 200, { connected: true, recovery });
      } catch (e) { json(res, 200, { connected: true, recovery: null, error: e.message }); }
    },

    /* ---------- admin: the one instance-wide Whoop app ---------- */

    'GET /api/admin/whoop/config': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      json(res, 200, { configured: cfg.isConfigured(), clientId: cfg.clientId() });
    },
    'POST /api/admin/whoop/config': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      const body = await readBody(req);
      if (!String(body.clientId || '').trim() || !String(body.clientSecret || '').trim()) {
        return json(res, 400, { error: 'se requieren el Client ID y el Client Secret' });
      }
      cfg.save({ clientId: body.clientId, clientSecret: body.clientSecret });
      json(res, 200, { ok: true });
    },
    'POST /api/admin/whoop/config/clear': async (req, res) => {
      if (!requireAdmin(req, res)) return;
      cfg.clear();
      json(res, 200, { ok: true });
    }
  };
}
