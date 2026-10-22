import { z } from 'zod';
import { signPlatformServiceRequest } from '../platform-proof/service-auth.js';

// Consumer of Platform's 2J-CAPABILITIES-V2. Platform is the authority; this module only validates, caches
// briefly and degrades safely. It never recalculates payments, periods or suspensions.

export const CAPABILITY_NAMES = Object.freeze(['autonomousTraining', 'routineCreation', 'personalRoutineCreation', 'personalRoutineManagement', 'workoutRecording', 'workoutHistory', 'guidedTraining', 'premiumPrograms', 'aiCoach', 'professionalFollowUp']);
const flags = Object.fromEntries(CAPABILITY_NAMES.map(name => [name, z.boolean()]));
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
export const capabilitiesV2Schema = z.object({
  contract: z.literal('2J-CAPABILITIES-V2'), version: z.literal(2), personId: UUID,
  trainingSubject: z.object({ linkStatus: z.enum(['active', 'not_linked', 'revoked']), trainingUserId: z.string().min(1).max(200).optional() }).strict(),
  capabilityLevel: z.enum(['full', 'autonomous', 'baseline', 'blocked']),
  accessState: z.enum(['active', 'provisional', 'blocked_unpaid', 'ended', 'baseline', 'suspended']),
  capabilities: z.object(flags).strict(),
  reasonCode: z.enum(['ACTIVE_FULL', 'ACTIVE_AUTONOMOUS', 'PROVISIONAL_FULL', 'PROVISIONAL_AUTONOMOUS', 'TRAINING_LINK_REVOKED', 'TRAINING_LINK_MISSING', 'FREE_BASELINE', 'ADMIN_SUSPENDED']),
  suspensionStatus: z.enum(['none', 'suspended', 'lifted']),
  effectiveFrom: z.string().nullable(),
  expiresAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
  generatedAt: z.string().regex(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/),
  source: z.object({ platform: z.literal(true) }).strict(),
}).strict();

const BASELINE_FLAGS = new Set(['autonomousTraining', 'personalRoutineCreation', 'personalRoutineManagement', 'workoutRecording', 'workoutHistory']);
export const baselineCapabilities = () => Object.fromEntries(CAPABILITY_NAMES.map(name => [name, BASELINE_FLAGS.has(name)]));
export const blockedCapabilities = () => Object.fromEntries(CAPABILITY_NAMES.map(name => [name, false]));
const MAX_CLOCK_SKEW_MS = 60_000;
const RESTRICTION_REASONS = new Set(['ADMIN_SUSPENDED', 'TRAINING_LINK_REVOKED', 'TRAINING_LINK_MISSING']);

/**
 * Safe-degradation view, used when no fresh Platform answer is available.
 *  - A known suspension / revoked link keeps blocking (it is never forgotten, even across restarts).
 *  - Otherwise only the free baseline is granted: paid capabilities are never granted without verification.
 *  - A user with no history at all and no known restriction is left to the caller (`null`): legacy/shadow users
 *    keep their current access; enforced users fall back to the baseline.
 */
export function degradedView({ lastPayload, restriction, mode }) {
  const reason = restriction?.reasonCode ?? (lastPayload && lastPayload.capabilityLevel === 'blocked' ? lastPayload.reasonCode : null);
  if (reason && RESTRICTION_REASONS.has(reason)) return { level: 'blocked', reasonCode: reason, capabilities: blockedCapabilities(), degraded: true, verified: false };
  if (lastPayload || mode === 'enforced') return { level: 'baseline', reasonCode: 'FREE_BASELINE', capabilities: baselineCapabilities(), degraded: true, verified: false };
  return null;
}

/**
 * Creates the service. `callPlatform` is injectable; the default signs a GET with 2J-SERVICE-AUTH-V1 and uses fetch with a hard timeout.
 * `onRestriction(user, restriction|null)` persists the last known restriction on the Training user.
 */
