// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Account security from the signed-in person's side: passkeys, step-up, activity. Everything here is scoped by the server to the
// signed-in account; a step-up (a fresh passkey assertion, five minutes) is asked for before the actions that would let a stolen session dig in.
import { api, toCreationOptions, toRequestOptions, credToJSON } from './api.js'

const post = (path, body = {}, headers) => api(path, { method: 'POST', body: JSON.stringify(body), ...(headers ? { headers: { 'Content-Type': 'application/json', ...headers } } : {}) })

export const listPasskeys = () => api('/api/me/passkeys')
export const fetchSecurityEvents = () => api('/api/me/security-events').then(r => r.events || [])
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
