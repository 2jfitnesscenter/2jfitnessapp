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
  return Object.freeze({
    bridgeEnabled: bridge,
    // The receiver also needs SSO sessions to be allowed at all.
    receiverEnabled: bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || ''),
    directoryEnabled: bridge && TRUE.test(env.PLATFORM_DIRECTORY_ENABLED || ''),
    provisioningEnabled: bridge && TRUE.test(env.PLATFORM_PROVISIONING_ENABLED || ''),
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
    staffRolesEnabled: bridge && TRUE.test(env.PLATFORM_SSO_ENABLED || '') && TRUE.test(env.PLATFORM_HUB_STAFF_ROLES_ENABLED || ''),
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
