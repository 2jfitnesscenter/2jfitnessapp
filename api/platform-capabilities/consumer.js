import crypto from 'node:crypto';
import { z } from 'zod';
import { parseServiceAuthKeys } from '../platform-proof/service-auth.js';

export const CAPABILITIES_V2_CONSUMER_FLAG = 'PLATFORM_CAPABILITIES_V2_CONSUMER_ENABLED';
export const CAPABILITIES_V2_PATH_PREFIX = '/api/internal/platform/v2/persons/';
export const CAPABILITIES_V2_MAX_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 64 * 1024;
const KEY_ID = /^[A-Za-z0-9._-]{1,80}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CAPABILITIES_PATH = new RegExp(`^${CAPABILITIES_V2_PATH_PREFIX}[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/training-capabilities$`, 'i');

const capabilityNames = [
  'autonomousTraining', 'routineCreation', 'personalRoutineCreation', 'personalRoutineManagement',
  'workoutRecording', 'workoutHistory', 'guidedTraining', 'premiumPrograms', 'aiCoach', 'professionalFollowUp',
];

/** Wire schema copied from the canonical 2J-CAPABILITIES-V2 schema, with unknown keys rejected. */
export const capabilitiesV2Schema = z.object({
  contract: z.literal('2J-CAPABILITIES-V2'),
  version: z.literal(2),
  personId: z.string().uuid(),
  trainingSubject: z.discriminatedUnion('linkStatus', [
    z.object({ linkStatus: z.literal('active'), trainingUserId: z.string().min(1).max(200) }).strict(),
    z.object({ linkStatus: z.literal('not_linked') }).strict(),
    z.object({ linkStatus: z.literal('revoked') }).strict(),
  ]),
  capabilityLevel: z.enum(['full', 'autonomous', 'baseline', 'blocked']),
  accessState: z.enum(['active', 'provisional', 'blocked_unpaid', 'ended', 'baseline', 'suspended']),
  capabilities: z.object(Object.fromEntries(capabilityNames.map(name => [name, z.boolean()]))).strict(),
  reasonCode: z.enum([
    'ACTIVE_FULL', 'ACTIVE_AUTONOMOUS', 'PROVISIONAL_FULL', 'PROVISIONAL_AUTONOMOUS',
    'TRAINING_LINK_REVOKED', 'TRAINING_LINK_MISSING', 'FREE_BASELINE', 'ADMIN_SUSPENDED',
  ]),
  suspensionStatus: z.enum(['none', 'suspended', 'lifted']),
  effectiveFrom: z.union([z.iso.date(), z.null()]),
  expiresAt: z.iso.datetime({ offset: false }),
  generatedAt: z.iso.datetime({ offset: false }),
  source: z.object({ platform: z.literal(true) }).strict(),
}).strict();

export function capabilitiesV2ConsumerEnabled(value = process.env[CAPABILITIES_V2_CONSUMER_FLAG]) {
  return typeof value === 'string' && /^(1|true)$/i.test(value);
}

export function signCapabilitiesV2Request({ keyId, secret, timestamp, requestId, path }) {
  if (!KEY_ID.test(keyId) || !UUID.test(requestId) || typeof secret !== 'string' && !Buffer.isBuffer(secret)) {
    throw new TypeError('invalid_service_signing_configuration');
  }
  const secretBytes = Buffer.isBuffer(secret) ? secret : Buffer.from(secret, 'base64url');
  if (secretBytes.length < 32 || (!Buffer.isBuffer(secret) && secretBytes.toString('base64url') !== secret)) {
    throw new TypeError('invalid_service_signing_configuration');
  }
  if (!isCanonicalTimestamp(timestamp) || typeof path !== 'string' || !CAPABILITIES_PATH.test(path)) {
    throw new TypeError('invalid_service_signing_request');
  }
  const digest = crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex');
  const canonical = ['2J-SERVICE-AUTH-V1', keyId, timestamp, requestId, 'GET', path, digest].join('\n');
  const signature = crypto.createHmac('sha256', secretBytes).update(Buffer.from(canonical, 'utf8')).digest('base64url');
  return {
    canonical,
    headers: {
      'x-2j-key-id': keyId,
      'x-2j-timestamp': timestamp,
      'x-2j-request-id': requestId,
      'x-2j-signature': signature,
    },
  };
}

