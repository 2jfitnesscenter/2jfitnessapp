import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import es from '../locales/es.js'
import { settingsDeepLink } from './deep-link.js'
import { syncBadge, SYNC_LABEL } from './sync-indicator.js'
import { SyncClient } from './sync-client.js'
import { signedInText, STAFF_LOGIN_RETIRED_TEXT } from './platform-notices.js'
import { ssoErrorFromHash } from './sso-landing.js'
import { SsoFailure } from '../views/SsoLanding.jsx'

const read = p => readFileSync(new URL(p, import.meta.url), 'utf8')

describe('F9l block C', () => {
  it('D: /settings#data becomes the router address of Settings → Data (the router lives in the hash)', () => {
    expect(settingsDeepLink({ pathname: '/settings', hash: '#data' })).toBe('/#/settings#data')
    for (const loc of [{ pathname: '/', hash: '#/settings' }, { pathname: '/settings', hash: '' }, { pathname: '/settings', hash: '#/home' }, { pathname: '/sso', hash: '#data' }, null]) expect(settingsDeepLink(loc)).toBeNull()
    expect(read('../main.jsx')).toContain('settingsDeepLink(window.location)')
    expect(read('../views/Settings.jsx')).toContain("routeHash === '#data'")
  })
  it('D: after exporting, the used one-time authorisation stops being announced', () => {
    expect(read('../views/Settings.jsx')).toMatch(/Your data was exported'\)\)\s*loadStepUp\(\)\.then\(setHubStepUp\)/)
  })
  it('a session that came from 2J (SSO) does not say it signed in with a passkey', () => {
    expect(es[signedInText({ authLevel: 'sso' })]).toBe('Sesión iniciada desde 2J — los datos se sincronizan con este perfil.')
    expect(es[signedInText({ authLevel: 'passkey' })]).toContain('Sesión iniciada con passkey')
    expect(read('../views/Settings.jsx')).toContain('t(signedInText(user))')
  })
  it('the staff notice names the same button as 2J Hub: «Abrir Búnker»', () => {
    expect(es[STAFF_LOGIN_RETIRED_TEXT]).toContain('«Abrir Búnker»')
    expect(JSON.stringify(es)).not.toContain('Entrar en Búnker')
  })
  it('a suspended member is told so, never "Sin conexión"', async () => {
    expect(syncBadge({ online: true, status: 'suspended' })).toBe('suspended')
    expect(syncBadge({ online: false, status: 'suspended' })).toBe('offline')
    expect(es[SYNC_LABEL.suspended]).toBe('Acceso suspendido · No se guarda en tu cuenta')
    const seen = [], map = new Map()
    const storage = { get length() { return map.size }, key: i => [...map.keys()][i] ?? null, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }
    let fail = Object.assign(new Error('no'), { status: 403, data: { code: 'platform_access_blocked', reasonCode: 'ADMIN_SUSPENDED' } })
    const client = new SyncClient({ uid: 'u1', storage, api: async () => { throw fail }, onChange: (_s, status) => seen.push(status) })
    await client.sync()
    expect(seen.at(-1)).toBe('suspended')
    fail = new TypeError('Failed to fetch')
    await client.sync()
    expect(seen.at(-1)).toBe('offline')
  })
  it('E: the receiver being down lands on a clear notice, never on the proxy error page', () => {
    expect(ssoErrorFromHash('#error=down')).toBe('down')
    expect(es['Búnker is not available right now, try again in a few minutes.']).toBe('Búnker no está disponible ahora mismo, inténtalo en unos minutos.')
    expect(renderToStaticMarkup(<SsoFailure kind="down" />)).not.toContain('passkey')
    const nginx = read('../../../web/nginx.conf')
    const block = nginx.match(/location ~ \^\/api\/platform\/v1\/\(sso\|stepup\|staff-sso\)\/receive\$ \{[\s\S]*?\n    \}/)?.[0] ?? ''
    expect(block).toContain('error_page 502 504 =303 /sso#error=down')
    expect(block).not.toContain('proxy_intercept_errors on')
  })
})
