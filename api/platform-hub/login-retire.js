// F9d · Retiring Búnker's own sign-in for linked MEMBERS (2JHub H-02, H-82): with PLATFORM_LOGIN_RETIRED (and the SSO receiver) on, a member
// whose account has an ACTIVE link to a 2J person no longer gets a session from the passkey login or the QR device link: the answer tells
// the screen to send them to 2J Home, and their only way in is the F9b SSO from Home. Nothing else changes:
//   - staff (trainer/admin role) and ADMIN_UIDS keep signing in here (their move is F9e);
//   - members without an active link keep signing in here (nothing is decided for them in F9d);
//   - the room PIN / shared device, check-in, account recovery and the internal service sign-ins are not touched;
//   - Búnker's passkeys are KEPT (never deleted in F9d): they still are the only strong re-authentication (an SSO session never satisfies a
//     passkey check, F9b). Consequence, documented in docs/PLATFORM_HUB_F9B_RECONCILIATION.md §10: while this is on, a linked member whose
//     browser only holds an SSO session cannot reach export / erasure / passkeys / devices (they need a passkey session, which is no longer
//     created here). Passkey sessions opened BEFORE the switch are not revoked and keep working until they expire. Pending Juanjo's decision.
// Switching it off restores today's login at once: no data is changed by this module.

export const LOGIN_RETIRED_CODE = 'login_retired';

export function createLoginRetire({ hub, homeUrl, isStaff, isEnvAdmin, secEvent, saveDb, json }) {
  const active = Boolean(hub.loginRetired && homeUrl);

  /** Does the switch apply to THIS account? Only a live member whose active link names the same person. */
  function appliesTo(user) {
    if (!active || !user || user.disabled) return false;
    if (isStaff(user) || isEnvAdmin(user.id)) return false;
    const link = user.platformLink;
    return link?.state === 'active' && typeof user.personId === 'string' && link.personId === user.personId;
  }

  /** The answer instead of a session: the screen shows "Entra desde 2J Home" with a link to Home. Audited (no credential, no name). */
  function refuse(res, user, via) {
    secEvent('platform_login_retired_refused', { userId: user.id, meta: { kind: via } });
    saveDb();
    return json(res, 403, { error: 'Entra desde 2J Home', code: LOGIN_RETIRED_CODE, homeUrl });
  }

  return { active, appliesTo, refuse };
}
