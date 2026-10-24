// One corpus of Platform answers (and failures) for the 2J-CAPABILITIES-V2 consumer, used two ways:
//   - test/platform-capabilities-conformance.test.js runs it against the consumer Búnker ships (platform-sso/capabilities.js);
//   - scripts/compare-capabilities-consumers.mjs runs the same corpus against the other candidate (Codex's platform-capabilities/consumer.js, commit 9377e517)
//     and prints where the two agree and where they differ, each difference with the reason.
// Every scenario states the verdict it expects from EACH consumer in a normalized vocabulary:
//   allow | baseline | suspended | revoked | not_linked   a valid answer was accepted and classified
//   rejected                                              the answer or the status was refused (fail closed)
//   unavailable                                           nothing usable arrived (outage, timeout, 5xx, unusable clock)
// When the two are expected to differ, `why` says why that is intended (or, for Codex, what it lacks).
export const CAPS = ['autonomousTraining', 'routineCreation', 'personalRoutineCreation', 'personalRoutineManagement', 'workoutRecording', 'workoutHistory', 'guidedTraining', 'premiumPrograms', 'aiCoach', 'professionalFollowUp'];
const BASE = new Set(['autonomousTraining', 'personalRoutineCreation', 'personalRoutineManagement', 'workoutRecording', 'workoutHistory']);
const flags = pick => Object.fromEntries(CAPS.map(name => [name, pick(name)]));
export const NOW = Date.parse('2026-10-23T12:00:00.000Z');
export const PERSON = '3f6c2d54-6a5b-4c1e-9a52-0d1f6a7b8c90', USER = 'training-user-1', OTHER_PERSON = '9b1d8f30-1c2e-4f5a-8b6d-2e3f4a5b6c7d';
const iso = ms => new Date(ms).toISOString();

/** A well-formed answer of the given kind; `patch` overrides top-level fields (so a scenario can break exactly one thing). */
export function snapshot(kind = 'baseline', patch = {}, { now = NOW, ttlMs = 60_000 } = {}) {
  const table = {
    full: { level: 'full', state: 'active', reason: 'ACTIVE_FULL', caps: flags(() => true) },
    autonomous: { level: 'autonomous', state: 'active', reason: 'ACTIVE_AUTONOMOUS', caps: flags(name => BASE.has(name) || ['routineCreation', 'guidedTraining', 'premiumPrograms'].includes(name)) },
    provisional: { level: 'full', state: 'provisional', reason: 'PROVISIONAL_FULL', caps: flags(() => true) },
    baseline: { level: 'baseline', state: 'baseline', reason: 'FREE_BASELINE', caps: flags(name => BASE.has(name)) },
    suspended: { level: 'blocked', state: 'suspended', reason: 'ADMIN_SUSPENDED', caps: flags(() => false), suspension: 'suspended' },
    revoked: { level: 'blocked', state: 'ended', reason: 'TRAINING_LINK_REVOKED', caps: flags(() => false), link: 'revoked' },
    missing: { level: 'blocked', state: 'ended', reason: 'TRAINING_LINK_MISSING', caps: flags(() => false), link: 'not_linked' },
  }[kind];
  return {
    contract: '2J-CAPABILITIES-V2', version: 2, personId: PERSON,
    trainingSubject: table.link ? { linkStatus: table.link } : { linkStatus: 'active', trainingUserId: USER },
    capabilityLevel: table.level, accessState: table.state, capabilities: table.caps, reasonCode: table.reason,
    suspensionStatus: table.suspension ?? 'none', effectiveFrom: null,
    expiresAt: iso(now + ttlMs), generatedAt: iso(now), source: { platform: true }, ...patch,
  };
}
const without = (object, key) => { const copy = { ...object }; delete copy[key]; return copy; };
const caps = patch => ({ capabilities: { ...snapshot('baseline').capabilities, ...patch } });

