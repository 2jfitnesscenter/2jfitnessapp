import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Settings → Security: the passkey list and its client flows. The server decides everything (ownership, step-up, last passkey); this checks that
 * the screen shows what it is given, asks for the step-up before the sensitive calls, sends it as a header, and speaks Spanish. */
const calls = []
vi.mock('../lib/api.js', () => ({
  api: vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', headers: opts.headers || null, body: opts.body ? JSON.parse(opts.body) : null })
    if (path === '/api/me/step-up/options') return { cid: 'c1', options: { challenge: 'AAAA', allowCredentials: [] } }
    if (path === '/api/me/step-up') return { token: 'tok-1', expiresAt: Date.now() + 300000 }
    if (path === '/api/me/passkeys/options') return { cid: 'c2', options: { challenge: 'AAAA', user: { id: 'AAAA' }, excludeCredentials: [] } }
    return { ok: true }
  }),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => true,
  toCreationOptions: o => o, toRequestOptions: o => o, credToJSON: c => c,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
let memory, i18n, mod, sec

beforeEach(async () => {
  calls.length = 0
  memory = new Map()
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) })
  vi.stubGlobal('navigator', { credentials: { get: vi.fn(async () => ({ id: 'a' })), create: vi.fn(async () => ({ id: 'b' })) } })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  i18n = await import('../lib/i18n.js')
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  mod = await import('./SecuritySettings.jsx')
  sec = await import('../lib/security-api.js')
})
afterEach(() => vi.unstubAllGlobals())

const render = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)
const legacy = { id: 'h1', name: null, createdAt: null, lastUsedAt: null, transports: ['internal'], legacy: true }
const modern = { id: 'h2', name: 'Móvil de Ana', createdAt: '2026-09-01T10:00:00.000Z', lastUsedAt: '2026-10-01T08:30:00.000Z', transports: ['internal'], legacy: false }

describe('the passkey rows', () => {
  it('a legacy passkey (no name, no dates) is still listed, with a neutral name and an honest note', async () => {
    await i18n.setLang('en')
    const h = render(<mod.PasskeyRow p={legacy} index={0} only={false} onChanged={() => {}} />)
    expect(h).toContain('Passkey 1'); expect(h).toContain('Earlier'); expect(h).toContain('Added before dates were recorded'); expect(h).toContain('No sign-in recorded yet')
    expect(h).not.toMatch(/NaN|undefined|Invalid Date/)
  })
  it('a named passkey shows its name, creation and last use; the only passkey cannot be removed', async () => {
    await i18n.setLang('en')
    const h = render(<mod.PasskeyRow p={modern} index={1} only onChanged={() => {}} />)
    expect(h).toContain('Móvil de Ana'); expect(h).toMatch(/Added .*2026|Added .*Sep/); expect(h).toMatch(/Last used/)
    expect(h).toMatch(/aria-label="Remove Móvil de Ana"[^>]*disabled=""|disabled=""[^>]*aria-label="Remove Móvil de Ana"/)
    expect(render(<mod.PasskeyRow p={modern} index={1} only={false} onChanged={() => {}} />)).not.toMatch(/aria-label="Remove Móvil de Ana"[^>]*disabled=""/)
  })
  it('speaks Spanish', async () => {
    await i18n.setLang('es')
    const h = render(<mod.PasskeyRow p={legacy} index={0} only={false} onChanged={() => {}} />)
    expect(h).toContain('Passkey 1'); expect(h).toContain('Anterior'); expect(h).toContain('Aún sin inicios de sesión registrados')
  })
})

