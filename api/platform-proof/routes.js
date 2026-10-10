import crypto from 'node:crypto';
import { z } from 'zod';
import { SERVICE_AUTH_PATH, SERVICE_RECONCILIATION_PATH, verifyPlatformServiceRequest } from './service-auth.js';

export const PLATFORM_LINK_AUDIENCE = '2j-training-account-link';
export const PLATFORM_LINK_PURPOSE = 'training-account-link';
export const PLATFORM_PROOF_TTL_MS = 2 * 60_000;
export const PLATFORM_CONTEXT_MAX_TTL_MS = 5 * 60_000;
export const PLATFORM_CONTEXT_CLOCK_SKEW_MS = 30_000;
export const PLATFORM_PROOF_BODY_MAX_BYTES = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const issuanceSchema = z.object({
  v: z.literal(1), transactionId: z.string().regex(UUID), personId: z.string().regex(UUID),
  audience: z.literal(PLATFORM_LINK_AUDIENCE), purpose: z.literal(PLATFORM_LINK_PURPOSE),
  challengeDigest: z.string().regex(SHA256), expiresAt: z.string().regex(ISO_UTC),
}).strict();
const exchangeSchema = z.object({
  v: z.literal(1), code: z.string().min(43).max(128).regex(/^[A-Za-z0-9_-]+$/),
  transactionId: z.string().regex(UUID), personId: z.string().regex(UUID),
  audience: z.string().min(1).max(120).regex(/^[\x21-\x7e]+$/), purpose: z.string().min(1).max(120).regex(/^[\x21-\x7e]+$/),
  challengeDigest: z.string().regex(SHA256),
}).strict();
const reconciliationSchema = z.object({
  v: z.literal(1), transactionId: z.string().regex(UUID), personId: z.string().regex(UUID),
  audience: z.literal(PLATFORM_LINK_AUDIENCE), purpose: z.literal(PLATFORM_LINK_PURPOSE),
  challengeDigest: z.string().regex(SHA256),
}).strict();

function readRawBody(request, maxBytes = PLATFORM_PROOF_BODY_MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0; let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > maxBytes) { tooLarge = true; chunks.length = 0; return; }
      chunks.push(bytes);
    });
    request.on('end', () => tooLarge ? reject(Object.assign(new Error('body too large'), { code: 'BODY_TOO_LARGE' })) : resolve(Buffer.concat(chunks, size)));
    request.on('error', reject);
  });
}

function parseJson(bytes) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { return null; }
}

function canonicalPlatformExpiry(value, timestamp) {
  if (!ISO_UTC.test(value)) return { status: 'invalid' };
  const expiresAtMs = Date.parse(value);
  if (!Number.isFinite(expiresAtMs) || new Date(expiresAtMs).toISOString() !== value) return { status: 'invalid' };
  if (expiresAtMs <= timestamp) return { status: 'expired' };
  // Platform timestamps come from its database clock; allow small cross-service clock skew.
  // The proof still expires no later than the supplied Platform deadline.
  if (expiresAtMs > timestamp + PLATFORM_CONTEXT_MAX_TTL_MS + PLATFORM_CONTEXT_CLOCK_SKEW_MS) return { status: 'too_far' };
  return { status: 'ok', expiresAtMs };
}

const error = (json, res, status, code) => json(res, status, { error: code });