/** An HTTP answer. A plain object (not `Response`) so a scenario can also say "redirected" or "from another URL". */
export function http(status, body, extra = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const bytes = new TextEncoder().encode(text);
  const response = new Response(bytes, { status, headers: { 'content-type': 'application/json' } });
  if (!Object.keys(extra).length) return response;
  return { ok: status >= 200 && status < 300, status, redirected: false, url: '', headers: response.headers, json: async () => JSON.parse(text), text: async () => text, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), body: response.body, ...extra };
}
const both = (verdict, why) => ({ claude: verdict, codex: verdict, ...(why ? { why } : {}) });
const differ = (claude, codex, why) => ({ claude, codex, why });

/** Single-request scenarios: the first call after start-up, nothing cached. `respond(init)` returns an answer or throws; `timeoutMs` shortens the wait for `hang`. */
export const scenarios = [
  // ---- valid answers
  { id: 'valid-full', group: 'valid', respond: () => http(200, snapshot('full')), expect: both('allow') },
  { id: 'valid-autonomous', group: 'valid', respond: () => http(200, snapshot('autonomous')), expect: both('allow') },
  { id: 'valid-provisional', group: 'valid', respond: () => http(200, snapshot('provisional')), expect: both('allow') },
  { id: 'valid-baseline', group: 'valid', respond: () => http(200, snapshot('baseline')), expect: both('baseline') },
  { id: 'valid-lifted-suspension', group: 'valid', respond: () => http(200, snapshot('baseline', { suspensionStatus: 'lifted' })), expect: both('baseline') },
  { id: 'valid-suspended', group: 'valid', respond: () => http(200, snapshot('suspended')), expect: both('suspended') },
  { id: 'valid-link-revoked', group: 'valid', respond: () => http(200, snapshot('revoked')), expect: both('revoked') },
  { id: 'valid-link-missing', group: 'valid', respond: () => http(200, snapshot('missing')), expect: both('not_linked') },
  { id: 'valid-ttl-exactly-60s', group: 'valid', respond: () => http(200, snapshot('full', {}, { ttlMs: 60_000 })), expect: both('allow') },
  { id: 'valid-timestamp-without-milliseconds', group: 'valid', respond: () => http(200, snapshot('full', { generatedAt: '2026-10-23T12:00:00Z', expiresAt: '2026-10-23T12:00:30Z' })), expect: both('allow', 'RFC 3339 timestamps without a fraction are valid dates') },

  // ---- the answer breaks the contract or is about somebody else
  { id: 'other-person', group: 'identity', respond: () => http(200, snapshot('full', { personId: OTHER_PERSON })), expect: both('rejected') },
  { id: 'other-training-user', group: 'identity', respond: () => http(200, snapshot('full', { trainingSubject: { linkStatus: 'active', trainingUserId: 'someone-else' } })), expect: both('rejected') },
  { id: 'unknown-field', group: 'contract', respond: () => http(200, snapshot('full', { extra: true })), expect: both('rejected') },
  { id: 'unknown-version', group: 'contract', respond: () => http(200, snapshot('full', { version: 3 })), expect: both('rejected') },
  { id: 'wrong-contract-name', group: 'contract', respond: () => http(200, snapshot('full', { contract: '2J-CAPABILITIES-V3' })), expect: both('rejected') },
  { id: 'missing-capability-key', group: 'contract', respond: () => http(200, snapshot('full', { capabilities: without(snapshot('full').capabilities, 'aiCoach') })), expect: both('rejected') },
  { id: 'extra-capability-key', group: 'contract', respond: () => http(200, snapshot('full', { capabilities: { ...snapshot('full').capabilities, teleport: true } })), expect: both('rejected') },
  { id: 'unknown-reason-code', group: 'contract', respond: () => http(200, snapshot('full', { reasonCode: 'SOMETHING_NEW' })), expect: both('rejected') },
  { id: 'capability-not-boolean', group: 'contract', respond: () => http(200, snapshot('full', { capabilities: { ...snapshot('full').capabilities, aiCoach: 'yes' } })), expect: both('rejected') },
  { id: 'ttl-above-60s', group: 'window', respond: () => http(200, snapshot('full', { expiresAt: iso(NOW + 120_000) })), expect: both('rejected') },
  { id: 'expires-before-generated', group: 'window', respond: () => http(200, snapshot('full', { expiresAt: iso(NOW - 1) })), expect: both('rejected', 'an impossible window (expires before it was generated) fails closed in both') },
  { id: 'already-expired', group: 'window', respond: () => http(200, snapshot('full', { generatedAt: iso(NOW - 30_000), expiresAt: iso(NOW - 1) })), expect: differ('unavailable', 'rejected', 'decision H4: an answer our clock cannot use is an outage (degrade), not a refusal') },
  { id: 'issued-10-minutes-in-the-future', group: 'window', respond: () => http(200, snapshot('full', { generatedAt: iso(NOW + 600_000), expiresAt: iso(NOW + 640_000) })), expect: differ('unavailable', 'rejected', 'decision H4: a skewed clock is unavailability') },
  { id: 'issued-30-seconds-in-the-future', group: 'window', respond: () => http(200, snapshot('full', { generatedAt: iso(NOW + 30_000), expiresAt: iso(NOW + 60_000) })), expect: differ('allow', 'rejected', 'Búnker tolerates up to 60 s of clock skew between the two hosts; the cache is bounded by OUR clock anyway (H4)') },

  // ---- internal consistency (a Platform bug or a tampered answer must never widen access)
  { id: 'baseline-reason-with-paid-flags', group: 'consistency', respond: () => http(200, snapshot('baseline', caps({ aiCoach: true }))), expect: both('rejected') },
  { id: 'baseline-reason-with-level-full', group: 'consistency', respond: () => http(200, snapshot('baseline', { capabilityLevel: 'full' })), expect: both('rejected') },
  { id: 'suspended-reason-with-level-full-and-flags', group: 'consistency', respond: () => http(200, snapshot('full', { reasonCode: 'ADMIN_SUSPENDED' })), expect: both('rejected') },
  { id: 'suspended-state-but-flags-granted', group: 'consistency', respond: () => http(200, snapshot('suspended', caps({ workoutHistory: true }))), expect: both('rejected') },
  { id: 'suspension-flag-with-active-reason', group: 'consistency', respond: () => http(200, snapshot('full', { suspensionStatus: 'suspended' })), expect: both('rejected') },
  { id: 'revoked-link-with-flags-granted', group: 'consistency', respond: () => http(200, snapshot('revoked', { capabilityLevel: 'full', capabilities: snapshot('full').capabilities })), expect: both('rejected') },
  { id: 'revoked-link-with-missing-reason', group: 'consistency', respond: () => http(200, snapshot('revoked', { reasonCode: 'TRAINING_LINK_MISSING' })), expect: both('rejected') },
  { id: 'active-link-with-revoked-reason', group: 'consistency', respond: () => http(200, snapshot('full', { reasonCode: 'TRAINING_LINK_REVOKED' })), expect: both('rejected') },
  { id: 'baseline-state-with-paid-reason', group: 'consistency', respond: () => http(200, snapshot('full', { accessState: 'baseline' })), expect: both('rejected') },
  { id: 'free-baseline-reason-with-active-state', group: 'consistency', respond: () => http(200, snapshot('baseline', { accessState: 'active' })), expect: both('rejected') },
  { id: 'blocked-level-with-flags-granted', group: 'consistency', respond: () => http(200, snapshot('suspended', { capabilities: snapshot('full').capabilities })), expect: both('rejected') },
  { id: 'paid-reason-with-blocked-level', group: 'consistency', respond: () => http(200, snapshot('full', { capabilityLevel: 'blocked', capabilities: snapshot('suspended').capabilities })), expect: differ('rejected', 'allow', 'level "blocked" with no restriction reason is a contradiction; the other consumer accepts it (harmless today: every flag is false, but it would trust a malformed answer)') },

  // ---- transport and status
  { id: 'network-error', group: 'transport', respond: () => { throw new Error('ECONNREFUSED'); }, expect: both('unavailable') },
  { id: 'timeout', group: 'transport', timeoutMs: 40, respond: init => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))), expect: both('unavailable') },
  { id: 'http-500', group: 'transport', respond: () => http(500, { error: 'boom' }), expect: both('unavailable') },
  { id: 'http-503', group: 'transport', respond: () => http(503, { error: 'busy' }), expect: both('unavailable') },
  { id: 'http-429', group: 'transport', respond: () => http(429, { error: 'slow down' }), expect: differ('unavailable', 'rejected', 'decision H6: being rate limited is not a decision about this person; degrade to the safe view') },
  { id: 'http-408', group: 'transport', respond: () => http(408, { error: 'timeout' }), expect: differ('unavailable', 'rejected', 'decision H6: a timeout answer is an outage') },
  { id: 'http-401', group: 'transport', respond: () => http(401, { error: 'service_auth_rejected' }), expect: both('rejected') },
  { id: 'http-403', group: 'transport', respond: () => http(403, { error: 'forbidden' }), expect: both('rejected') },
  { id: 'http-404', group: 'transport', respond: () => http(404, { error: 'person_not_found' }), expect: both('rejected') },
  { id: 'http-400', group: 'transport', respond: () => http(400, { error: 'bad' }), expect: both('rejected') },
  { id: 'http-302-redirect', group: 'transport', respond: () => http(302, '', {}), expect: both('rejected') },
  { id: 'invalid-json', group: 'transport', respond: () => http(200, '{not json'), expect: both('rejected') },
  { id: 'empty-body', group: 'transport', respond: () => http(200, ''), expect: both('rejected') },
  { id: 'json-array-instead-of-object', group: 'transport', respond: () => http(200, '[]'), expect: both('rejected') },
  { id: 'oversized-body-of-a-valid-answer', group: 'transport', respond: () => http(200, `${JSON.stringify(snapshot('full'))}${' '.repeat(200_000)}`), expect: both('rejected', 'an answer of this size is not a capability snapshot; the read is bounded (64 KB)') },
  { id: 'answer-says-it-was-redirected', group: 'transport', respond: () => http(200, snapshot('full'), { redirected: true }), expect: both('rejected', 'a snapshot that did not come from the configured origin is not trusted') },
  { id: 'answer-from-another-url', group: 'transport', respond: () => http(200, snapshot('full'), { url: 'http://evil.example/api/internal/platform/v2/persons/x/training-capabilities' }), expect: both('rejected') },
];

