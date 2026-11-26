// F9b · Platform (2J Hub) bridge configuration. Everything is OFF unless explicitly enabled.
// See docs/PLATFORM_HUB_F9B_RECONCILIATION.md for what each switch turns on and in which order.
import { parseServiceAuthKeys } from '../platform-proof/service-auth.js';

const TRUE = /^(1|true)$/i;

/** Contract constants of 2JHub docs/contracts/platform-training-v2.md (F9a). Not the defaults the old preparation used. */
export const HUB_SSO = Object.freeze({
  issuer: '2j-platform',
  audience: '2j-training',
  purpose: 'training-sso',
  destination: 'bunker',
  assurance: 'platform_sso',
});
export const HUB_PATHS = Object.freeze({
  redeem: '/api/internal/platform/v2/training-sso/redeem',
  receiver: '/api/platform/v1/sso/receive',
  level: '/api/platform/v1/me/training-level',
  provision: '/api/platform/v1/provision',
  directory: '/api/internal/platform/v1/training-users',
  // F9c · `${directory}/{trainingUserId}/settings` (GET, PATCH) and Training → Platform end-of-link notice.
  linkEnded: '/api/internal/platform/v2/training-links/ended',
  // F9d · `${directory}/{trainingUserId}/credentials?personId=` (GET): the member's passkeys, PUBLIC parts only (contract §8).
  // F9d-2 · re-authentication done with a passkey IN PLATFORM, for the member's own export / erasure (contract §9).
  stepupRedeem: '/api/internal/platform/v2/training-stepup/redeem',
  stepupReceiver: '/api/platform/v1/stepup/receive',
  // F9e · staff (trainers and administration) sign in from 2J Hub Admin with the role Platform decides (2JHub contract §10, training-staff-v1).
  staffRedeem: '/api/internal/platform/v2/training-staff-sso/redeem',
  staffState: '/api/internal/platform/v2/training-staff',
  staffReceiver: '/api/platform/v1/staff-sso/receive',
  staffDirectory: '/api/internal/platform/v1/training-staff',
  staffEvents: '/api/internal/platform/v1/staff-events',
  // F9o · strong staff actions confirmed with the 2J Hub passkey (2JHub contract §11, training-staff-stepup-v1).
  staffStepupIntent: '/api/internal/platform/v2/training-staff-stepup/intents',
  staffStepupRedeem: '/api/internal/platform/v2/training-staff-stepup/redeem',
  staffStepupStart: '/api/platform/v1/staff-stepup/start',
  staffStepupReceiver: '/api/platform/v1/staff-stepup/receive',
});
/** F9e · Contract constants (2JHub `TRAINING_STAFF`). A member code never works here and a staff code never works for members. */
export const HUB_STAFF = Object.freeze({
  contract: 'training-staff-v1',
  issuer: '2j-platform',
  audience: '2j-training-staff',
  destination: 'bunker',
  assurance: 'platform_sso',
  roles: Object.freeze(['admin', 'trainer']),
  refreshMs: 60_000,
});
/**
 * F9o · Contract constants (2JHub `TRAINING_STAFF_STEPUP`). CLOSED list of the strong staff actions a 2J Hub passkey may open (checked against
 * STRONG_AUTH_ACTIONS): `POST /api/admin/user/recovery-link` and `POST /api/me/delete` are NOT here and never will be through this path (H-128.3).
 * `fields(body)` = the request fields the grant is bound to, read exactly as the handler reads them.
 */
const text = v => String(v || '');   // the handlers read `String(body.x || '')`
const idOf = v => (typeof v === 'string' ? v : null);   // the handlers compare ids with ===
export const HUB_STAFF_STEPUP = Object.freeze({
  contract: 'training-staff-stepup-v1',
  issuer: '2j-platform',
  audience: '2j-training-staff-stepup',
  destination: 'bunker',
  assurance: 'platform_passkey',
  intentMs: 5 * 60_000,
  grantMs: 5 * 60_000,
  actions: Object.freeze({
    user_role: { route: 'POST /api/admin/user/role', target: 'user', fields: b => ({ id: idOf(b.id), role: text(b.role) }), landing: '/#/admin' },
    user_trainer: { route: 'POST /api/admin/user/trainer', target: 'user', fields: b => ({ id: idOf(b.id), trainer: !!b.trainer }), landing: '/#/admin' },
    user_disable: { route: 'POST /api/admin/user/disable', target: 'user', fields: b => ({ id: idOf(b.id), disabled: !!b.disabled }), landing: '/#/admin' },
    invite_new: { route: 'POST /api/admin/invites/new', target: 'none', fields: b => ({ note: text(b.note).slice(0, 60) }), landing: '/#/admin' },
    invite_revoke: { route: 'POST /api/admin/invites/revoke', target: 'invite', fields: b => ({ code: text(b.code).toUpperCase() }), landing: '/#/admin' },
    logout_all: { route: 'POST /api/logout/all', target: 'self', fields: () => ({}), landing: '/#/settings/security' },
  }),
});

/**
 * F9m · Closed list of destinations Platform may ask for in a STAFF redemption (`next`). Búnker BUILDS the route itself from the member id; it never
 * accepts a route, path or URL from Platform (2JHub contract F9m, condition 1). `member` = that member's plan page (`#/trainer/<id>`).
 */
export const HUB_STAFF_NEXT = Object.freeze(['home', 'member']);
const RESERVED_TRAINER_SEGMENTS = new Set(['seguimiento', 'blocks', 'guided', 'library-quality']);
const MEMBER_ID = /^[A-Za-z0-9_-]{1,200}$/;
export function staffDeeplinkLocation(next, memberId) {
  if (next !== 'member' || typeof memberId !== 'string' || !MEMBER_ID.test(memberId) || RESERVED_TRAINER_SEGMENTS.has(memberId)) return '/';
  return `/#/trainer/${encodeURIComponent(memberId)}`;
}

