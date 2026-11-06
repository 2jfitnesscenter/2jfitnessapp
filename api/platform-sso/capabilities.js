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
  effectiveFrom: z.union([z.iso.date(), z.null()]),
  expiresAt: z.iso.datetime({ offset: false }),
  generatedAt: z.iso.datetime({ offset: false }),
  source: z.object({ platform: z.literal(true) }).strict(),
}).strict();

export const CAPABILITIES_V2 = '2J-CAPABILITIES-V2', CAPABILITIES_V21 = '2J-CAPABILITIES-V2.1';
/** V2.1 (owner decisions D40, D41, A23): same shape plus `revision: 1`; a separate contract id, so V2 keeps validating exactly as before. */
export const capabilitiesV21Schema = capabilitiesV2Schema.omit({ contract: true }).extend({ contract: z.literal(CAPABILITIES_V21), revision: z.literal(1) }).strict();
export const capabilitiesSchemaFor = contract => (contract === CAPABILITIES_V21 ? capabilitiesV21Schema : capabilitiesV2Schema);
const BASELINE_FLAGS_V21 = new Set(['autonomousTraining', 'personalRoutineCreation', 'personalRoutineManagement', 'workoutRecording', 'workoutHistory', 'guidedTraining', 'premiumPrograms']);
const BASELINE_FLAGS = new Set(['autonomousTraining', 'personalRoutineCreation', 'personalRoutineManagement', 'workoutRecording', 'workoutHistory']);
export const baselineCapabilities = (contract = CAPABILITIES_V2) => Object.fromEntries(CAPABILITY_NAMES.map(name => [name, (contract === CAPABILITIES_V21 ? BASELINE_FLAGS_V21 : BASELINE_FLAGS).has(name)]));
export const blockedCapabilities = () => Object.fromEntries(CAPABILITY_NAMES.map(name => [name, false]));
const MAX_CLOCK_SKEW_MS = 60_000;
/** A snapshot is bounded: a real one is under 2 KB; anything near this size is not a capability answer. */
export const MAX_RESPONSE_BYTES = 64 * 1024;

/**
 * Cross-field invariants (ported from the other consumer, 2J-INT-CLOSURE decision 2): the answer must not contradict itself.
 * A Platform bug or a tampered answer saying "suspended" with open flags, or "free baseline" with paid flags, is refused instead of being believed in the
 * direction that happens to widen access. Returns the reason, or null.
 */
export function inconsistency(payload) {
  const { linkStatus, trainingUserId } = payload.trainingSubject, reason = payload.reasonCode, flagsOn = Object.values(payload.capabilities).some(Boolean);
  if (payload.contract === CAPABILITIES_V21) return inconsistencyV21(payload, { linkStatus, trainingUserId, reason, flagsOn });
  if (linkStatus !== 'active') {
    if (trainingUserId !== undefined || reason !== (linkStatus === 'revoked' ? 'TRAINING_LINK_REVOKED' : 'TRAINING_LINK_MISSING')) return 'link_state_inconsistent';
    if (payload.capabilityLevel !== 'blocked' || flagsOn) return 'link_capability_state_inconsistent';
    return null;
  }
  if (!trainingUserId || reason === 'TRAINING_LINK_MISSING' || reason === 'TRAINING_LINK_REVOKED') return 'link_state_inconsistent';
  const suspended = reason === 'ADMIN_SUSPENDED' || payload.accessState === 'suspended';
  if (suspended) {
    return payload.accessState !== 'suspended' || payload.suspensionStatus !== 'suspended' || reason !== 'ADMIN_SUSPENDED' || payload.capabilityLevel !== 'blocked' || flagsOn ? 'suspension_state_inconsistent' : null;
  }
  if (payload.suspensionStatus === 'suspended') return 'suspension_state_inconsistent';
  if (reason === 'FREE_BASELINE') {
    if (payload.capabilityLevel !== 'baseline' || payload.accessState !== 'baseline' || CAPABILITY_NAMES.some(name => payload.capabilities[name] !== BASELINE_FLAGS.has(name))) return 'baseline_state_inconsistent';
  } else if (payload.accessState === 'baseline') return 'baseline_state_inconsistent';
  if (payload.capabilityLevel === 'blocked') return 'blocked_level_without_restriction';
  return null;
}

/**
 * V2.1 differences from V2 (the rest of the checks are the same): a person with no link is a registered person, so `not_linked` is valid with the
 * (V2.1) free baseline or with a suspension; a revoked link is blocked; TRAINING_LINK_MISSING is never produced; the baseline includes guidedTraining and premiumPrograms.
 */