export function createPlatformProofRoutes({ json, readSession, store, users, issuanceEnabled = false, exchangeEnabled = false, reconciliationEnabled = false, serviceKeys = new Map(), now = Date.now }) {
  return {
    'POST /api/platform/v1/link-proofs': async (req, res) => {
      res.setHeader?.('Cache-Control', 'no-store');
      if (!issuanceEnabled) return error(json, res, 423, 'platform_linking_disabled');
      const user = readSession(req);
      if (!user || user.authLevel !== 'passkey') return error(json, res, 401, 'authentication_required');
      if (req.headers?.['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return error(json, res, 400, 'invalid_context');
      let raw;
      try { raw = await readRawBody(req); }
      catch (cause) { return error(json, res, cause?.code === 'BODY_TOO_LARGE' ? 413 : 400, 'invalid_context'); }
      const parsed = issuanceSchema.safeParse(parseJson(raw));
      if (!parsed.success) return error(json, res, 400, 'invalid_context');
      const timestamp = now(), expiry = canonicalPlatformExpiry(parsed.data.expiresAt, timestamp);
      if (expiry.status === 'expired') return error(json, res, 410, 'platform_challenge_expired');
      if (expiry.status !== 'ok') return error(json, res, 400, 'invalid_context');
      try {
        const proof = store.issue({
          transactionId: parsed.data.transactionId,
          personId: parsed.data.personId,
          audience: parsed.data.audience,
          purpose: parsed.data.purpose,
          challengeDigest: parsed.data.challengeDigest,
          platformExpiresAtMs: expiry.expiresAtMs,
        }, user.id);
        return json(res, 201, { v: 1, code: proof.code, expiresAt: proof.expiresAt });
      } catch {
        return error(json, res, 503, 'platform_linking_unavailable');
      }
    },

    'POST /api/platform/v1/link-proofs/exchange': async (req, res) => {
      res.setHeader?.('Cache-Control', 'no-store');
      if (!exchangeEnabled) return error(json, res, 423, 'platform_linking_disabled');
      let raw;
      try { raw = await readRawBody(req); }
      catch (cause) { return error(json, res, cause?.code === 'BODY_TOO_LARGE' ? 413 : 400, 'invalid_context'); }
      const authorization = verifyPlatformServiceRequest({
        method: req.method,
        requestTarget: req.url,
        headers: req.headers,
        body: raw,
        keys: serviceKeys,
        now: now(),
      });
      if (authorization.status !== 'ok') return error(json, res, 401, authorization.status);
      if (req.headers?.['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return error(json, res, 400, 'invalid_context');
      const parsed = exchangeSchema.safeParse(parseJson(raw));
      if (!parsed.success) return error(json, res, 400, 'invalid_context');
      const { code, ...context } = parsed.data;
      try {
        const result = store.exchange({
          codeHash: crypto.createHash('sha256').update(Buffer.from(code, 'utf8')).digest('hex'),
          requestId: authorization.requestId,
          context,
          isTrainingUserActive: trainingUserId => users().some(candidate => candidate.id === trainingUserId && !candidate.disabled),
        });
        if (result.status === 'exchanged') return json(res, 200, result.receipt);
        const responses = {
          service_request_replayed: [409, 'service_request_replayed'],
          verification_receipt_conflict: [409, 'verification_receipt_conflict'],
          verification_receipt_exists: [409, 'verification_receipt_exists'],
          proof_not_found: [404, 'proof_not_found'],
          proof_expired: [410, 'proof_expired'],
          proof_already_consumed: [409, 'proof_already_consumed'],
          proof_context_mismatch: [409, 'proof_context_mismatch'],
        };
        const [status, codeName] = responses[result.status] || [503, 'platform_linking_unavailable'];
        return error(json, res, status, codeName);
      } catch {
        return error(json, res, 503, 'platform_linking_unavailable');
      }
    },

    'POST /api/platform/v1/link-proofs/reconcile': async (req, res) => {
      res.setHeader?.('Cache-Control', 'no-store');
      if (!reconciliationEnabled) return error(json, res, 423, 'platform_linking_disabled');
      let raw;
      try { raw = await readRawBody(req); }
      catch (cause) { return error(json, res, cause?.code === 'BODY_TOO_LARGE' ? 413 : 400, 'invalid_context'); }
      const authorization = verifyPlatformServiceRequest({
        method: req.method, requestTarget: req.url, headers: req.headers,
        body: raw, keys: serviceKeys, now: now(),
      });
      if (authorization.status !== 'ok') return error(json, res, 401, authorization.status);
      if (req.headers?.['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') return error(json, res, 400, 'invalid_context');
      const parsed = reconciliationSchema.safeParse(parseJson(raw));
      if (!parsed.success) return error(json, res, 400, 'invalid_context');
      try {
        const result = store.reconcile({ requestId: authorization.requestId, context: parsed.data });
        if (result.status === 'verified') return json(res, 200, result.receipt);
        const responses = {
          service_request_replayed: [409, 'service_request_replayed'],
          verification_receipt_not_found: [404, 'verification_receipt_not_found'],
          verification_receipt_conflict: [409, 'verification_receipt_conflict'],
        };
        const [status, code] = responses[result.status] || [503, 'platform_linking_unavailable'];
        return error(json, res, status, code);
      } catch {
        return error(json, res, 503, 'platform_linking_unavailable');
      }
    },
  };
}

export { readRawBody, canonicalPlatformExpiry, SERVICE_AUTH_PATH };