describe('the client flows', () => {
  it('adding a passkey confirms with an existing one first and sends the step-up token with every following call', async () => {
    await sec.addPasskey('Portátil')
    expect(calls.map(c => c.path)).toEqual(['/api/me/step-up/options', '/api/me/step-up', '/api/me/passkeys/options', '/api/me/passkeys/verify'])
    expect(calls[1].body.purpose).toBe('passkeys')
    expect(calls[2].headers['X-Step-Up']).toBe('tok-1'); expect(calls[3].headers['X-Step-Up']).toBe('tok-1')
    expect(calls[3].body).toMatchObject({ cid: 'c2', name: 'Portátil' })
    expect(globalThis.navigator.credentials.get).toHaveBeenCalledTimes(1); expect(globalThis.navigator.credentials.create).toHaveBeenCalledTimes(1)
  })
  it('removing a passkey also confirms first; renaming does not need to', async () => {
    await sec.revokePasskey('h2')
    expect(calls.map(c => c.path)).toEqual(['/api/me/step-up/options', '/api/me/step-up', '/api/me/passkeys/revoke'])
    expect(calls[2].headers['X-Step-Up']).toBe('tok-1'); expect(calls[2].body).toEqual({ id: 'h2' })
    calls.length = 0
    await sec.renamePasskey('h2', 'Nuevo')
    expect(calls.map(c => c.path)).toEqual(['/api/me/passkeys/rename']); expect(calls[0].headers).toBeNull()
  })
  it('every event the server can log has a label, in English and in Spanish', () => {
    const server = readFileSync(new URL('../../../api/lib/security-audit.js', import.meta.url), 'utf8')
    const events = [...server.match(/SECURITY_EVENTS = \[([\s\S]*?)\]/)[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1])
    expect(events.length).toBeGreaterThan(10)
    const es = readFileSync(new URL('../locales/es.js', import.meta.url), 'utf8')
    for (const e of events) {
      expect(sec.EVENT_LABEL[e], e).toBeTruthy()
      expect(es.includes("'" + sec.EVENT_LABEL[e] + "':"), sec.EVENT_LABEL[e]).toBe(true)
    }
  })
})

describe('the screen', () => {
  // The signed-in person comes from the saved profile at load, so each case boots the modules again with that profile in storage.
  const screenFor = async user => {
    vi.resetModules()
    if (user) memory.set('gym_user', JSON.stringify(user)); else memory.delete('gym_user')
    const { useUI } = await import('../store/useUI.js')
    ;(await import('../components/ui.jsx')).bindUI(useUI)
    await (await import('../lib/i18n.js')).setLang('en')
    const View = (await import('./SecuritySettings.jsx')).default
    return render(<View />)
  }
  it('asks a signed-out visitor to sign in, and a shared-computer PIN session to use a passkey', async () => {
    expect(await screenFor(null)).toContain('Sign in to manage your security.')
    expect(await screenFor({ id: 'u1', name: 'Ana', authLevel: 'pin' })).toContain('managed after signing in with a passkey')
    const h = await screenFor({ id: 'u1', name: 'Ana', authLevel: 'passkey' })
    expect(h).toContain('Your passkeys'); expect(h).toContain('Recent security activity')
  })
})

describe('your devices', () => {
  const here = { id: 's1', platform: 'Android · Chrome', via: 'passkey', createdAt: '2026-10-01T08:00:00.000Z', lastUsedAt: '2026-10-09T09:00:00.000Z', current: true }
  const other = { ...here, id: 's2', platform: 'Windows · Edge', via: 'qr', current: false }
  it('shows platform, when it was created and last used, marks this device, and offers to end only the others', async () => {
    await i18n.setLang('en')
    const a = render(<mod.SessionRow s={here} onEnd={() => {}} />)
    expect(a).toContain('Android · Chrome'); expect(a).toContain('This device'); expect(a).toContain('Last used'); expect(a).not.toContain('Sign out</button>')
    const b = render(<mod.SessionRow s={other} onEnd={() => {}} />)
    expect(b).toContain('Windows · Edge'); expect(b).toContain('Linked with a QR code'); expect(b).toContain('Sign out</button>'); expect(b).not.toContain('This device')
    expect(b).not.toMatch(/NaN|undefined|Invalid Date/)
  })
  it('speaks Spanish', async () => {
    await i18n.setLang('es')
    expect(render(<mod.SessionRow s={other} onEnd={() => {}} />)).toContain('Vinculado con un código QR')
  })
  it('ending one device is a single call with its id and nothing else', async () => {
    await sec.revokeSession('s2')
    expect(calls).toEqual([{ path: '/api/me/sessions/revoke', method: 'POST', headers: null, body: { id: 's2' } }])
  })
})
