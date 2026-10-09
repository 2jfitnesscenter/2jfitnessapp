// Backend + WebAuthn helpers (ported from the vanilla app).
export const IS_APPLE = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
export const IS_ANDROID = /Android/.test(navigator.userAgent)
export const BIO = IS_APPLE ? 'Face ID / Touch ID' : IS_ANDROID ? 'fingerprint or face unlock' : 'your fingerprint, face or PIN'
export const VAULT = IS_APPLE ? 'iCloud Keychain' : IS_ANDROID ? 'Google Password Manager' : 'your password manager'
export const webauthnOK = () => !!(window.PublicKeyCredential && navigator.credentials)

const STRONG_STEPUP_PATHS = new Set([
  'POST /api/logout/all',
  'POST /api/admin/user/role', 'POST /api/admin/user/disable', 'POST /api/admin/user/trainer',
  'POST /api/admin/user/recovery-link', 'POST /api/admin/invites/new', 'POST /api/admin/invites/revoke'
])
export async function api(path, opts = {}, strongRetried = false) {
  const r = await fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts))
  const data = await r.json().catch(() => ({}))
  if (!r.ok) {
    const method = String(opts.method || 'GET').toUpperCase()
    if (r.status === 401 && typeof window !== 'undefined') {
      try {
        if (JSON.parse(localStorage.getItem('gym_user') || 'null')?.authLevel === 'pin') window.dispatchEvent(new Event('2j:shared-session-invalid'))
      } catch { /* unavailable or malformed browser storage */ }
    }
    if (!strongRetried && r.status === 403 && data.code === 'passkey_required' && STRONG_STEPUP_PATHS.has(`${method} ${path}`)) {
      await sharedDeviceStepUp()
      return api(path, opts, true)
    }
    const e = new Error(data.error || ('HTTP ' + r.status)); e.status = r.status; e.data = data; throw e
  }
  return data
}

const bufToB64u = buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const b64uToBuf = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0)).buffer

function toCreationOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  o.user.id = b64uToBuf(o.user.id)
  ;(o.excludeCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function toRequestOptions(o) {
  o.challenge = b64uToBuf(o.challenge)
  ;(o.allowCredentials || []).forEach(c => { c.id = b64uToBuf(c.id) })
  return o
}
function credToJSON(cred) {
  const r = cred.response
  const out = {
    id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults ? cred.getClientExtensionResults() : {},
    authenticatorAttachment: cred.authenticatorAttachment || null,
    response: { clientDataJSON: bufToB64u(r.clientDataJSON) }
  }
  if (r.attestationObject) {
    out.response.attestationObject = bufToB64u(r.attestationObject)
    out.response.transports = r.getTransports ? r.getTransports() : ['internal']
  }
  if (r.authenticatorData) {
    out.response.authenticatorData = bufToB64u(r.authenticatorData)
    out.response.signature = bufToB64u(r.signature)
    out.response.userHandle = r.userHandle ? bufToB64u(r.userHandle) : null
  }
  return out
}
export async function passkeyRegister(name, code) {
  const { cid, options } = await api('/api/register/options', { method: 'POST', body: JSON.stringify({ name, code: code || '' }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/register/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
export async function passkeyLogin() {
  const { cid, options } = await api('/api/login/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  const res = await api('/api/login/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return res.user
}
// Admin-assisted recovery: registers a brand-new passkey onto an existing account via a
// short-lived token an admin generated in person — see api/server.js's /api/recover/* for why
// this exists instead of a password reset.
export async function passkeyRecover(token) {
  const { cid, options } = await api('/api/recover/options', { method: 'POST', body: JSON.stringify({ token }) })
  const cred = await navigator.credentials.create({ publicKey: toCreationOptions(options) })
  const res = await api('/api/recover/verify', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred) }) })
  return { ...res.user, recovery: res.recovery || null }
}

// Account erasure needs a FRESH passkey assertion from this very account plus the typed username (api/server.js /api/me/delete).
// Resolves when the server has erased everything; the caller then clears the local copy.
export async function passkeyDeleteAccount(confirm) {
  const { cid, options } = await api('/api/me/delete/options', { method: 'POST', body: '{}' })
  const cred = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  return api('/api/me/delete', { method: 'POST', body: JSON.stringify({ cid, credential: credToJSON(cred), confirm }) })
}

async function passkeyAction(optionsPath, finishPath, values = {}) {
  const { cid, options } = await api(optionsPath, { method: 'POST', body: JSON.stringify(values) })
  const credential = await navigator.credentials.get({ publicKey: toRequestOptions(options) })
  return api(finishPath, { method: 'POST', body: JSON.stringify({ ...values, cid, credential: credToJSON(credential) }) })
}

export const sharedDeviceStatus = () => api('/api/shared-device/status')
export async function sharedStaffLogin(userId, pin) {
  const result = await api('/api/shared-device/pin', { method: 'POST', body: JSON.stringify({ userId, pin }) })
  return { ...result.user, authLevel: result.authLevel, sharedSessionExpiresAt: result.expiresAt }
}
export const lockSharedStaff = () => api('/api/shared-device/lock', { method: 'POST', body: '{}' })
export const sharedDeviceStepUp = () => passkeyAction('/api/shared-device/step-up/options', '/api/shared-device/step-up')
export const setOwnStaffPin = pin => passkeyAction('/api/shared-staff/pin/options', '/api/shared-staff/pin', { pin })
export const authorizeSharedDevice = label => passkeyAction('/api/shared-device/authorize/options', '/api/shared-device/authorize', { label })
export const listSharedDevices = () => api('/api/admin/shared-devices')
export const revokeSharedDevice = id => passkeyAction('/api/admin/shared-device/revoke/options', '/api/admin/shared-device/revoke', { id })
export const resetStaffPin = (userId, pin) => passkeyAction('/api/admin/shared-staff/pin/options', '/api/admin/shared-staff/pin', { userId, pin })
