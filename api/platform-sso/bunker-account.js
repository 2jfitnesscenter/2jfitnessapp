import { z } from 'zod';
import { readRawBody } from '../platform-proof/routes.js';
import { verifyPlatformServiceRequest, SERVICE_BUNKER_ACCOUNT_EMAIL_PATH, SERVICE_BUNKER_ACCOUNT_BY_EMAIL_PATH } from '../platform-proof/service-auth.js';

// Bunker keeps an e-mail per account with a verification flag, and answers two signed internal lookups for Platform.
//
//   user.email          normalized (trim + lowercase, 3..254, basic shape) or null
//   user.emailVerified  true ONLY when Platform said so through the signed sync below. A client (registration, profile edit) can never set it:
//                       a new or changed e-mail is stored with emailVerified false.
//
//   POST /api/internal/platform/v2/bunker-account/email     { uid, email }  sets the e-mail and emailVerified true   -> 200 { uid, emailVerified: true } | 404 account_not_found | 409 email_already_verified
//   POST /api/internal/platform/v2/bunker-account/by-email  { email }       finds the account by VERIFIED e-mail     -> 200 { uid } | 404 { error: 'no_account' } | 409 { error: 'ambiguous' }
//
// Both are 2J-SERVICE-AUTH-V1 requests and only the `platform` caller passes (a `bunker` or `home` key gets 401 service_auth_rejected).
// Keys come from PLATFORM_INTERNAL_SERVICE_KEYS: JSON { keyId: { caller: 'platform'|'home'|'bunker', secret: <base64url, >= 32 bytes> } }.
// Nothing here returns or logs an e-mail address or the request body; only the uid and a result code are recorded.

export const BUNKER_ACCOUNT_EMAIL_PATH = SERVICE_BUNKER_ACCOUNT_EMAIL_PATH;
export const BUNKER_ACCOUNT_BY_EMAIL_PATH = SERVICE_BUNKER_ACCOUNT_BY_EMAIL_PATH;
const CALLERS = new Set(['platform', 'home', 'bunker']);
const KEY_ID = /^[A-Za-z0-9._-]{1,80}$/;
const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** trim + lowercase; null when it is not a plausible address (3..254 characters). */
export function normalizeEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length >= 3 && email.length <= 254 && BASIC_EMAIL.test(email) ? email : null;
}

/** Fields for a NEW account: never verified, whatever the client sent. */
export function emailFields(value) {
  return { email: normalizeEmail(value), emailVerified: false };
}

/** Profile edit: a changed address is never verified. Returns false (touching nothing) when the value is not an address. */
export function setProfileEmail(user, value) {
  const email = normalizeEmail(value);
  if (!email) return false;
  if (user.email !== email) user.emailVerified = false;
  user.email = email;
  if (typeof user.emailVerified !== 'boolean') user.emailVerified = false;
  return true;
}

/** External config: JSON object { keyId: { caller, secret } }. Invalid entries are dropped (fail closed). Returns Map keyId -> { caller, secret: Buffer }. */
export function parseInternalServiceKeys(raw) {
  const keys = new Map();
  if (typeof raw !== 'string' || !raw) return keys;
  try {
    const source = JSON.parse(raw);
    if (!source || typeof source !== 'object' || Array.isArray(source)) return keys;
    for (const [keyId, entry] of Object.entries(source)) {
      if (!KEY_ID.test(keyId) || !entry || typeof entry !== 'object' || !CALLERS.has(entry.caller) || typeof entry.secret !== 'string' || !/^[A-Za-z0-9_-]+$/.test(entry.secret)) continue;
      const secret = Buffer.from(entry.secret, 'base64url');
      if (secret.length < 32 || secret.toString('base64url') !== entry.secret) continue;
      keys.set(keyId, { caller: entry.caller, secret });
    }
  } catch { /* not configured */ }
  return keys;
}

