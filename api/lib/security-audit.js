// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The account-security event log: who signed in, recovered an account, added or removed a passkey, ended a session or changed a role.
 * Same arrangement as the Shared Staff audit (db.sharedStaffAudit): a bounded list in db.json, never part of a member's synced state.
 *
 * What an event NEVER holds: a credential, a token, a key, a PIN, an IP address, a user-agent string or a name. It holds the event
 * code, who it happened to, who did it (when somebody else did), a timestamp and a few allow-listed scalar facts ("2 passkeys revoked",
 * "platform Android"). Anything outside the allow-list is dropped on the way in, so a future caller cannot leak a secret into the log by accident.
 */
import crypto from 'node:crypto'

export const SECURITY_LIMIT = 3000

export const SECURITY_EVENTS = [
  'account_created', 'login_ok', 'login_failed', 'recovery_requested', 'recovery_link_created', 'recovery_completed',
  'passkey_added', 'passkey_renamed', 'passkey_revoked', 'role_changed', 'account_disabled', 'account_enabled',
  'logout_all', 'session_revoked', 'device_linked', 'step_up', 'content_removed', 'admin_action',
]
// The only facts an event may carry. Values are scalars, strings are clipped.
const META_KEYS = ['count', 'platform', 'role', 'from', 'to', 'reason', 'handle', 'uv', 'revokedPasskeys', 'sessionsEnded', 'kept', 'purpose', 'kind', 'target']

export function cleanMeta(meta) {
  if (!meta || typeof meta !== 'object') return undefined
  const out = {}
  for (const key of META_KEYS) {
    const v = meta[key]
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) out[key] = v
    else if (typeof v === 'string' && v) out[key] = v.slice(0, 40)
  }
  return Object.keys(out).length ? out : undefined
}

export function appendSecurityEvent(db, { event, userId = null, actorId = null, meta = null }) {
  if (!SECURITY_EVENTS.includes(event)) return null
  db.securityEvents = Array.isArray(db.securityEvents) ? db.securityEvents : []
  const entry = { id: crypto.randomBytes(6).toString('base64url'), at: new Date().toISOString(), event, userId: userId || null }
  if (actorId && actorId !== userId) entry.actorId = actorId
  const m = cleanMeta(meta)
  if (m) entry.meta = m
  db.securityEvents.push(entry)
  if (db.securityEvents.length > SECURITY_LIMIT) db.securityEvents.splice(0, db.securityEvents.length - SECURITY_LIMIT)
  return entry
}

/** A person's own recent events, newest first. Whether somebody else did it is shown; who is not (an admin's identity is not the member's business). */
export function eventsFor(db, userId, limit = 40) {
  return (db.securityEvents || []).filter(e => e.userId === userId).slice(-limit).reverse()
    .map(e => ({ id: e.id, at: e.at, event: e.event, byOther: !!e.actorId, ...(e.meta ? { meta: e.meta } : {}) }))
}

/** The admin's view: every field, names resolved by the caller. */
export function eventsForAdmin(db, { userId = null, limit = 100 } = {}) {
  const list = (db.securityEvents || []).filter(e => !userId || e.userId === userId || e.actorId === userId)
  return list.slice(-Math.min(500, Math.max(1, limit))).reverse()
}