function inconsistencyV21(payload, { linkStatus, trainingUserId, reason, flagsOn }) {
  const baselineOk = () => payload.capabilityLevel === 'baseline' && payload.accessState === 'baseline' && CAPABILITY_NAMES.every(name => payload.capabilities[name] === BASELINE_FLAGS_V21.has(name));
  const suspendedOk = () => payload.accessState === 'suspended' && payload.suspensionStatus === 'suspended' && payload.capabilityLevel === 'blocked' && !flagsOn;
  if (reason === 'TRAINING_LINK_MISSING') return 'link_state_inconsistent';
  if (linkStatus === 'revoked') {
    if (trainingUserId !== undefined || reason !== 'TRAINING_LINK_REVOKED') return 'link_state_inconsistent';
    return payload.capabilityLevel !== 'blocked' || flagsOn ? 'link_capability_state_inconsistent' : null;
  }
  if (linkStatus === 'not_linked' && trainingUserId !== undefined) return 'link_state_inconsistent';
  if (linkStatus === 'active' && !trainingUserId) return 'link_state_inconsistent';
  if (reason === 'TRAINING_LINK_REVOKED') return 'link_state_inconsistent';
  if (reason === 'ADMIN_SUSPENDED' || payload.accessState === 'suspended') return reason === 'ADMIN_SUSPENDED' && suspendedOk() ? null : 'suspension_state_inconsistent';
  if (payload.suspensionStatus === 'suspended') return 'suspension_state_inconsistent';
  if (linkStatus === 'not_linked') return reason === 'FREE_BASELINE' && baselineOk() ? null : 'link_state_inconsistent';       // a person with no link is only ever baseline (or suspended)
  if (reason === 'FREE_BASELINE') return baselineOk() ? null : 'baseline_state_inconsistent';
  if (payload.accessState === 'baseline') return 'baseline_state_inconsistent';
  if (payload.capabilityLevel === 'blocked') return 'blocked_level_without_restriction';
  return null;
}