const syncSchema = z.object({ uid: z.string().min(1).max(200).refine(v => v.trim() === v && !/[\u0000-\u001f\u007f]/.test(v)), email: z.string().max(400).refine(v => normalizeEmail(v) !== null) }).strict();
const lookupSchema = z.object({ email: z.string().max(400).refine(v => normalizeEmail(v) !== null) }).strict();
const error = (json, res, status, code) => json(res, status, { error: code });

export function createBunkerAccountRoutes({ json, db, saveDb, store, keys, secEvent = () => {}, log = console, now = Date.now }) {
  const verifierKeys = new Map([...keys].map(([keyId, entry]) => [keyId, entry.secret]));

  /** Raw body, signature, caller, single-use request id, JSON content type and strict body. Answers and returns null on any failure. */
  async function authenticated(req, res, path, schema) {
    res.setHeader?.('Cache-Control', 'no-store');
    let raw;
    try { raw = await readRawBody(req); } catch (cause) { error(json, res, cause?.code === 'BODY_TOO_LARGE' ? 413 : 400, 'invalid_request'); return null; }
    const authorization = verifyPlatformServiceRequest({ method: req.method, requestTarget: req.url, headers: req.headers, body: raw, keys: verifierKeys, now: now() });
    if (authorization.status !== 'ok' || req.url !== path) { error(json, res, 401, authorization.status === 'ok' ? 'service_auth_invalid' : authorization.status); return null; }
    if (keys.get(authorization.keyId)?.caller !== 'platform') { error(json, res, 401, 'service_auth_rejected'); return null; }
    if (req.headers?.['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') { error(json, res, 400, 'invalid_request'); return null; }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); } catch { error(json, res, 400, 'invalid_request'); return null; }
    const parsed = schema.safeParse(body);
    if (!parsed.success) { error(json, res, 400, 'invalid_request'); return null; }
    try { if (store.acceptServiceRequest(authorization.requestId, 'platform_bunker_account').status !== 'accepted') { error(json, res, 409, 'service_request_replayed'); return null; } }
    catch { error(json, res, 503, 'bunker_account_unavailable'); return null; }
    return parsed.data;
  }

  return {
    [`POST ${BUNKER_ACCOUNT_EMAIL_PATH}`]: async (req, res) => {
      const body = await authenticated(req, res, BUNKER_ACCOUNT_EMAIL_PATH, syncSchema);
      if (!body) return;
      try {
        const email = normalizeEmail(body.email);
        const user = db.users.find(candidate => candidate.id === body.uid && !candidate.disabled);
        if (!user) { secEvent('platform_email_sync', { userId: body.uid, meta: { result: 'account_not_found' } }); return error(json, res, 404, 'account_not_found'); }
        if (db.users.some(candidate => candidate.id !== user.id && !candidate.disabled && candidate.emailVerified === true && candidate.email === email)) {
          secEvent('platform_email_sync', { userId: user.id, meta: { result: 'email_already_verified' } });
          return error(json, res, 409, 'email_already_verified');
        }
        user.email = email;
        user.emailVerified = true;
        secEvent('platform_email_sync', { userId: user.id, meta: { result: 'ok' } });
        saveDb();
        return json(res, 200, { uid: user.id, emailVerified: true });
      } catch {
        log.error?.('bunker account email sync failed');   // never the error itself: it could echo the request
        return error(json, res, 503, 'bunker_account_unavailable');
      }
    },
    [`POST ${BUNKER_ACCOUNT_BY_EMAIL_PATH}`]: async (req, res) => {
      const body = await authenticated(req, res, BUNKER_ACCOUNT_BY_EMAIL_PATH, lookupSchema);
      if (!body) return;
      const email = normalizeEmail(body.email);
      const matches = db.users.filter(candidate => !candidate.disabled && candidate.emailVerified === true && candidate.email === email);
      if (matches.length === 0) return error(json, res, 404, 'no_account');
      if (matches.length > 1) return error(json, res, 409, 'ambiguous');
      return json(res, 200, { uid: matches[0].id });
    },
  };
}
