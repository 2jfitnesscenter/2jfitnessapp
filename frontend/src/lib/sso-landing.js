// Landing logic for "Open Búnker with your 2J account": Platform sends the browser to /sso#code=<one-time code>.
// The code is read once from the URL fragment (which never reaches a server or a log), removed from the address bar and
// history immediately, and posted to Training's own origin, which redeems it server-to-server with Platform.
import { BASE, makeApiUrl, makeAssetUrl } from './base-path.js'
// Every path below is built from the build base (BASE), so under the Home proxy prefix (/bunker/) the landing is /bunker/sso
// and its calls go to /bunker/api/...; with base '/' they are exactly the old absolute paths. `base` is injectable for tests.
export const ssoPath = (base = BASE) => makeAssetUrl(base)('sso')
export const SSO_PATH = ssoPath()
export const redeemPath = (base = BASE) => makeApiUrl(base)('/api/platform/v1/sso/redeem')
export const confirmPath = (base = BASE) => makeApiUrl(base)('/api/platform/v1/sso/confirm')
export const REDEEM_PATH = redeemPath()
export const CONFIRM_PATH = confirmPath()
// The flow starts HERE (a plain top-level navigation): Training remembers a secret in this browser and sends it to Home; the code Home returns
// can then only be redeemed by this browser. A code that arrives any other way (a link someone sent) finds no secret and is refused.
export const startPath = (base = BASE) => makeApiUrl(base)('/api/platform/v1/sso/start')
export const START_PATH = startPath()

export const isSsoLanding = (loc, base = BASE) => !!loc && loc.pathname === ssoPath(base)

export function ssoCodeFromHash(hash) {
  const match = /^#code=([A-Za-z0-9_-]{43,128})$/.exec(String(hash || ''))
  return match ? match[1] : null
}

/** `/sso#error=<kind>` is how /sso/start explains a navigation that could not begin (SSO off, Home not configured, too many tries). */
export function ssoErrorFromHash(hash) {
  const match = /^#error=(disabled|unavailable|busy)$/.exec(String(hash || ''))
  return match ? match[1] : null
}

/** What the person can do next, never why Platform said no. */
export function ssoOutcome(status, body) {
  const code = body && typeof body.error === 'string' ? body.error : ''
  if (status === 200) return 'ok'
  if (status === 423) return 'disabled'
  if (status === 403 && code === 'platform_access_blocked') return 'blocked'
  if (status === 403) return 'unavailable'
  if (status === 409 && code === 'session_switch_confirmation_required') return 'confirm'
  if (status === 409 && (code === 'link_conflict' || code === 'link_not_confirmed')) return 'link'
  if (status === 400 && (code === 'sso_binding_missing' || code === 'sso_binding_mismatch')) return 'binding'
  if (status === 400 && code === 'sso_code_invalid') return 'invalid'
  if (status === 429) return 'busy'
  return 'unavailable'
}

/** Posts the code once. Resolves `{ ok: true, user }` or `{ ok: false, kind }`; never throws and never returns the code. */
export async function redeemSso(code, fetchImpl = globalThis.fetch, base = BASE) {
  try {
    const response = await fetchImpl(redeemPath(base), {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, code }),
    })
    const body = await response.json().catch(() => ({}))
    const kind = ssoOutcome(response.status, body)
    if (kind === 'confirm') return { ok: false, kind, ticket: String(body.ticket || ''), current: String(body.current?.name || ''), target: String(body.target?.name || '') }
    return kind === 'ok' ? { ok: true, user: body.user ?? null } : { ok: false, kind }
  } catch { return { ok: false, kind: 'unavailable' } }
}

/** The person said "yes, continue as the other account": only now does the session change. Never throws. */
export async function confirmSsoSwitch(ticket, fetchImpl = globalThis.fetch, base = BASE) {
  try {
    const response = await fetchImpl(confirmPath(base), { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ticket }) })
    const body = await response.json().catch(() => ({}))
    return response.status === 200 ? { ok: true, user: body.user ?? null } : { ok: false, kind: ssoOutcome(response.status, body) === 'link' ? 'link' : 'invalid' }
  } catch { return { ok: false, kind: 'unavailable' } }
}

let pending = null
/** One redemption per page load, even if React mounts the landing twice (StrictMode): a code is single-use, so repeat calls share the first result. */
export function runSsoLanding({ location, history, fetchImpl, go, base = BASE }) {
  if (pending) return pending
  pending = (async () => {
    const code = ssoCodeFromHash(location.hash), startError = ssoErrorFromHash(location.hash)
    try { history.replaceState(null, '', ssoPath(base)) } catch { /* the address bar is cosmetic */ }
    if (startError) return { ok: false, kind: startError }
    if (!code) return { ok: false, kind: 'invalid' }
    const result = await redeemSso(code, fetchImpl, base)
    if (result.ok) go(makeAssetUrl(base)(''))
    return result
  })()
  return pending
}
export const resetSsoLandingForTests = () => { pending = null }