/** Reads at most `maxBytes` of the body (declared length and bytes actually received), so a hostile or broken answer cannot exhaust memory. */
async function readBounded(response, maxBytes) {
  const declared = response.headers?.get?.('content-length');
  if (declared && Number(declared) > maxBytes) throw new Error('response_too_large');
  if (typeof response.arrayBuffer !== 'function' && !response.body?.getReader) return JSON.stringify(await response.json());    // not a fetch Response (test doubles): nothing to bound
  if (!response.body?.getReader) {
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) throw new Error('response_too_large');
    return new TextDecoder().decode(bytes);
  }
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) { await reader.cancel().catch(() => {}); throw new Error('response_too_large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(all);
}
const RESTRICTION_REASONS = new Set(['ADMIN_SUSPENDED', 'TRAINING_LINK_REVOKED', 'TRAINING_LINK_MISSING']);

/**
 * Safe-degradation view, used when no fresh Platform answer is available.
 *  - A known suspension / revoked link keeps blocking (it is never forgotten, even across restarts).
 *  - Otherwise only the free baseline is granted: paid capabilities are never granted without verification.
 *  - A user with no history at all and no known restriction is left to the caller (`null`): legacy/shadow users
 *    keep their current access; enforced users fall back to the baseline.
 */
export function degradedView({ lastPayload, restriction, mode, contract = CAPABILITIES_V2 }) {
  const reason = restriction?.reasonCode ?? (lastPayload && lastPayload.capabilityLevel === 'blocked' ? lastPayload.reasonCode : null);
  if (reason && RESTRICTION_REASONS.has(reason)) return { level: 'blocked', reasonCode: reason, capabilities: blockedCapabilities(), degraded: true, verified: false };
  if (lastPayload || mode === 'enforced') return { level: 'baseline', reasonCode: 'FREE_BASELINE', capabilities: baselineCapabilities(contract), degraded: true, verified: false };
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
  const contract = config?.contract === CAPABILITIES_V21 ? CAPABILITIES_V21 : CAPABILITIES_V2;     // V2 unless the operator opted in; `config` is null while Platform is not configured
  const pairKey = (personId, trainingUserId) => `${personId}\n${trainingUserId}`;      // every memory below is partitioned by (person, Training user)
  const answersFor = (payload, user) => payload.personId === user.personId && (payload.trainingSubject.linkStatus !== 'active' || payload.trainingSubject.trainingUserId === user.id);
  const cache = new Map();      // pair -> { payload, expiresAtMs, fetchedAtMs }
  const rejections = new Map(); // pair -> { kind, reason, untilMs }
  const inflight = new Map();   // pair -> Promise
  const epochs = new Map();     // personId -> how many times a signed signal made us forget what we knew (an answer fetched before that is stale)
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
    const path = `/api/internal/platform/${contract === CAPABILITIES_V21 ? 'v2.1' : 'v2'}/persons/${personId}/training-capabilities`;
    const timestamp = new Date(now()).toISOString(), requestId = globalThis.crypto.randomUUID();
    const { signature } = signPlatformServiceRequest({ keyId: config.keyId, secret: config.secret, timestamp, requestId, method: 'GET', path, body: Buffer.alloc(0) });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const expected = new URL(path, config.baseUrl);
      const response = await fetchImpl(expected, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { 'x-2j-key-id': config.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature },
      });
      if (!response.ok) {
        const status = response.status;
        if (status >= 500 || status === 408 || status === 429) return { ok: false, kind: 'unavailable', reason: `http_${status}` };
        return { ok: false, kind: 'rejected', reason: `http_${status}` };
      }
      // A snapshot that did not come from the origin and path we asked is not trusted, whatever it says.
      if (response.redirected) return { ok: false, kind: 'inconsistent', reason: 'response_origin_mismatch' };
      if (response.url) {
        try {
          const final = new URL(response.url);
          if (final.origin !== expected.origin || final.pathname !== expected.pathname || final.search || final.hash) return { ok: false, kind: 'inconsistent', reason: 'response_origin_mismatch' };
        } catch { return { ok: false, kind: 'inconsistent', reason: 'response_origin_mismatch' }; }
      }
      let body;
      try { body = JSON.parse(await readBounded(response, MAX_RESPONSE_BYTES)); } catch (error) { return { ok: false, kind: 'inconsistent', reason: error?.message === 'response_too_large' ? 'response_too_large' : 'invalid_json' }; }
      const parsed = capabilitiesSchemaFor(contract).safeParse(body);
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
    const contradiction = inconsistency(payload);
    return contradiction ? { kind: 'inconsistent', reason: contradiction } : null;
  }

  /** Returns `{ source: 'fresh'|'cache'|'degraded'|'rejected', ...view }` or `null` when there is no verdict (legacy/shadow user, nothing known). */
  async function evaluate(user, { mode = 'legacy', again = false } = {}) {
    if (!user?.personId) return null;
    const personId = user.personId, t = now(), key = pairKey(personId, user.id);
    const cached = cache.get(key);
    // A cache hit is revalidated against the Training user asking: an answer is about ONE (person, Training user) pair.
    if (cached && cached.expiresAtMs > t && answersFor(cached.payload, user)) return view(cached.payload, 'cache');
    if (cached && !answersFor(cached.payload, user)) cache.delete(key);
    const rejected = rejections.get(key);
    if (rejected && rejected.untilMs > t) return rejectedView(rejected);
    if (!enabled) { alert('platform_not_configured', {}); return degraded(user, cached, mode); }
    if (breaker.openUntil > t) return degraded(user, cached, mode);     // outage: no waiting on a service we already know is down
    const epoch = epochs.get(personId) ?? 0;
    let pending = inflight.get(key);
    if (!pending) { const own = fetchFromPlatform(personId).finally(() => { if (inflight.get(key) === own) inflight.delete(key); }); pending = own; inflight.set(key, pending); }
    const result = await pending;
    // A signed signal arrived while this answer was on its way: it may describe a state from before the change, so it is not used (asked again, once).
    if ((epochs.get(personId) ?? 0) !== epoch && !again) return evaluate(user, { mode, again: true });
    const received = now();
    const problem = result.ok ? check(user, result.payload) : { kind: result.kind, reason: result.reason };
    if (!problem) {
      breaker.failures = 0; breaker.openUntil = 0; breaker.downSince = 0; rejections.delete(key);
      cache.set(key, { payload: result.payload, expiresAtMs: Math.min(Date.parse(result.payload.expiresAt), received + MAX_CAPABILITY_CACHE_MS), fetchedAtMs: received });
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
    rejections.set(key, verdict);
    alert(`platform_${problem.kind}`, { reason: problem.reason, personId });
    return rejectedView(verdict);
  }

  function degraded(user, cached, mode) {
    const view = degradedView({ lastPayload: cached?.payload, restriction: user.platformRestriction, mode, contract: contract });
    return view ? { source: 'degraded', ...view } : null;
  }
  function rejectedView(verdict) {
    return { source: 'rejected', level: 'blocked', reasonCode: verdict.kind === 'inconsistent' ? 'IDENTITY_INCONSISTENT' : 'PLATFORM_REJECTED', capabilities: blockedCapabilities(), degraded: false, verified: false, accessState: 'suspended' };
  }
  function view(payload, source) {
    return { source, level: payload.capabilityLevel, reasonCode: payload.reasonCode, capabilities: payload.capabilities, degraded: false, verified: true, accessState: payload.accessState };
  }
  const allows = (result, names) => Boolean(result) && names.every(name => result.capabilities[name] === true);
  /** A signed Platform signal says something changed for this person: drop every cached verdict and any answer still in flight, so the next evaluation asks Platform. */
  const forget = personId => { epochs.set(personId, (epochs.get(personId) ?? 0) + 1); for (const map of [cache, rejections, inflight]) for (const stored of [...map.keys()]) if (stored.startsWith(`${personId}\n`)) map.delete(stored); };
  /** Only for the pair the answer names (an answer with no Training user, a person who is not linked, cannot be primed: it is fetched for whoever asks). */
  const prime = (personId, payload) => payload.trainingSubject?.trainingUserId && cache.set(pairKey(personId, payload.trainingSubject.trainingUserId), { payload, expiresAtMs: Math.min(Date.parse(payload.expiresAt), now() + MAX_CAPABILITY_CACHE_MS), fetchedAtMs: now() });
  /** Operational view for logs/health: how long Platform has been unreachable (0 = reachable). */
  const status = () => ({ enabled, consecutiveFailures: breaker.failures, unreachableSinceMs: breaker.downSince ? now() - breaker.downSince : 0, breakerOpen: breaker.openUntil > now() });

  return { evaluate, allows, enabled, prime, forget, status, _cache: cache };
}
