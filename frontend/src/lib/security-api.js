// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Account security from the signed-in person's side: passkeys, step-up, activity. Everything here is scoped by the server to the
// signed-in account; a step-up (a fresh passkey assertion, five minutes) is asked for before the actions that would let a stolen session dig in.
import { api, toCreationOptions, toRequestOptions, credToJSON } from './api.js'

const post = (path, body = {}, headers) => api(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers: { 'Content-Type': 'application/json', ...headers } } : {}) })

export const listPasskeys = () => api('/api/me/passkeys')
export const fetchSecurityEvents = () => api('/api/me/security-events').then(r => r.events || [])
export const listSessions = () => api('/api/me/sessions')
export const revokeSession = id => post('/api/me/sessions/revoke', { id })
export const renamePasskey = (id, name) => post('/api/me/passkeys/rename', { id, name })

/** One fresh passkey assertion (user verification required) -> a five-minute token for one purpose. */
export async function stepUp(purpose = 'passkeys') {
  const { cid, options } = await post('/api/me/step-up/options')
  const credential = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  return post('/api/me/step-up', { cid, purpose, credential: credToJSON(credential) })
}

/** Adds another passkey to this account from this session: step-up, then the browser's own "create passkey" prompt. */
export async function addPasskey(name = '') {
  const { token } = await stepUp('passkeys')
  const headers = { 'X-Step-Up': token }
  const { cid, options } = await post('/api/me/passkeys/options', {}, headers)
  const credential = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  return post('/api/me/passkeys/verify', { cid, name, credential: credToJSON(credential) }, headers)
}

export async function revokePasskey(id) {
  const { token } = await stepUp('passkeys')
  return post('/api/me/passkeys/revoke', { id }, { 'X-Step-Up': token })
}

/** How a security event reads. Codes are the server's; the strings are translated where they are shown. */
export const EVENT_LABEL = {
  account_created: 'Account created', login_ok: 'Signed in', login_failed: 'A sign-in attempt failed', recovery_requested: 'Account recovery requested',
  recovery_link_created: 'Recovery link created by staff', recovery_completed: 'Account recovered with a new passkey', passkey_added: 'Passkey added',
  passkey_renamed: 'Passkey renamed', passkey_revoked: 'Passkey removed', role_changed: 'Role changed', account_disabled: 'Account disabled',
  account_enabled: 'Account enabled', logout_all: 'Signed out everywhere', session_revoked: 'Session ended', device_linked: 'Device linked', step_up: 'Identity confirmed with a passkey',
}

/* ---------- link a device with a QR code ---------- */
// Device A (signed out) starts a link, shows the QR and waits; device B (signed in) approves it. See api/lib/device-link.js.
export const linkStart = () => post('/api/link/start')
export const linkClaim = (id, secret) => post('/api/link/claim', { id, secret })
export const linkInfo = id => api('/api/link/info?id=' + encodeURIComponent(id))
export const linkUrl = id => `${location.origin}/#/link/${id}`
/** Device B: confirms with a passkey (step-up for this purpose) and sends the code shown on A. */
export async function approveLink(id, code) {
  const { token } = await stepUp('device-link')
  return post('/api/link/approve', { id, code }, { 'X-Step-Up': token })
}

/**
 * Waits for device B to approve. Resolves { user } once approved, or { ended: 'expired' | 'denied' | 'cancelled' } when the link can no longer work.
 * `claim` answers { status: 'pending' } while waiting (HTTP 202) and { user } when approved; a refused claim throws with the server's code.
 */
export async function waitForLink({ id, secret, expiresAt, claim = linkClaim, sleep = ms => new Promise(r => setTimeout(r, ms)), now = Date.now, every = 2000, cancelled = () => false, onTick }) {
  while (!cancelled()) {
    if (now() > expiresAt) return { ended: 'expired' }
    try {
      const r = await claim(id, secret)
      if (r?.user) return { user: r.user }
    } catch (e) {
      const code = e?.data?.code
      return { ended: code === 'denied' ? 'denied' : 'expired' }
    }
    onTick?.(Math.max(0, Math.ceil((expiresAt - now()) / 1000)))
    await sleep(every)
  }
  return { ended: 'cancelled' }
}
