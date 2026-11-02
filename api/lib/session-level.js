// Pure session-level predicates shared by server.js (kept here so they can be tested directly).
/** Admin: the persisted flag or an ADMIN_UIDS account, never under a Home session (member-level only). */
export const isAdminUser = (user, adminUids) => !!user && user.authLevel !== 'home' && (user.admin === true || adminUids.includes(user.id));
/** True when a session must be refused for an action that needs a passkey step-up (sso, home, or a pin session without a recent strong confirmation). */
export const refusesStrongAuth = (user, now = Date.now()) => user.authLevel === 'sso' || user.authLevel === 'home' || (user.authLevel === 'pin' && !(user.strongUntil > now));
