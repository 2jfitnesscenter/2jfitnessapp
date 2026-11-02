// Optional account e-mail (registration + profile). Same shape rule as the API (api/platform-sso/bunker-account.js normalizeEmail);
// the server stays the authority and a changed address is always stored unverified.
import { api } from './api.js'

const BASIC_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** trim + lowercase; null when it is not a plausible address (3..254 characters). */
export function normalizeAccountEmail(value) {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length >= 3 && email.length <= 254 && BASIC_EMAIL.test(email) ? email : null
}

/** Body of POST /api/register/options: the e-mail only when one was filled in. */
export function registerOptionsBody(name, code, email) {
  const body = { name, code: code || '' }
  const normalized = normalizeAccountEmail(email)
  if (normalized) body.email = normalized
  return body
}

/** Current e-mail and verification state of the signed-in account. */
export const fetchAccountEmail = () =>
  api('/api/me').then(r => ({ email: r.user?.email || null, emailVerified: r.user?.emailVerified === true }))

/** Changes (or, with an empty value, clears) the account e-mail. The server stores it unverified. */
export function updateAccountEmail(value) {
  const empty = String(value ?? '').trim() === ''
  const email = empty ? null : normalizeAccountEmail(value)
  if (!empty && !email) return Promise.reject(new Error('Enter a valid e-mail'))
  return api('/api/me/username', { method: 'POST', body: JSON.stringify({ email }) })
    .then(r => ({ email: r.email ?? null, emailVerified: r.emailVerified === true }))
}

export const emailStatusKey = ({ email, emailVerified }) => !email ? 'No e-mail' : emailVerified ? 'Verified' : 'Not verified'
