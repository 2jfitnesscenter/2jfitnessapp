import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// C3: e-mail on registration and profile. Every call goes through the base-aware api() / apiUrl.
const jsonResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })
let calls
beforeEach(() => {
  calls = []
  vi.stubGlobal('fetch', vi.fn(async (url, opts) => { calls.push({ url, opts }); return jsonResponse({ cid: 'c', options: {}, email: 'ana@example.com', emailVerified: false, user: { email: 'ana@example.com', emailVerified: true } }) }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetModules() })

describe('normalizeAccountEmail (same rule as the API)', () => {
  it('trims and lowercases; invalid values are null; empty is "no e-mail"', async () => {
    const { normalizeAccountEmail } = await import('./account-email.js')
    expect(normalizeAccountEmail('  Ana.Perez@Example.COM ')).toBe('ana.perez@example.com')
    for (const bad of ['a@', '@b.co', 'no-at-sign', 'a b@c.de', 'a@b', 'x'.repeat(250) + '@b.co', 42, null]) expect(normalizeAccountEmail(bad)).toBeNull()
    expect(normalizeAccountEmail('a@b.c')).toBe('a@b.c')
  })
})

describe('registration', () => {
  it('sends the normalized e-mail in the register/options request when filled, and omits it when empty', async () => {
    const { registerOptionsBody } = await import('./account-email.js')
    expect(registerOptionsBody('Ana Perez', 'CODE', ' Ana@Example.com ')).toEqual({ name: 'Ana Perez', code: 'CODE', email: 'ana@example.com' })
    expect(registerOptionsBody('Ana Perez', '', '')).toEqual({ name: 'Ana Perez', code: '' })
    expect(registerOptionsBody('Ana Perez', '')).toEqual({ name: 'Ana Perez', code: '' })
  })
  it('passkeyRegister puts the e-mail in the POST /api/register/options body', async () => {
    vi.stubGlobal('navigator', { userAgent: 'x', credentials: { create: async () => { throw Object.assign(new Error('stop'), { name: 'AbortError' }) } } })
    const { passkeyRegister } = await import('./api.js')
    await expect(passkeyRegister('Ana Perez', '', 'Ana@Example.com')).rejects.toThrow()
    const first = calls[0]
    expect(first.url).toBe('/api/register/options')
    expect(JSON.parse(first.opts.body)).toMatchObject({ name: 'Ana Perez', email: 'ana@example.com' })
  })
})

describe('profile', () => {
  it('changing the e-mail posts to the e-mail endpoint through apiUrl (base-aware)', async () => {
    vi.stubEnv('BASE_URL', '/bunker/')
    vi.resetModules()
    const { updateAccountEmail } = await import('./account-email.js')
    const out = await updateAccountEmail(' Ana@Example.com ')
    expect(calls[0].url).toBe('/bunker/api/me/username')
    expect(calls[0].opts.method).toBe('POST')
    expect(JSON.parse(calls[0].opts.body)).toEqual({ email: 'ana@example.com' })
    expect(out).toEqual({ email: 'ana@example.com', emailVerified: false })
  })
  it('refuses an invalid e-mail before any request; an empty one clears it (email: null)', async () => {
    const { updateAccountEmail } = await import('./account-email.js')
    await expect(updateAccountEmail('garbage')).rejects.toThrow()
    expect(calls.length).toBe(0)
    await updateAccountEmail('')
    expect(JSON.parse(calls[0].opts.body)).toEqual({ email: null })
  })
  it('reads the current e-mail and its verified state from GET /api/me', async () => {
    const { fetchAccountEmail } = await import('./account-email.js')
    expect(await fetchAccountEmail()).toEqual({ email: 'ana@example.com', emailVerified: true })
    expect(calls[0].url).toBe('/api/me')
  })
  it('the status key says verified, not verified or no e-mail (translated in the view)', async () => {
    const { emailStatusKey } = await import('./account-email.js')
    expect(emailStatusKey({ email: 'a@b.co', emailVerified: true })).toBe('Verified')
    expect(emailStatusKey({ email: 'a@b.co', emailVerified: false })).toBe('Not verified')
    expect(emailStatusKey({ email: null, emailVerified: false })).toBe('No e-mail')
  })
})