/**
 * Multi-call scenarios. `steps` run in order against ONE consumer; each step may move the clock first, names the answer Platform gives, and the verdict expected.
 * `fetches` is how many requests Platform should have received in total (the cache and single-flight behaviour), when the two are meant to agree.
 */
export const sequences = [
  { id: 'cache-hit-within-ttl', steps: [{ answer: () => http(200, snapshot('full')), expect: 'allow' }, { advance: 10_000, answer: () => { throw new Error('must not be asked'); }, expect: 'allow' }], fetches: 1 },
  { id: 'cache-ends-at-60s-on-our-clock', steps: [{ answer: () => http(200, snapshot('full')), expect: 'allow' }, { advance: 61_000, answer: () => http(200, snapshot('baseline', {}, { now: NOW + 61_000 })), expect: 'baseline' }], fetches: 2 },
  { id: 'expired-cache-and-outage', steps: [{ answer: () => http(200, snapshot('full', {}, { ttlMs: 5_000 })), expect: 'allow' }, { advance: 6_000, answer: () => { throw new Error('ECONNREFUSED'); }, expect: 'unavailable' }], fetches: 2 },
  { id: 'rejection-after-a-valid-answer', steps: [{ answer: () => http(200, snapshot('full', {}, { ttlMs: 5_000 })), expect: 'allow' }, { advance: 6_000, answer: () => http(403, { error: 'forbidden' }), expect: 'rejected' }], fetches: 2 },
  { id: 'suspension-is-classified-and-then-lifted', steps: [{ answer: () => http(200, snapshot('suspended', {}, { ttlMs: 5_000 })), expect: 'suspended' }, { advance: 6_000, answer: () => http(200, snapshot('baseline', {}, { now: NOW + 6_000 })), expect: 'baseline' }], fetches: 2 },
  { id: 'concurrent-callers-share-one-request', concurrent: 5, steps: [{ answer: () => http(200, snapshot('full')), expect: 'allow' }], fetches: 1 },
];