/** Origin of a 2J Hub web app (Home or Admin): https, or http on a loopback host; nothing but the origin. */
export function parseHubOrigin(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { return null; }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
  return url.protocol === 'https:' || (url.protocol === 'http:' && loopback) ? url.origin : null;
}
/** F9d-2 · Contract constants (2JHub `TRAINING_STEPUP`). `platform_passkey` is valid ONLY for these purposes (closed list). */
export const HUB_STEPUP = Object.freeze({
  issuer: '2j-platform',
  audience: '2j-training-stepup',
  destination: 'bunker',
  assurance: 'platform_passkey',
  purposes: Object.freeze(['export', 'delete']),
  grantMs: 5 * 60_000,
});
/** F9c · Closed list of Training destinations Home may open through SSO (`next` form field). Never a free URL. */
export const HUB_SSO_NEXT = Object.freeze({ account: '/settings#data' });

export function parseHubEnv(env) {
  const bridge = TRUE.test(env.PLATFORM_TRAINING_BRIDGE_ENABLED || '');
  const staffRoles = bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || '') && TRUE.test(env.PLATFORM_HUB_STAFF_ROLES_ENABLED || '');
  return Object.freeze({
    bridgeEnabled: bridge,
    // The receiver also needs SSO sessions to be allowed at all.
    receiverEnabled: bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || ''),
    directoryEnabled: bridge && TRUE.test(env.PLATFORM_DIRECTORY_ENABLED || ''),
    provisioningEnabled: bridge && TRUE.test(env.PLATFORM_PROVISIONING_ENABLED || ''),
    // F9l: the only switch of the capability gates. Off = members in shadow/enforced behave as legacy (their stored mode is kept).
    enforcementEnabled: TRUE.test(env.PLATFORM_ENFORCEMENT_ENABLED || ''),
    // F9c: Training settings from 2J Home (signed GET/PATCH), `next` in the SSO form and the end-of-link notice on account erasure.
    settingsEnabled: bridge && TRUE.test(env.PLATFORM_HUB_SETTINGS_ENABLED || ''),
    // F9d: Platform may read a linked member's passkeys (public key + public metadata) to import them (contract §8).
    credentialsEnabled: bridge && TRUE.test(env.PLATFORM_HUB_CREDENTIALS_ENABLED || ''),
    // F9d: linked MEMBERS stop signing in with Búnker's own passkey login / QR link and are sent to 2J Home (SSO only). Only takes effect
    // while the SSO receiver is on (otherwise nobody could get in); staff, ADMIN_UIDS, unlinked members, the room PIN and recovery are untouched.
    // Switching it off restores today's login at once: nothing is migrated or deleted (Búnker's passkeys are never removed in F9d).
    // F9d-2: Training trusts a passkey re-authentication done in Platform for the member's OWN export / erasure only (2JHub H-83). Needs the SSO
    // receiver (the form also carries an SSO code). Off = the receiver route does not exist and export / erasure behave exactly as in F9d.
    stepupEnabled: bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || '') && TRUE.test(env.PLATFORM_HUB_STEPUP_ENABLED || ''),
    loginRetired: bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || '') && TRUE.test(env.PLATFORM_LOGIN_RETIRED || ''),
    // F9e (2JHub H-82, H-104, H-105): Platform decides the STAFF role (trainer / admin) of the staff accounts it linked, and staff can sign in
    // from 2J Hub Admin. Off = nothing of F9e exists (no routes, no timer) and roles are changed in Búnker's admin panel exactly as today.
    staffRolesEnabled: staffRoles,
    // F9m: when Admin's "Abrir en Búnker" asks for a member (`next: 'member'`), the staff entry lands on that member's page instead of `/`. Needs the roles
    // switch. Off (default) = the answer's `next` is ignored and the entry goes to `/` exactly as in F9e. Nothing is stored; no passkey, RP_ID or data touched.
    staffDeeplinkEnabled: staffRoles && TRUE.test(env.PLATFORM_HUB_STAFF_DEEPLINK_ENABLED || ''),
    // F9o (2JHub H-106.1, contract §11): linked staff on a 2J Hub session confirm the strong actions of the closed list with their 2J Hub
    // passkey. Needs the roles switch. Off (default) = those actions answer `passkey_required` exactly as today; nothing of F9o exists.
    staffStepupEnabled: staffRoles && TRUE.test(env.PLATFORM_HUB_STAFF_STEPUP_ENABLED || ''),
    // F9e: linked staff stop signing in with Búnker's own passkey login / QR link and are sent to 2J Hub Admin. Needs the roles switch and
    // PLATFORM_ADMIN_URL. Never applies to ADMIN_UIDS, to unlinked staff, nor to an admin when no ADMIN_UIDS account can sign in (somebody
    // must always be able to get in). Off = today's login. Reversible: nothing is migrated or deleted.
    staffLoginRetired: bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || '') && TRUE.test(env.PLATFORM_HUB_STAFF_ROLES_ENABLED || '')
      && TRUE.test(env.PLATFORM_STAFF_LOGIN_RETIRED || ''),
    // F9e: exact origin of 2J Hub Admin (the staff form comes from there; "Entra desde 2J Hub" links there).
    adminUrl: parseHubOrigin(env.PLATFORM_ADMIN_URL),
    // Keys Platform uses to call Training (Platform's TRAINING_OUTBOUND_KEY_ID / TRAINING_OUTBOUND_KEY). Dedicated: never the proof keys.
    inboundKeys: parseServiceAuthKeys(env.PLATFORM_HUB_INBOUND_KEYS || ''),
  });
}
