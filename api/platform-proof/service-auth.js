import crypto from 'node:crypto';

export const SERVICE_AUTH_PATH = '/api/platform/v1/link-proofs/exchange';
export const SERVICE_AUTH_FRESHNESS_MS = 60_000;
export const SERVICE_AUTH_REPLAY_TTL_MS = 2 * SERVICE_AUTH_FRESHNESS_MS;
const KEY_ID = /^[A-Za-z0-9._-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;

/** External config format: JSON object { keyId: base64urlSecret, ... }. Invalid entries fail closed. */
export function parseServiceAuthKeys(raw) {
  if (typeof raw !== 'string' || !raw) return new Map();
  try {
    const source = JSON.parse(raw);
    if (!source || typeof source !== 'object' || Array.isArray(source)) return new Map();
    const keys = new Map();
    for (const [keyId, encoded] of Object.entries(source)) {
      if (!KEY_ID.test(keyId) || typeof encoded !== 'string' || !/^[A-Za-z0-9_-]+$/.test(encoded)) continue;
      const secret = Buffer.from(encoded, 'base64url');
      if (secret.length < 32 || secret.toString('base64url') !== encoded) continue;
      keys.set(keyId, secret);
    }
    return keys;
  } catch { return new Map(); }
}

/** Exact 2J-SERVICE-AUTH-V1 receiver. `body` must be the original byte sequence from the socket. */
export function verifyPlatformServiceRequest({ method, requestTarget, headers, body, keys, now = Date.now(), freshnessMs = SERVICE_AUTH_FRESHNESS_MS }) {
  const header = name => typeof headers?.[name] === 'string' ? headers[name] : null;
  const keyId = header('x-2j-key-id'), timestamp = header('x-2j-timestamp'), requestId = header('x-2j-request-id'), signature = header('x-2j-signature');
  if (!keyId || !timestamp || !requestId || !signature) return { status: 'service_auth_required' };
  if (!KEY_ID.test(keyId) || !UUID.test(requestId) || !SIGNATURE.test(signature) || method !== 'POST' || requestTarget !== SERVICE_AUTH_PATH) return { status: 'service_auth_invalid' };
  if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp)) return { status: 'service_auth_invalid' };
  const timestampMs = Date.parse(timestamp);
  if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString() !== timestamp || Math.abs(now - timestampMs) > freshnessMs) return { status: 'service_auth_invalid' };
  const key = keys?.get(keyId);
  if (!key) return { status: 'service_auth_invalid' };
  const bodyDigest = crypto.createHash('sha256').update(body).digest('hex');
  const canonical = ['2J-SERVICE-AUTH-V1', keyId, timestamp, requestId, method, requestTarget, bodyDigest].join('\n');
  const expected = crypto.createHmac('sha256', key).update(Buffer.from(canonical, 'utf8')).digest('base64url');
  const actualBytes = Buffer.from(signature, 'utf8'), expectedBytes = Buffer.from(expected, 'utf8');
  if (actualBytes.length !== expectedBytes.length || !crypto.timingSafeEqual(actualBytes, expectedBytes)) return { status: 'service_auth_invalid' };
  return { status: 'ok', keyId, requestId, timestamp, canonical, bodyDigest };
}

export function signPlatformServiceRequest({ keyId, secret, timestamp, requestId, method = 'POST', path = SERVICE_AUTH_PATH, body }) {
  const bodyBytes = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const bodyDigest = crypto.createHash('sha256').update(bodyBytes).digest('hex');
  const canonical = ['2J-SERVICE-AUTH-V1', keyId, timestamp, requestId, method, path, bodyDigest].join('\n');
  const signature = crypto.createHmac('sha256', secret).update(Buffer.from(canonical, 'utf8')).digest('base64url');
  return { canonical, bodyDigest, signature };
}
