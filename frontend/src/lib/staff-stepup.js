// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9o · Strong staff actions confirmed with the 2J Hub passkey (2JHub contract §11). Closed list, same as the server's: route key → action.
// `POST /api/admin/user/recovery-link` and `POST /api/me/delete` are NOT here.
export const STAFF_STEPUP_ACTIONS = Object.freeze({
  'POST /api/admin/user/role': 'user_role',
  'POST /api/admin/user/trainer': 'user_trainer',
  'POST /api/admin/user/disable': 'user_disable',
  'POST /api/admin/invites/new': 'invite_new',
  'POST /api/admin/invites/revoke': 'invite_revoke',
  'POST /api/logout/all': 'logout_all',
})
export const STAFF_STEPUP_EVENT = '2j:staff-stepup'
export const STAFF_STEPUP_TITLE = 'Confirm with your 2J Hub passkey'
export const STAFF_STEPUP_TEXT = 'This action needs your passkey. As you entered from 2J Hub, you confirm it there: 2J Hub shows what will be done and on whom, asks for your passkey and brings you back here. Then tap the action again.'

/** Asks the server to fix this action + body and returns where to confirm it (2J Hub Admin). Throws with the server's message. */
export async function startStaffStepUp(action, body) {
  const r = await fetch('/api/platform/v1/staff-stepup/start', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, body: body ?? {} }),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok || typeof data.confirmUrl !== 'string') throw new Error(data.error || ('HTTP ' + r.status))
  return data.confirmUrl
}
