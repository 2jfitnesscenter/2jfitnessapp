// Landing logic for "Open Búnker with your 2J account": Platform sends the browser to /sso#code=<one-time code>.
// The code is read once from the URL fragment (which never reaches a server or a log), removed from the address bar and
// history immediately, and posted to Training's own origin, which redeems it server-to-server with Platform.
export const SSO_PATH = '/sso'
export const REDEEM_PATH = '/api/platform/v1/sso/redeem'

export const isSsoLanding = loc => !!loc && loc.pathname === SSO_PATH

export function ssoCodeFromHash(hash) {
  const match = /^#code=([A-Za-z0-9_-]{43,128})$/.exec(String(hash || ''))
  return match ? match[1] : null
}

/** What the person can do next, never why Platform said no. */
export function ssoOutcome(status, body) {
  const code = body && typeof body.error === 'string' ? body.error : ''
  if (status === 200) return 'ok'
  if (status === 423) return 'disabled'
  if (status === 403 && code === 'platform_access_blocked') return 'blocked'
  if (status === 403) return 'unavailable'
  if (status === 409 && (code === 'link_conflict' || code === 'link_not_confirmed')) return 'link'
  if (status === 400 && code === 'sso_code_invalid') return 'invalid'
  if (status === 429) return 'busy'
  return 'unavailable'
}

/** Posts the code once. Resolves `{ ok: true, user }` or `{ ok: false, kind }`; never throws and never returns the code. */
export async function redeemSso(code, fetchImpl = globalThis.fetch) {
  try {
    const response = await fetchImpl(REDEEM_PATH, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ v: 1, code }),
    })
    const body = await response.json().catch(() => ({}))
    const kind = ssoOutcome(response.status, body)
    return kind === 'ok' ? { ok: true, user: body.user ?? null } : { ok: false, kind }
  } catch { return { ok: false, kind: 'unavailable' } }
}

let pending = null
/** One redemption per page load, even if React mounts the landing twice (StrictMode): a code is single-use, so repeat calls share the first result. */
export function runSsoLanding({ location, history, fetchImpl, go }) {
  if (pending) return pending
  pending = (async () => {
    const code = ssoCodeFromHash(location.hash)
    try { history.replaceState(null, '', SSO_PATH) } catch { /* the address bar is cosmetic */ }
    if (!code) return { ok: false, kind: 'invalid' }
    const result = await redeemSso(code, fetchImpl)
    if (result.ok) go('/')
    return result
  })()
  return pending
}
export const resetSsoLandingForTests = () => { pending = null }
