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
 *
 * Failure model (decision H6): Platform being UNAVAILABLE is not the same as Platform REFUSING or CONTRADICTING an identity.
 *   unavailable   network error, timeout, 5xx, 408/429, or an answer whose clock is unusable -> safe degradation (known suspension keeps
 *                 blocking, otherwise the free baseline; paid rights are never granted unverified). A circuit breaker (H5) stops every request
 *                 from waiting for the timeout during an outage.
 *   rejected      401/403/404/other 4xx: Platform does not accept our service call or does not know this person -> fail CLOSED (blocked) and alert.
 *   inconsistent  an answer that breaks the contract, names another person or another Training user -> fail CLOSED and alert.
 * A rejected/inconsistent verdict is cached for a few seconds only so the service is not hammered, and it is NOT persisted as a restriction.
 * Cache lifetime (H4) is bounded by OUR clock: min(expiresAt, receipt + 60 s), so a skewed clock cannot stretch it.
 */
export const MAX_CAPABILITY_CACHE_MS = 60_000;
const REJECTION_CACHE_MS = 5_000;
export const DEFAULT_BREAKER_BASE_MS = 2_000;
const backoffSteps = base => [base, base * 2, base * 4, base * 6];
const ALERT_EVERY_MS = 5 * 60_000;

export function createCapabilitiesService({ config, now = Date.now, fetchImpl = globalThis.fetch, onRestriction = () => {}, onLinkLost = () => {}, onAlert = () => {}, timeoutMs = 3000, breakerBaseMs = DEFAULT_BREAKER_BASE_MS }) {
  const BREAKER_BACKOFF_MS = backoffSteps(breakerBaseMs);
  const cache = new Map();      // personId -> { payload, expiresAtMs, fetchedAtMs }
  const rejections = new Map(); // personId -> { kind, reason, untilMs }
  const inflight = new Map();   // personId -> Promise
  const enabled = Boolean(config && config.baseUrl && config.keyId && config.secret);
  const breaker = { failures: 0, openUntil: 0, downSince: 0 };
  const lastAlert = new Map();
  const alert = (kind, detail) => {
    const t = now(), key = kind;
    if (t - (lastAlert.get(key) ?? -Infinity) < ALERT_EVERY_MS) return;
    lastAlert.set(key, t);
    try { onAlert(kind, detail); } catch { /* alerts never break a request */ }
  };

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
      if (!response.ok) {
        const status = response.status;
        if (status >= 500 || status === 408 || status === 429) return { ok: false, kind: 'unavailable', reason: `http_${status}` };
        return { ok: false, kind: 'rejected', reason: `http_${status}` };
      }
      let body;
      try { body = await response.json(); } catch { return { ok: false, kind: 'inconsistent', reason: 'invalid_json' }; }
      const parsed = capabilitiesV2Schema.safeParse(body);
      return parsed.success ? { ok: true, payload: parsed.data } : { ok: false, kind: 'inconsistent', reason: 'invalid_contract' };
    } catch { return { ok: false, kind: 'unavailable', reason: 'network' }; }
    finally { clearTimeout(timer); }
  }

  /** `ok`, or the failure kind: a clock we cannot trust is unavailability; a payload about someone else is an inconsistency. */
  function check(user, payload) {
    const t = now();
    if (payload.personId !== user.personId) return { kind: 'inconsistent', reason: 'person_mismatch' };
    if (payload.trainingSubject.linkStatus === 'active' && payload.trainingSubject.trainingUserId !== user.id) return { kind: 'inconsistent', reason: 'training_user_mismatch' };
    const generated = Date.parse(payload.generatedAt), expires = Date.parse(payload.expiresAt);
    if (!Number.isFinite(generated) || !Number.isFinite(expires) || expires <= generated || expires - generated > MAX_CAPABILITY_CACHE_MS) return { kind: 'inconsistent', reason: 'invalid_window' };
    if (generated > t + MAX_CLOCK_SKEW_MS || expires <= t) return { kind: 'unavailable', reason: 'clock_skew' };
    return null;
  }

  /** Returns `{ source: 'fresh'|'cache'|'degraded'|'rejected', ...view }` or `null` when there is no verdict (legacy/shadow user, nothing known). */
  async function evaluate(user, { mode = 'legacy' } = {}) {
    if (!user?.personId) return null;
    const personId = user.personId, t = now();
    const cached = cache.get(personId);
    if (cached && cached.expiresAtMs > t) return view(cached.payload, 'cache');
    const rejected = rejections.get(personId);
    if (rejected && rejected.untilMs > t) return rejectedView(rejected);
    if (!enabled) { alert('platform_not_configured', {}); return degraded(user, cached, mode); }
    if (breaker.openUntil > t) return degraded(user, cached, mode);     // outage: no waiting on a service we already know is down
    let pending = inflight.get(personId);
    if (!pending) { pending = fetchFromPlatform(personId).finally(() => inflight.delete(personId)); inflight.set(personId, pending); }
    const result = await pending;
    const received = now();
    const problem = result.ok ? check(user, result.payload) : { kind: result.kind, reason: result.reason };
    if (!problem) {
      breaker.failures = 0; breaker.openUntil = 0; breaker.downSince = 0; rejections.delete(personId);
      cache.set(personId, { payload: result.payload, expiresAtMs: Math.min(Date.parse(result.payload.expiresAt), received + MAX_CAPABILITY_CACHE_MS), fetchedAtMs: received });
      const blocked = result.payload.capabilityLevel === 'blocked' ? { reasonCode: result.payload.reasonCode, at: new Date(received).toISOString() } : null;
      if (blocked && !(user.platformRestriction?.reasonCode === blocked.reasonCode)) onRestriction(user, blocked);
      if (!blocked && user.platformRestriction) onRestriction(user, null);
      if (blocked && result.payload.reasonCode !== 'ADMIN_SUSPENDED') onLinkLost(user, result.payload.reasonCode);
      return view(result.payload, 'fresh');
    }
    if (problem.kind === 'unavailable') {
      breaker.failures += 1;
      if (!breaker.downSince) breaker.downSince = received;
      breaker.openUntil = received + BREAKER_BACKOFF_MS[Math.min(breaker.failures - 1, BREAKER_BACKOFF_MS.length - 1)];
      alert('platform_unreachable', { reason: problem.reason, downForMs: received - breaker.downSince });
      return degraded(user, cached, mode);
    }
    // Rejection or inconsistency: the answer is a decision about this identity, not an outage. Fail closed, remember briefly, alert.
    const verdict = { kind: problem.kind, reason: problem.reason, untilMs: received + REJECTION_CACHE_MS };
    rejections.set(personId, verdict);
    alert(`platform_${problem.kind}`, { reason: problem.reason, personId });
    return rejectedView(verdict);
  }

  function degraded(user, cached, mode) {
    const view = degradedView({ lastPayload: cached?.payload, restriction: user.platformRestriction, mode });
    return view ? { source: 'degraded', ...view } : null;
  }
  function rejectedView(verdict) {
    return { source: 'rejected', level: 'blocked', reasonCode: verdict.kind === 'inconsistent' ? 'IDENTITY_INCONSISTENT' : 'PLATFORM_REJECTED', capabilities: blockedCapabilities(), degraded: false, verified: false, accessState: 'suspended' };
  }
  function view(payload, source) {
    return { source, level: payload.capabilityLevel, reasonCode: payload.reasonCode, capabilities: payload.capabilities, degraded: false, verified: true, accessState: payload.accessState };
  }
  const allows = (result, names) => Boolean(result) && names.every(name => result.capabilities[name] === true);
  const prime = (personId, payload) => cache.set(personId, { payload, expiresAtMs: Math.min(Date.parse(payload.expiresAt), now() + MAX_CAPABILITY_CACHE_MS), fetchedAtMs: now() });
  /** Operational view for logs/health: how long Platform has been unreachable (0 = reachable). */
  const status = () => ({ enabled, consecutiveFailures: breaker.failures, unreachableSinceMs: breaker.downSince ? now() - breaker.downSince : 0, breakerOpen: breaker.openUntil > now() });

  return { evaluate, allows, enabled, prime, status, _cache: cache };
}