export function createCapabilitiesService({ config, users, now = Date.now, fetchImpl = globalThis.fetch, onRestriction = () => {}, onLinkLost = () => {}, timeoutMs = 3000 }) {
  const cache = new Map();      // personId -> { payload, expiresAtMs, fetchedAtMs }
  const inflight = new Map();   // personId -> Promise
  const enabled = Boolean(config && config.baseUrl && config.keyId && config.secret);

  async function fetchFromPlatform(personId) {
    const path = `/api/internal/platform/v2/persons/${personId}/training-capabilities`;
    const timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const { signature } = signPlatformServiceRequest({ keyId: config.keyId, secret: config.secret, timestamp, requestId, method: 'GET', path, body: Buffer.alloc(0) });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(new URL(path, config.baseUrl), {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { 'x-2j-key-id': config.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature },
      });
      if (!response.ok) return { ok: false, status: response.status };
      const parsed = capabilitiesV2Schema.safeParse(await response.json());
      return parsed.success ? { ok: true, payload: parsed.data } : { ok: false, status: 'invalid_contract' };
    } catch { return { ok: false, status: 'unavailable' }; }
    finally { clearTimeout(timer); }
  }

  function accept(user, payload) {
    const t = now();
    if (payload.personId !== user.personId) return false;
    if (payload.trainingSubject.linkStatus === 'active' && payload.trainingSubject.trainingUserId !== user.id) return false;
    const generated = Date.parse(payload.generatedAt), expires = Date.parse(payload.expiresAt);
    if (!Number.isFinite(generated) || !Number.isFinite(expires) || generated > t + MAX_CLOCK_SKEW_MS || expires <= generated || expires - generated > 60_000) return false;
    return expires > t;
  }

  /** Returns `{ source: 'fresh'|'cache'|'degraded', ...view }` or `null` when there is no verdict (legacy/shadow user, nothing known). */
  async function evaluate(user, { mode = 'legacy' } = {}) {
    if (!user?.personId) return null;
    const personId = user.personId, t = now();
    const cached = cache.get(personId);
    if (cached && cached.expiresAtMs > t) return view(cached.payload, 'cache');
    if (!enabled) return remember(user, degradedView({ lastPayload: cached?.payload, restriction: user.platformRestriction, mode }));
    let pending = inflight.get(personId);
    if (!pending) { pending = fetchFromPlatform(personId).finally(() => inflight.delete(personId)); inflight.set(personId, pending); }
    const result = await pending;
    if (result.ok && accept(user, result.payload)) {
      cache.set(personId, { payload: result.payload, expiresAtMs: Date.parse(result.payload.expiresAt), fetchedAtMs: t });
      const blocked = result.payload.capabilityLevel === 'blocked' ? { reasonCode: result.payload.reasonCode, at: new Date(t).toISOString() } : null;
      if (blocked && !(user.platformRestriction?.reasonCode === blocked.reasonCode)) onRestriction(user, blocked);
      if (!blocked && user.platformRestriction) onRestriction(user, null);
      if (blocked && result.payload.reasonCode !== 'ADMIN_SUSPENDED') onLinkLost(user, result.payload.reasonCode);
      return view(result.payload, 'fresh');
    }
    // 404 person_not_found / revoked links reported as errors are treated as unavailable here: Platform answers 200 with a blocked payload for links.
    return remember(user, degradedView({ lastPayload: cached?.payload, restriction: user.platformRestriction, mode }));
  }

  function remember(user, degraded) { return degraded ? { source: 'degraded', ...degraded } : null; }
  function view(payload, source) {
    return { source, level: payload.capabilityLevel, reasonCode: payload.reasonCode, capabilities: payload.capabilities, degraded: false, verified: true, accessState: payload.accessState };
  }
  const allows = (result, names) => Boolean(result) && names.every(name => result.capabilities[name] === true);
  const prime = (personId, payload) => cache.set(personId, { payload, expiresAtMs: Date.parse(payload.expiresAt), fetchedAtMs: now() });

  return { evaluate, allows, enabled, prime, _cache: cache };
}
