import crypto from 'node:crypto';

// F9b · 2J-SERVICE-AUTH-V1 receiver for the NEW Platform -> Training routes (2JHub contract §1).
// Separate from platform-proof/service-auth.js on purpose: that one stays POST-only with ±60 s for the proof routes and is not modified.
// Here: GET and POST, ±30 s, exact allowlist (method + path, query signed as sent), dedicated key ids, constant-time comparison.
// Replay protection (single-use requestId) is applied by the caller with the shared, persisted store.

export const HUB_SERVICE_AUTH_FRESHNESS_MS = 30_000;
const KEY_ID = /^[A-Za-z0-9._-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;
const TIMESTAMP = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;

export function canonicalString({ keyId, timestamp, requestId, method, target, body }) {
  const digest = crypto.createHash('sha256').update(body).digest('hex');
  return { digest, canonical: ['2J-SERVICE-AUTH-V1', keyId, timestamp, requestId, method, target, digest].join('\n') };
}

export function signHubRequest({ keyId, secret, timestamp, requestId, method, target, body = Buffer.alloc(0) }) {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(body, 'utf8');
  const { canonical, digest } = canonicalString({ keyId, timestamp, requestId, method, target, body: bytes });
  return { canonical, digest, signature: crypto.createHmac('sha256', secret).update(Buffer.from(canonical, 'utf8')).digest('base64url') };
}

/**
 * @param allow  [{ method, path: string | RegExp }] matched against the PATH of `requestTarget` (the query is still part of what is signed).
 * @returns { ok: true, keyId, requestId } or { ok: false, reason } — reasons are for the audit log only; the HTTP answer is always generic.
 */
export function verifyHubRequest({ method, requestTarget, headers, body, keys, allow, now = Date.now() }) {
  const header = name => (typeof headers?.[name] === 'string' ? headers[name] : null);
  const keyId = header('x-2j-key-id'), timestamp = header('x-2j-timestamp'), requestId = header('x-2j-request-id'), signature = header('x-2j-signature');
  if (!keyId || !timestamp || !requestId || !signature) return { ok: false, reason: 'missing_headers' };
  if (!KEY_ID.test(keyId) || !UUID.test(requestId) || !SIGNATURE.test(signature) || !TIMESTAMP.test(timestamp)) return { ok: false, reason: 'malformed_headers' };
  const path = String(requestTarget || '').split('?', 1)[0];
  if (!allow.some(rule => rule.method === method && (typeof rule.path === 'string' ? rule.path === path : rule.path.test(path)))) return { ok: false, reason: 'not_allowlisted' };
  const at = Date.parse(timestamp);
  if (!Number.isFinite(at) || new Date(at).toISOString() !== timestamp || Math.abs(now - at) > HUB_SERVICE_AUTH_FRESHNESS_MS) return { ok: false, reason: 'stale' };
  const secret = keys?.get?.(keyId);
  if (!secret) return { ok: false, reason: 'unknown_key' };
  const { signature: expected } = signHubRequest({ keyId, secret, timestamp, requestId, method, target: requestTarget, body });
  const a = Buffer.from(signature, 'utf8'), b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'bad_signature' };
  return { ok: true, keyId, requestId };
}
