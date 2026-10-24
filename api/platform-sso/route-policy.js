// Route classification for Platform capability enforcement and SSO sessions.
//
// Session-authenticated Bunker routes (pin, pin/reset, handoff) are gated here; only room-token routes are `kiosk`.
// Verified against the real route table (api/server.js + api/lib/*-routes.js + api/bunker/routes.js):
//  - guided/premium/opposition WRITE routes are staff-only (requireTrainer/requireAdmin inside the handler);
//    only a few read/"started" routes are member-facing, so only those carry a member capability.
//  - kiosk (Bunker room) routes identify the member by PIN/room token inside the handler, not by a gymsid
//    session, so they are gated in the handler through `memberGate`, not here.
//  - Staff functions never depend on the staff member's own capabilities (they keep their role guards).
//
// Every route key must classify to something other than `unclassified`; the test suite enumerates the real
// routes and fails on a new, unclassified one. An `sso` session may only call routes with `ssoAllowed`.

const E = (kind, extra = {}) => ({ kind, ssoAllowed: false, ...extra });

/** Exact keys first. `capabilities` lists capability names from 2J-CAPABILITIES-V2 that must ALL be true. */
const EXACT = new Map([
  // Own training state, sync and activity.
  ['GET /api/data', E('gated', { ssoAllowed: true, capabilities: ['workoutHistory'] })],
  ['PUT /api/data', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining', 'personalRoutineManagement'] })],
  ['GET /api/sync', E('gated', { ssoAllowed: true, capabilities: ['workoutHistory'] })],
  ['POST /api/sync', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining', 'personalRoutineManagement'] })],
  ['POST /api/activity', E('gated', { ssoAllowed: true, capabilities: ['workoutRecording'] })],
  ['POST /api/workouts/delete', E('gated', { ssoAllowed: true, capabilities: ['workoutRecording'] })],
  ['POST /api/active/activity', E('gated', { ssoAllowed: true, capabilities: ['workoutRecording'] })],
  ['POST /api/active/clear', E('gated', { ssoAllowed: true, capabilities: ['workoutRecording'] })],
  ['POST /api/active/finish-inactive', E('gated', { ssoAllowed: true, capabilities: ['workoutRecording'] })],
  ['GET /api/exercise-notes', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining'] })],
  ['POST /api/exercise-notes', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining'] })],
  ['GET /api/exercises/alias', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining'] })],
  ['POST /api/exercises/alias', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining'] })],
  ['GET /api/exercises/import-aliases', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining'] })],
  ['POST /api/exercises/import-alias', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining'] })],
  ['POST /api/exercises/import-match', E('gated', { ssoAllowed: true, capabilities: ['autonomousTraining'] })],
  ['POST /api/rest-alert', E('gated', { ssoAllowed: false, capabilities: ['autonomousTraining'] })],
  ['POST /api/rest-alert/cancel', E('gated', { ssoAllowed: false, capabilities: ['autonomousTraining'] })],
  ['POST /api/rest-alert/test', E('gated', { ssoAllowed: false, capabilities: ['autonomousTraining'] })],

  // AI-assisted member features.
  ['POST /api/exercises/scan-machine', E('gated', { ssoAllowed: true, capabilities: ['aiCoach'] })],
  ['POST /api/measurements/scan', E('gated', { ssoAllowed: true, capabilities: ['aiCoach'] })],
  ['POST /api/routines/scan', E('gated', { ssoAllowed: true, capabilities: ['aiCoach'] })],
  ['POST /api/scan/start', E('gated', { ssoAllowed: true, capabilities: ['aiCoach'] })],
  ['POST /api/scan/cancel', E('gated', { ssoAllowed: true, capabilities: ['aiCoach'] })],
  ['GET /api/scan/status', E('gated', { ssoAllowed: true, capabilities: ['aiCoach'] })],

  // Commercial content: the only member-facing routes (everything else in these families is staff-only).
  ['GET /api/guided', E('gated', { ssoAllowed: true, capabilities: ['guidedTraining'] })],
  ['GET /api/premium', E('gated', { ssoAllowed: true, capabilities: ['premiumPrograms'] })],
  ['GET /api/premium/program', E('gated', { ssoAllowed: true, capabilities: ['premiumPrograms'] })],
  ['POST /api/premium/started', E('gated', { ssoAllowed: true, capabilities: ['premiumPrograms'] })],
  ['GET /api/opposition', E('gated', { ssoAllowed: true, capabilities: ['premiumPrograms'] })],
  ['GET /api/opposition/profile', E('gated', { ssoAllowed: true, capabilities: ['premiumPrograms'] })],
  ['GET /api/opposition/version', E('gated', { ssoAllowed: true, capabilities: ['premiumPrograms'] })],
  ['POST /api/opposition/started', E('gated', { ssoAllowed: true, capabilities: ['premiumPrograms'] })],

  // Member side of professional follow-up.
  ['GET /api/followup', E('gated', { ssoAllowed: true, capabilities: ['professionalFollowUp'] })],
  ['GET /api/followup/records', E('gated', { ssoAllowed: true, capabilities: ['professionalFollowUp'] })],
  ['GET /api/followup/questionnaires', E('gated', { ssoAllowed: true, capabilities: ['professionalFollowUp'] })],
  ['GET /api/followup/photo', E('gated', { ssoAllowed: true, capabilities: ['professionalFollowUp'] })],
  ['POST /api/followup/photo', E('gated', { ssoAllowed: true, capabilities: ['professionalFollowUp'] })],
  ['POST /api/followup/questionnaire/submit', E('gated', { ssoAllowed: true, capabilities: ['professionalFollowUp'] })],

  // Identity/account routes that are never capability-gated. Sensitive ones are NOT sso-allowed.
  ['GET /api/me', E('identity', { ssoAllowed: true })],
  ['GET /api/me/sessions', E('identity', { ssoAllowed: true })],
  ['POST /api/me/sessions/revoke', E('identity')],   // an sso session may end itself (logout) but not the person's passkey sessions
  ['GET /api/me/security-events', E('identity', { ssoAllowed: true })],
  ['POST /api/me/username', E('identity', { ssoAllowed: true })],
  ['POST /api/me/avatar', E('identity', { ssoAllowed: true })],
  ['POST /api/logout', E('identity', { ssoAllowed: true })],
  ['GET /api/platform/v1/sso/start', E('public', { ssoAllowed: true })],      // begins the browser-bound flow: sets the binding cookie and sends the browser to Home
  ['POST /api/platform/v1/sso/redeem', E('public', { ssoAllowed: true })],
  ['POST /api/platform/v1/sso/confirm', E('public', { ssoAllowed: true })],   // explicit confirmation of an account switch (H3); exempt like redeem   // exempt from the gate: a new code must work whatever session the browser holds
  ['GET /api/coach/disclosure', E('identity', { ssoAllowed: true })],
  ['POST /api/coach/forget', E('identity')],   // erasing Coach data / withdrawing consent is a right, never gated by a fee (destructive: passkey-only)
  ['GET /api/health', E('public', { ssoAllowed: true })],
  ['GET /api/config', E('public', { ssoAllowed: true })],
  ['GET /api/features', E('public', { ssoAllowed: true })],
  ['GET /api/me/export', E('identity')],
  ['GET /api/me/passkeys', E('identity')],
  ['POST /api/me/delete', E('identity')],
  ['POST /api/me/delete/options', E('identity')],
  ['POST /api/logout/all', E('identity')],

  // Kiosk (PIN / room-token identified): gated inside the handler through memberGate where a member is resolved.
  ['POST /api/bunker/checkin', E('kiosk')],
  ['GET /api/bunker/session', E('kiosk')],
  ['POST /api/bunker/active', E('kiosk')],
  ['POST /api/bunker/rest', E('kiosk')],
  ['POST /api/bunker/finish', E('kiosk')],
  // Authenticated with the member's own gymsid session (not the room token): gated like the rest of own training.
  ['POST /api/bunker/handoff', E('gated', { capabilities: ['autonomousTraining'] })],
  ['GET /api/bunker/pin', E('gated', { capabilities: ['autonomousTraining'] })],
  ['POST /api/bunker/pin/reset', E('gated', { capabilities: ['autonomousTraining'] })],
  ['GET /api/bunker/board', E('kiosk')],
  ['GET /api/bunker/settings', E('kiosk')],
  ['POST /api/bunker/verify-launch', E('kiosk')],
  ['GET /api/bunker/launch-link', E('staff')],   // trainer-only room key
  ['GET /api/bunker/admin-code', E('staff')],
  ['POST /api/bunker/admin-checkin', E('staff')],
]);

/** Prefix rules, first match wins. */
const PREFIX = [
  ['/api/bunker/admin', E('staff')],
  ['/api/admin/', E('staff')],
  ['/api/trainer/', E('staff')],
  ['/api/shared-device/', E('staff')],
  ['/api/shared-staff/', E('staff')],
  ['/api/blocks', E('staff')],
  ['/api/center/', E('staff')],
  // Written by trainers/admins only (role guard inside the handler); members never call these.
  ['/api/guided/', E('staff')],
  ['/api/premium/', E('staff')],
  ['/api/opposition/', E('staff')],
  // Own AI coach. Withdrawing consent and reading the disclosure never depend on a fee.
  ['/api/coach/', E('gated', { ssoAllowed: true, capabilities: ['aiCoach'] })],
  // Pre-session / account recovery / device pairing and passkey control stay passkey-only.
  ['/api/login', E('identity')],
  ['/api/register', E('identity')],
  ['/api/recover', E('identity')],
  ['/api/link/', E('identity')],
  ['/api/me/passkeys/', E('identity')],
  ['/api/me/step-up', E('identity')],
  ['/api/platform/', E('identity')],
  // Social, notifications and gym information are not part of the capability contract.
  ['/api/social/', E('member', { ssoAllowed: true })],
  ['/api/friends', E('member', { ssoAllowed: true })],
  ['/api/chat/', E('member', { ssoAllowed: true })],
  // Reads of the gym's own information stay open to a suspended account (it must still see why); everything else interactive closes with a suspension.
  ['/api/notifications', E('member', { ssoAllowed: true, blockedReadOk: true })],
  ['/api/push/public-key', E('member', { ssoAllowed: true, blockedReadOk: true })],
  ['/api/push/', E('member', { ssoAllowed: true })],
  ['/api/news', E('member', { ssoAllowed: true, blockedReadOk: true })],
  ['/api/media', E('member', { ssoAllowed: true, blockedReadOk: true })],
  // Third-party account connections stay passkey-only.
  ['/api/whoop/', E('identity')],
  ['/api/strava/', E('identity')],
];

/**
 * Things a person may always do about their own content and contacts, even when the account is suspended: delete or withdraw what they posted,
 * leave, block, decline, unsubscribe, read notifications, change visibility preferences. A suspension closes creating and sending, not withdrawing.
 */
const WITHDRAWAL = [
  /^POST \/api\/social\/[a-z/]*delete$/, /^POST \/api\/social\/shares\/discard$/, /^POST \/api\/social\/(challenges\/leave|goals\/unpublish|preferences)$/,
  /^POST \/api\/friends\/(block|unblock|remove|cancel|decline)$/, /^POST \/api\/push\/unsubscribe$/, /^POST \/api\/notifications\/read(-all)?$/,
];

export function classifyRoute(key) {
  const exact = EXACT.get(key);
  if (exact) return exact;
  const path = key.slice(key.indexOf(' ') + 1);
  for (const [prefix, policy] of PREFIX) {
    if (!path.startsWith(prefix)) continue;
    return policy.kind === 'member' && WITHDRAWAL.some(rule => rule.test(key)) ? { ...policy, blockedOk: true } : policy;
  }
  return { kind: 'unclassified', ssoAllowed: false };
}

export const routePolicyForTests = Object.freeze({ exactKeys: [...EXACT.keys()], prefixes: PREFIX.map(([prefix]) => prefix) });