function isCanonicalTimestamp(value) {
  if (typeof value !== 'string') return false;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}

function endpointFor(platformOrigin, personId, allowInsecureLocalForTests) {
  const origin = new URL(platformOrigin);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname.toLowerCase());
  if (origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash ||
      (origin.protocol !== 'https:' && !(allowInsecureLocalForTests && loopback && origin.protocol === 'http:'))) {
    throw new TypeError('invalid_platform_origin');
  }
  const normalizedPersonId = personId.toLowerCase();
  const path = `${CAPABILITIES_V2_PATH_PREFIX}${encodeURIComponent(normalizedPersonId)}/training-capabilities`;
  return { url: new URL(path, origin.origin), path };
}

function classify(snapshot) {
  if (snapshot.trainingSubject.linkStatus === 'revoked') return 'revoked';
  if (snapshot.trainingSubject.linkStatus === 'not_linked') return 'not_linked';
  if (snapshot.reasonCode === 'ADMIN_SUSPENDED') return 'suspended';
  if (snapshot.accessState === 'baseline' && snapshot.reasonCode === 'FREE_BASELINE') return 'baseline';
  return 'available';
}

function validateSnapshot(raw, { personId, trainingUserId, now }) {
  const parsed = capabilitiesV2Schema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: 'schema_invalid' };
  const snapshot = parsed.data;
  if (snapshot.personId.toLowerCase() !== personId.toLowerCase()) return { ok: false, reason: 'person_mismatch' };
  if (snapshot.trainingSubject.linkStatus === 'active') {
    if (snapshot.trainingSubject.trainingUserId !== trainingUserId) return { ok: false, reason: 'training_identity_mismatch' };
    if (snapshot.reasonCode === 'TRAINING_LINK_MISSING' || snapshot.reasonCode === 'TRAINING_LINK_REVOKED') return { ok: false, reason: 'link_state_inconsistent' };
    if (snapshot.suspensionStatus === 'suspended' && snapshot.reasonCode !== 'ADMIN_SUSPENDED') return { ok: false, reason: 'suspension_state_inconsistent' };
    if (snapshot.reasonCode === 'FREE_BASELINE') {
      const baseline = { autonomousTraining: true, routineCreation: false, personalRoutineCreation: true, personalRoutineManagement: true, workoutRecording: true, workoutHistory: true, guidedTraining: false, premiumPrograms: false, aiCoach: false, professionalFollowUp: false };
      if (snapshot.capabilityLevel !== 'baseline' || snapshot.accessState !== 'baseline' || Object.keys(baseline).some(name => snapshot.capabilities[name] !== baseline[name])) {
        return { ok: false, reason: 'baseline_state_inconsistent' };
      }
    }
    if (snapshot.accessState === 'baseline' && snapshot.reasonCode !== 'FREE_BASELINE') return { ok: false, reason: 'baseline_state_inconsistent' };
  } else if (snapshot.reasonCode !== (snapshot.trainingSubject.linkStatus === 'revoked' ? 'TRAINING_LINK_REVOKED' : 'TRAINING_LINK_MISSING')) {
    return { ok: false, reason: 'link_state_inconsistent' };
  } else if (snapshot.capabilityLevel !== 'blocked' || Object.values(snapshot.capabilities).some(Boolean)) {
    return { ok: false, reason: 'link_capability_state_inconsistent' };
  }

  const generatedAt = Date.parse(snapshot.generatedAt);
  const expiresAt = Date.parse(snapshot.expiresAt);
  if (generatedAt > now || expiresAt <= now || expiresAt <= generatedAt) return { ok: false, reason: 'snapshot_expired_or_future' };
  if (expiresAt - generatedAt > CAPABILITIES_V2_MAX_TTL_MS) return { ok: false, reason: 'snapshot_ttl_exceeded' };

  const suspended = snapshot.reasonCode === 'ADMIN_SUSPENDED' || snapshot.accessState === 'suspended';
  if (suspended && (snapshot.trainingSubject.linkStatus !== 'active' || snapshot.accessState !== 'suspended' || snapshot.suspensionStatus !== 'suspended' || snapshot.reasonCode !== 'ADMIN_SUSPENDED' || Object.values(snapshot.capabilities).some(Boolean))) {
    return { ok: false, reason: 'suspension_state_inconsistent' };
  }
  if (!suspended && snapshot.reasonCode === 'ADMIN_SUSPENDED') return { ok: false, reason: 'suspension_state_inconsistent' };
  return { ok: true, snapshot, status: classify(snapshot), expiresAt };
}

