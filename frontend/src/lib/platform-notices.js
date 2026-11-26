// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9b · 2J Hub bridge on the member's screen: the ONE table of notice codes -> text (translated through i18n like every other string),
// and the tiny client for GET /api/platform/v1/me/training-level. Nothing here decides a level: Platform does, the server applies it.

export const LEVEL_PATH = '/api/platform/v1/me/training-level'

/** Notice code (from the server) -> message. Unknown codes show nothing. */
export const NOTICE_TEXT = Object.freeze({
  PAYMENT_PENDING: 'Your fee is pending. Pay it before it is due to keep your Búnker level.',
  SUSPENDED: 'Your Búnker access is suspended. Talk to the centre.',
})
export const BACK_TO_HOME = 'Back to Home'

// F9d · Búnker's own sign-in retired for linked members (PLATFORM_LOGIN_RETIRED): the server answers `code: 'login_retired'` + `homeUrl`.
export const LOGIN_RETIRED_TITLE = 'Sign in from 2J Home'
export const LOGIN_RETIRED_TEXT = 'Your Búnker account is now opened from 2J Home, with the same passkey you already use. Sign in there and tap "Open Búnker".'
export const OPEN_HOME = 'Go to 2J Home'
// F9e · The same answer for linked STAFF (PLATFORM_STAFF_LOGIN_RETIRED): `audience: 'staff'` and `homeUrl` = 2J Hub Admin.
export const STAFF_LOGIN_RETIRED_TITLE = 'Sign in from 2J Hub'
export const STAFF_LOGIN_RETIRED_TEXT = 'Your Búnker staff account is now opened from 2J Hub Admin, with your 2J passkey. Sign in there and tap "Open Búnker".'
export const OPEN_ADMIN = 'Go to 2J Hub'

/** F9e · Was the retired-login answer for a staff account? (Then the sheet sends to 2J Hub Admin.) */
export const loginRetiredForStaff = error => error?.data?.code === 'login_retired' && error?.data?.audience === 'staff'

/** Home's URL when an API error says this member must enter from 2J Home; otherwise null (only http(s), never a script URL). */
export function loginRetiredHome(error) {
  const data = error?.data
  if (data?.code !== 'login_retired') return null
  return typeof data.homeUrl === 'string' && /^https?:\/\//.test(data.homeUrl) ? data.homeUrl : null
}

/** How this session began: one that came from 2J (Home or Admin) did not use a passkey here. */
export const signedInText = user => (user?.authLevel === 'sso' ? 'Signed in from 2J — data syncs to this profile.' : 'Signed in with passkey — data syncs to this profile.')

export const noticeText = code => (code && Object.prototype.hasOwnProperty.call(NOTICE_TEXT, code) ? NOTICE_TEXT[code] : null)

/** The bar is shown only when the server said the bridge is on (`platformBridge` in /api/config). Never throws. */
export async function loadBridgeView(fetchImpl = globalThis.fetch) {
  try {
    const config = await fetchImpl('/api/config', { credentials: 'same-origin', cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
    if (!config || config.platformBridge !== true) return null
    const response = await fetchImpl(LEVEL_PATH, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) return null
    const view = await response.json()
    const homeUrl = typeof view?.homeUrl === 'string' && /^https?:\/\//.test(view.homeUrl) ? view.homeUrl : null
    const back = view?.sso === true && homeUrl ? homeUrl : null
    const notice = noticeText(view?.notice)
    return back || notice ? { back, notice } : null
  } catch { return null }
}

// F9d-2 · A passkey confirmation done in 2J Home (Platform) authorises ONE export or ONE erasure of this account, for 5 minutes (2JHub H-83).
// The server decides everything; the screen only learns the purpose and until when, from training-level (`stepUp`, only with the switch on).
export const STEPUP_EXPORT_READY = 'Confirmed with your 2J passkey: you can export your data now (once, within 5 minutes).'
export const STEPUP_DELETE_READY = 'Confirmed with your 2J passkey: you can delete your account now (once, within 5 minutes).'
export const STEPUP_DELETE_HINT = 'Already confirmed with your 2J passkey.'

/** `{ purpose: 'export'|'delete', expiresAt }` of this session's live grant, or null. Never throws. */
export async function loadStepUp(fetchImpl = globalThis.fetch) {
  try {
    const config = await fetchImpl('/api/config', { credentials: 'same-origin', cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
    if (!config || config.platformBridge !== true) return null
    const response = await fetchImpl(LEVEL_PATH, { credentials: 'same-origin', cache: 'no-store' })
    if (!response.ok) return null
    const grant = (await response.json())?.stepUp
    if (!grant || !['export', 'delete'].includes(grant.purpose) || !(Date.parse(grant.expiresAt) > Date.now())) return null
    return { purpose: grant.purpose, expiresAt: grant.expiresAt }
  } catch { return null }
}