// ---------------------------------------------------------------------------------------------------------------------------------------------
// 2J-CAPABILITIES-V2.1 (owner decisions D40, D41, A23). Only the Búnker consumer in this repository speaks V2.1 (the other candidate was written for V2), so
// these scenarios carry a single expected verdict. `asks` is the contract the consumer was configured to request.
// ---------------------------------------------------------------------------------------------------------------------------------------------
const BASE21 = new Set([...BASE, 'guidedTraining', 'premiumPrograms']);
export function snapshot21(kind = 'baseline', patch = {}, { now = NOW, ttlMs = 60_000 } = {}) {
  const table = {
    baseline: { level: 'baseline', state: 'baseline', reason: 'FREE_BASELINE', caps: flags(name => BASE21.has(name)) },
    'baseline-unlinked': { level: 'baseline', state: 'baseline', reason: 'FREE_BASELINE', caps: flags(name => BASE21.has(name)), link: 'not_linked' },
    full: { level: 'full', state: 'active', reason: 'ACTIVE_FULL', caps: flags(() => true) },
    suspended: { level: 'blocked', state: 'suspended', reason: 'ADMIN_SUSPENDED', caps: flags(() => false), suspension: 'suspended' },
    'suspended-unlinked': { level: 'blocked', state: 'suspended', reason: 'ADMIN_SUSPENDED', caps: flags(() => false), suspension: 'suspended', link: 'not_linked' },
    revoked: { level: 'blocked', state: 'ended', reason: 'TRAINING_LINK_REVOKED', caps: flags(() => false), link: 'revoked' },
  }[kind];
  return {
    contract: '2J-CAPABILITIES-V2.1', revision: 1, version: 2, personId: PERSON,
    trainingSubject: table.link ? { linkStatus: table.link } : { linkStatus: 'active', trainingUserId: USER },
    capabilityLevel: table.level, accessState: table.state, capabilities: table.caps, reasonCode: table.reason,
    suspensionStatus: table.suspension ?? 'none', effectiveFrom: null, expiresAt: iso(now + ttlMs), generatedAt: iso(now), source: { platform: true }, ...patch,
  };
}
const only = verdict => ({ claude: verdict });
export const scenarios21 = [
  { id: 'v21-baseline-linked-includes-guided-and-premium', asks: 'V2.1', respond: () => http(200, snapshot21('baseline')), expect: only('baseline') },
  { id: 'v21-baseline-unlinked-person-is-registered', asks: 'V2.1', respond: () => http(200, snapshot21('baseline-unlinked')), expect: only('baseline') },
  { id: 'v21-paid-level', asks: 'V2.1', respond: () => http(200, snapshot21('full')), expect: only('allow') },
  { id: 'v21-suspended-linked', asks: 'V2.1', respond: () => http(200, snapshot21('suspended')), expect: only('suspended') },
  { id: 'v21-suspended-unlinked', asks: 'V2.1', respond: () => http(200, snapshot21('suspended-unlinked')), expect: only('suspended') },
  { id: 'v21-revoked-link-stays-blocked', asks: 'V2.1', respond: () => http(200, snapshot21('revoked')), expect: only('revoked') },
  { id: 'v21-baseline-without-guided-and-premium', asks: 'V2.1', respond: () => http(200, snapshot21('baseline', { capabilities: flags(name => BASE.has(name)) })), expect: only('rejected') },
  { id: 'v21-baseline-with-ai-coach', asks: 'V2.1', respond: () => http(200, snapshot21('baseline', { capabilities: { ...snapshot21('baseline').capabilities, aiCoach: true } })), expect: only('rejected') },
  { id: 'v21-baseline-with-professional-follow-up', asks: 'V2.1', respond: () => http(200, snapshot21('baseline', { capabilities: { ...snapshot21('baseline').capabilities, professionalFollowUp: true } })), expect: only('rejected') },
  { id: 'v21-baseline-with-routine-creation', asks: 'V2.1', respond: () => http(200, snapshot21('baseline', { capabilities: { ...snapshot21('baseline').capabilities, routineCreation: true } })), expect: only('rejected') },
  { id: 'v21-unlinked-with-link-missing-reason', asks: 'V2.1', respond: () => http(200, snapshot21('baseline-unlinked', { reasonCode: 'TRAINING_LINK_MISSING', capabilityLevel: 'blocked', accessState: 'ended', capabilities: flags(() => false) })), expect: only('rejected') },
  { id: 'v21-unlinked-with-paid-level', asks: 'V2.1', respond: () => http(200, snapshot21('full', { trainingSubject: { linkStatus: 'not_linked' } })), expect: only('rejected') },
  { id: 'v21-unlinked-carrying-a-training-user', asks: 'V2.1', respond: () => http(200, snapshot21('baseline-unlinked', { trainingSubject: { linkStatus: 'not_linked', trainingUserId: USER } })), expect: only('rejected') },
  { id: 'v21-suspended-with-open-flags', asks: 'V2.1', respond: () => http(200, snapshot21('suspended', { capabilities: snapshot21('baseline').capabilities })), expect: only('rejected') },
  { id: 'v21-suspension-flag-with-baseline-reason', asks: 'V2.1', respond: () => http(200, snapshot21('baseline', { suspensionStatus: 'suspended' })), expect: only('rejected') },
  { id: 'v21-revoked-with-flags', asks: 'V2.1', respond: () => http(200, snapshot21('revoked', { capabilityLevel: 'baseline', capabilities: snapshot21('baseline').capabilities })), expect: only('rejected') },
  { id: 'v21-revision-missing', asks: 'V2.1', respond: () => { const { revision, ...rest } = snapshot21('baseline'); return http(200, rest); }, expect: only('rejected') },
  { id: 'v21-revision-2', asks: 'V2.1', respond: () => http(200, snapshot21('baseline', { revision: 2 })), expect: only('rejected') },
  { id: 'v21-asked-v21-got-v2', asks: 'V2.1', respond: () => http(200, snapshot('baseline')), expect: only('rejected') },
  { id: 'v21-asked-v2-got-v21', asks: 'V2', respond: () => http(200, snapshot21('baseline')), expect: only('rejected') },
  { id: 'v21-other-person', asks: 'V2.1', respond: () => http(200, snapshot21('baseline', { personId: OTHER_PERSON })), expect: only('rejected') },
  { id: 'v21-outage-is-unavailable', asks: 'V2.1', respond: () => { throw new Error('ECONNREFUSED'); }, expect: only('unavailable') },
  { id: 'v21-404-person-not-known', asks: 'V2.1', respond: () => http(404, { error: 'person_not_found' }), expect: only('rejected') },
];
export const sequences21 = [
  { id: 'v21-unlinked-baseline-is-cached-within-ttl', asks: 'V2.1', steps: [{ answer: () => http(200, snapshot21('baseline-unlinked')), expect: 'baseline' }, { advance: 10_000, answer: () => { throw new Error('must not be asked'); }, expect: 'baseline' }], fetches: 1 },
  { id: 'v21-suspension-then-lift', asks: 'V2.1', steps: [{ answer: () => http(200, snapshot21('suspended-unlinked', {}, { ttlMs: 5_000 })), expect: 'suspended' }, { advance: 6_000, answer: () => http(200, snapshot21('baseline-unlinked', {}, { now: NOW + 6_000 })), expect: 'baseline' }], fetches: 2 },
];
