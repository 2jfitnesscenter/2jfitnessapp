// F9d · Retiring Búnker's own sign-in for linked MEMBERS (2JHub H-02, H-82): with PLATFORM_LOGIN_RETIRED (and the SSO receiver) on, a member
// whose account has an ACTIVE link to a 2J person no longer gets a session from the passkey login or the QR device link: the answer tells
// the screen to send them to 2J Home, and their only way in is the F9b SSO from Home. Nothing else changes:
//   - staff (trainer/admin role) and ADMIN_UIDS keep signing in here (their move is F9e);
//   - members without an active link keep signing in here (nothing is decided for them in F9d);
//   - the room PIN / shared device, check-in, account recovery and the internal service sign-ins are not touched;
//   - Búnker's passkeys are KEPT (never deleted in F9d): they still are the only strong re-authentication (an SSO session never satisfies a
//     passkey check, F9b). Consequence, documented in docs/PLATFORM_HUB_F9B_RECONCILIATION.md §10: while this is on, a linked member whose
//     browser only holds an SSO session cannot reach export / erasure / passkeys / devices (they need a passkey session, which is no longer
//     created here). Passkey sessions opened BEFORE the switch are not revoked and keep working until they expire. F9d-2 (2JHub H-83) closes
//     the export / erasure part with PLATFORM_HUB_STEPUP_ENABLED (a passkey confirmed in Platform, see stepup.js): turn that on first.
// Switching it off restores today's login at once: no data is changed by this module.

export const LOGIN_RETIRED_CODE = 'login_retired';

// F9e · The same answer for linked STAFF with PLATFORM_STAFF_LOGIN_RETIRED (and the staff roles switch and PLATFORM_ADMIN_URL): they are sent to
// 2J Hub Admin. Never ADMIN_UIDS (H-105.3), never unlinked staff (H-105.4) and never an administrator while no ADMIN_UIDS account can sign in
// (somebody must always be able to get in). Switching it off restores their login at once.

export function createLoginRetire({ hub, homeUrl, isStaff, isEnvAdmin, isAdmin = () => false, staff = null, secEvent, saveDb, json }) {
  const active = Boolean(hub.loginRetired && homeUrl);
  const staffActive = Boolean(hub.staffLoginRetired && hub.adminUrl && staff?.on);

  const memberApplies = user => {
    const link = user.platformLink;
    return link?.state === 'active' && typeof user.personId === 'string' && link.personId === user.personId;
  };
  const staffApplies = user => staffActive && !isEnvAdmin(user.id) && Boolean(staff.linkOf(user)) && (!isAdmin(user) || staff.configAdminAvailable());

  /** Does a switch apply to THIS account? A live member whose active link names the same person, or (F9e) a linked staff account. */
  function appliesTo(user) {
    if (!user || user.disabled) return false;
    if (isStaff(user) || isEnvAdmin(user.id)) return staffApplies(user);
    return active && memberApplies(user);
  }

  /** The answer instead of a session: the screen shows "Entra desde 2J Hub" with a link to Home (members) or Admin (staff). Audited. */
  function refuse(res, user, via) {
    const asStaff = isStaff(user);
    secEvent(asStaff ? 'platform_staff_login_retired_refused' : 'platform_login_retired_refused', { userId: user.id, meta: { kind: via } });
    saveDb();
    return json(res, 403, asStaff
      ? { error: 'Entra desde 2J Hub', code: LOGIN_RETIRED_CODE, homeUrl: hub.adminUrl, audience: 'staff' }
      : { error: 'Entra desde 2J Home', code: LOGIN_RETIRED_CODE, homeUrl });
  }

  return { active, staffActive, appliesTo, refuse };
}