async function readBoundedJson(response, maxBytes) {
  const length = response.headers?.get?.('content-length');
  if (length && Number(length) > maxBytes) throw new Error('response_too_large');
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('response_too_large');
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error('response_too_large');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder().decode(all));
}

function result(status, extra = {}) { return Object.freeze({ status, ...extra }); }

function freezeSnapshot(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeSnapshot(child);
  return Object.freeze(value);
}

/**
 * Server-only read client. It is inert unless explicitly enabled, has no route/store wiring,
 * and never mutates Training identity, sessions, routines or history.
 */
export function createCapabilitiesV2Consumer({
  enabled = capabilitiesV2ConsumerEnabled(),
  platformOrigin,
  serviceKeys = parseServiceAuthKeys(process.env.PLATFORM_SERVICE_AUTH_KEYS || ''),
  keyId = process.env.PLATFORM_CAPABILITIES_SERVICE_KEY_ID,
  secret,
  fetchImpl = globalThis.fetch,
  now = Date.now,
  timeoutMs = REQUEST_TIMEOUT_MS,
  logger = null,
  allowInsecureLocalForTests = false,
} = {}) {
  const consumerEnabled = enabled === true || capabilitiesV2ConsumerEnabled(enabled);
  const boundedTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, REQUEST_TIMEOUT_MS)) : REQUEST_TIMEOUT_MS;
  const cache = new Map();
  const inFlight = new Map();

  async function fetchSnapshot({ personId, trainingUserId }) {
    const current = now();
    const { url, path } = endpointFor(platformOrigin, personId, allowInsecureLocalForTests);
    const timestamp = new Date(current).toISOString();
    const requestId = crypto.randomUUID();
    const signingSecret = secret ?? serviceKeys?.get?.(keyId);
    const signed = signCapabilitiesV2Request({ keyId, secret: signingSecret, timestamp, requestId, path });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error('request_timeout')), boundedTimeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(url, {
          method: 'GET',
          headers: { accept: 'application/json', ...signed.headers },
          redirect: 'error',
          cache: 'no-store',
          signal: controller.signal,
        });
      } catch {
        return { unavailable: controller.signal.aborted ? 'timeout' : 'transport_error' };
      }
      if (response.status >= 500) return { unavailable: 'http_5xx' };
      if (!response.ok) return { invalid: 'http_rejected' };
      if (response.redirected) return { invalid: 'response_origin_mismatch' };
      if (response.url) {
        try {
          const finalUrl = new URL(response.url);
          if (finalUrl.origin !== url.origin || finalUrl.pathname !== path || finalUrl.search || finalUrl.hash) return { invalid: 'response_origin_mismatch' };
        } catch { return { invalid: 'response_origin_mismatch' }; }
      }
      let raw;
      try { raw = await readBoundedJson(response, MAX_RESPONSE_BYTES); }
      catch { return controller.signal.aborted ? { unavailable: 'timeout' } : { invalid: 'response_invalid' }; }
      const validated = validateSnapshot(raw, { personId, trainingUserId, now: now() });
      if (!validated.ok) return { invalid: validated.reason };
      return { validated };
    } finally {
      clearTimeout(timeout);
    }
  }

  function usableCache(key, current) {
    const entry = cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= current || entry.cacheUntil <= current) { cache.delete(key); return null; }
    return entry;
  }

  function clearPersonCache(personId) {
    const prefix = `${personId}\n`;
    for (const cacheKey of cache.keys()) if (cacheKey.startsWith(prefix)) cache.delete(cacheKey);
  }

  async function resolve({ personId, trainingUserId, forceRefresh = false } = {}) {
    if (!consumerEnabled) return result('disabled');
    if (typeof personId !== 'string' || !UUID.test(personId) || typeof trainingUserId !== 'string' || !trainingUserId.trim()) {
      return result('invalid_identity');
    }
    const signingSecret = secret ?? serviceKeys?.get?.(keyId);
    if (typeof fetchImpl !== 'function' || !platformOrigin || !keyId || !signingSecret) return result('configuration_unavailable');
    if (!KEY_ID.test(keyId) || (!Buffer.isBuffer(signingSecret) && (typeof signingSecret !== 'string' || !/^[A-Za-z0-9_-]+$/.test(signingSecret) || Buffer.from(signingSecret, 'base64url').length < 32 || Buffer.from(signingSecret, 'base64url').toString('base64url') !== signingSecret)) || (Buffer.isBuffer(signingSecret) && signingSecret.length < 32)) {
      return result('configuration_invalid');
    }

    try { endpointFor(platformOrigin, personId, allowInsecureLocalForTests); }
    catch { return result('configuration_invalid'); }

    const normalizedPersonId = personId.toLowerCase();
    const key = `${normalizedPersonId}\n${trainingUserId}`;
    const cached = usableCache(key, now());
    if (cached && !forceRefresh) return result(cached.status, { snapshot: cached.snapshot, source: 'cache', stale: false });
    if (inFlight.has(key)) return inFlight.get(key);

    const pending = (async () => {
      const fetched = await fetchSnapshot({ personId: normalizedPersonId, trainingUserId });
      if (fetched.validated) {
        const { status, expiresAt } = fetched.validated;
        const snapshot = freezeSnapshot(fetched.validated.snapshot);
        clearPersonCache(normalizedPersonId);
        if (status !== 'revoked' && status !== 'not_linked') {
          cache.set(key, { snapshot, status, expiresAt, cacheUntil: Math.min(expiresAt, now() + CAPABILITIES_V2_MAX_TTL_MS) });
        }
        return result(status, { snapshot, source: 'platform', stale: false });
      }
      if (fetched.invalid) {
        logger?.warn?.({ event: 'platform_capabilities_snapshot_rejected', reason: fetched.invalid }, 'Platform capability snapshot rejected');
        if (fetched.invalid === 'training_identity_mismatch' || fetched.invalid === 'link_state_inconsistent') clearPersonCache(normalizedPersonId);
        else cache.delete(key);
        return result('invalid', { reason: fetched.invalid });
      }
      const fallback = usableCache(key, now());
      if (fallback) return result(fallback.status, { snapshot: fallback.snapshot, source: 'cache', stale: true, unavailableReason: fetched.unavailable });
      logger?.warn?.({ event: 'platform_capabilities_unavailable', reason: fetched.unavailable }, 'Platform capabilities unavailable');
      return result('unavailable', { reason: fetched.unavailable });
    })();
    inFlight.set(key, pending);
    try { return await pending; }
    finally { inFlight.delete(key); }
  }

  return Object.freeze({ enabled: consumerEnabled, resolve, clearCache() { cache.clear(); }, cacheSize() { return cache.size; } });
}
