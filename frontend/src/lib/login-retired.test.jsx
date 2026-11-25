import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { LOGIN_RETIRED_TEXT, LOGIN_RETIRED_TITLE, OPEN_HOME, loginRetiredHome } from './platform-notices.js'
import { waitForLink } from './security-api.js'
import LoginRetiredSheet from '../components/LoginRetiredSheet.jsx'
import es from '../locales/es.js'

const err = data => Object.assign(new Error(data?.error || 'x'), { status: 403, data })

describe('F9d · "Entra desde 2J Home" (Búnker sign-in retired for linked members)', () => {
  it('only the login_retired answer with an http(s) Home URL opens the screen', () => {
    expect(loginRetiredHome(err({ code: 'login_retired', homeUrl: 'https://home.example' }))).toBe('https://home.example')
    expect(loginRetiredHome(err({ code: 'login_retired', homeUrl: 'javascript:alert(1)' }))).toBeNull()
    expect(loginRetiredHome(err({ code: 'passkey_required' }))).toBeNull()
    expect(loginRetiredHome(new Error('network'))).toBeNull()
    expect(loginRetiredHome(null)).toBeNull()
  })

  it('the screen links to Home and is translated into Spanish', () => {
    const html = renderToStaticMarkup(<LoginRetiredSheet homeUrl="https://home.example" close={() => {}} />)
    expect(html).toContain('href="https://home.example"')
    expect(es[LOGIN_RETIRED_TITLE]).toBe('Entra desde 2J Home')
    expect(es[LOGIN_RETIRED_TEXT]).toContain('misma passkey')
    expect(es[OPEN_HOME]).toBe('Ir a 2J Home')
  })

  it('a QR link claim refused as login_retired ends with Home, not "expired"', async () => {
    const claim = vi.fn(async () => { throw err({ code: 'login_retired', homeUrl: 'https://home.example' }) })
    const out = await waitForLink({ id: 'x', secret: 'y', expiresAt: Date.now() + 60_000, claim, sleep: async () => {} })
    expect(out).toEqual({ ended: 'retired', homeUrl: 'https://home.example' })
  })
})

describe('F9e · "Entra desde 2J Hub" (Búnker sign-in retired for linked staff)', () => {
  it('a staff answer opens the staff variant, linking to 2J Hub Admin, in Spanish', async () => {
    const { STAFF_LOGIN_RETIRED_TITLE, STAFF_LOGIN_RETIRED_TEXT, OPEN_ADMIN, loginRetiredForStaff } = await import('./platform-notices.js')
    const staff = err({ code: 'login_retired', homeUrl: 'https://admin.example', audience: 'staff' })
    expect(loginRetiredForStaff(staff)).toBe(true)
    expect(loginRetiredForStaff(err({ code: 'login_retired', homeUrl: 'https://home.example' }))).toBe(false)
    expect(loginRetiredHome(staff)).toBe('https://admin.example')
    const html = renderToStaticMarkup(<LoginRetiredSheet homeUrl="https://admin.example" close={() => {}} staff />)
    expect(html).toContain('href="https://admin.example"')
    expect(es[STAFF_LOGIN_RETIRED_TITLE]).toBe('Entra desde 2J Hub')
    expect(es[STAFF_LOGIN_RETIRED_TEXT]).toContain('Abrir Búnker')
    expect(es[OPEN_ADMIN]).toBe('Ir a 2J Hub')
  })
})
