/* Standard OAuth2 authorization-code + refresh-token grant against Whoop's public API
 * (https://developer.whoop.com). One Whoop app (Client ID/Secret, ./config.js) is registered
 * once by the instance owner; each member who connects authorizes that same app to their own
 * individual Whoop account.
 *
 * URLs/scopes verified 2026-09-12 against Whoop's own OAuth docs. `offline` is required to
 * receive a refresh token — without it Whoop only issues a short-lived access token. The
 * redirect_uri (built from ORIGIN in routes.js) must be registered byte-for-byte in the Whoop
 * Developer Dashboard for the app, or the authorize step will fail.
 */
import * as cfg from './config.js';

const AUTHORIZE_URL = 'https://api.prod.whoop.com/oauth/oauth2/auth';
const TOKEN_URL = 'https://api.prod.whoop.com/oauth/oauth2/token';
// offline is required to receive a refresh token; the rest are read-only recovery/sleep data.
const SCOPE = 'read:recovery read:sleep read:cycles read:profile offline';

export function authorizeUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: cfg.clientId(), redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, state
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function tokenRequest(body) {
  const params = new URLSearchParams({ client_id: cfg.clientId(), client_secret: cfg.clientSecret(), ...body });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error_description || data.error || 'la solicitud de token de Whoop falló');
  return data;
}

export async function exchangeCode(code, redirectUri) {
  const data = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: redirectUri });
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 0) };
}

export async function refreshTokens(refresh_token) {
  const data = await tokenRequest({ refresh_token, grant_type: 'refresh_token', scope: SCOPE });
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (data.expires_in || 0) };
}
