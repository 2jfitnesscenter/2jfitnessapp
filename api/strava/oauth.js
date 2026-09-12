/* Standard OAuth2 authorization-code + refresh-token grant against Strava's public API
 * (https://developers.strava.com/docs/authentication/). One Strava app (Client ID/Secret,
 * ./config.js) is registered once by the instance owner; each member who connects authorizes
 * that same app to their own individual Strava account.
 */
import * as cfg from './config.js';

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
// activity:write to create the manual activity, activity:read_all only so Strava's own consent
// screen doesn't undersell what read access would otherwise imply — this integration never reads.
const SCOPE = 'activity:write';

export function authorizeUrl(redirectUri, state) {
  const params = new URLSearchParams({
    client_id: cfg.clientId(), redirect_uri: redirectUri, response_type: 'code',
    approval_prompt: 'auto', scope: SCOPE, state
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function tokenRequest(body) {
  const params = new URLSearchParams({ client_id: cfg.clientId(), client_secret: cfg.clientSecret(), ...body });
  const r = await fetch(TOKEN_URL, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.message || 'la solicitud de token de Strava falló');
  return data;
}

export async function exchangeCode(code) {
  const data = await tokenRequest({ code, grant_type: 'authorization_code' });
  return {
    athleteId: data.athlete?.id != null ? String(data.athlete.id) : null,
    access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at
  };
}

export async function refreshTokens(refresh_token) {
  const data = await tokenRequest({ refresh_token, grant_type: 'refresh_token' });
  return { access_token: data.access_token, refresh_token: data.refresh_token, expires_at: data.expires_at };
}
