import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isSsoLanding, redeemSso, resetSsoLandingForTests, runSsoLanding, ssoCodeFromHash, ssoOutcome } from './sso-landing.js'

const CODE = 'Q'.repeat(43)
const reply = (status, body) => vi.fn(async () => ({ status, json: async () => body }))

describe('reading the one-time code', () => {
  it('accepts only #code=<43-128 url-safe chars> and nothing else in the fragment', () => {
    expect(ssoCodeFromHash(`#code=${CODE}`)).toBe(CODE)
    for (const bad of ['', '#', '#code=', '#code=short', `#code=${CODE}&x=1`, `#/code=${CODE}`, `code=${CODE}`, `#CODE=${CODE}`, `#code=${CODE}!`, null, undefined]) expect(ssoCodeFromHash(bad)).toBe(null)
  })
  it('only the exact /sso path is the landing (never the hash router)', () => {
    expect(isSsoLanding({ pathname: '/sso' })).toBe(true)
    for (const path of ['/', '/sso/', '/sso/x', '/api/sso', '/#/sso']) expect(isSsoLanding({ pathname: path })).toBe(false)
  })
})

describe('redeeming the code', () => {
  it('posts only {v:1, code} to Training itself, same origin, no storage of the code', async () => {
    const fetchImpl = reply(200, { ok: true, user: { id: 'u1', authLevel: 'sso' } })
    const result = await redeemSso(CODE, fetchImpl)
    expect(result).toEqual({ ok: true, user: { id: 'u1', authLevel: 'sso' } })
    const [url, init] = fetchImpl.mock.calls[0]
    expect(url).toBe('/api/platform/v1/sso/redeem')
    expect(init.method).toBe('POST'); expect(init.credentials).toBe('same-origin')
    expect(JSON.parse(init.body)).toEqual({ v: 1, code: CODE })
    expect(JSON.stringify(result)).not.toContain(CODE)
  })
  it('maps every failure to a next step without exposing Platform reasons', async () => {
    expect(ssoOutcome(423, { error: 'platform_sso_disabled' })).toBe('disabled')
    expect(ssoOutcome(403, { error: 'platform_access_blocked', reasonCode: 'ADMIN_SUSPENDED' })).toBe('blocked')
    expect(ssoOutcome(403, { error: 'origin_rejected' })).toBe('unavailable')
    expect(ssoOutcome(409, { error: 'link_not_confirmed' })).toBe('link')
    expect(ssoOutcome(409, { error: 'link_conflict' })).toBe('link')
    expect(ssoOutcome(400, { error: 'sso_code_invalid' })).toBe('invalid')
    expect(ssoOutcome(429, {})).toBe('busy')
    expect(ssoOutcome(503, { error: 'platform_unavailable' })).toBe('unavailable')
    expect(await redeemSso(CODE, reply(400, { error: 'sso_code_invalid' }))).toEqual({ ok: false, kind: 'invalid' })
    expect(await redeemSso(CODE, vi.fn(async () => { throw new Error('offline') }))).toEqual({ ok: false, kind: 'unavailable' })
    expect(await redeemSso(CODE, vi.fn(async () => ({ status: 500, json: async () => { throw new Error('not json') } })))).toEqual({ ok: false, kind: 'unavailable' })
  })
})

describe('the landing run', () => {
  beforeEach(() => resetSsoLandingForTests())
  it('clears the code from the address bar BEFORE the request, then goes to the app on success', async () => {
    const order = []
    const history = { replaceState: vi.fn(() => order.push('scrub')) }
    const fetchImpl = vi.fn(async () => { order.push('request'); return { status: 200, json: async () => ({ ok: true }) } })
    const go = vi.fn(path => order.push(`go:${path}`))
    const result = await runSsoLanding({ location: { hash: `#code=${CODE}` }, history, fetchImpl, go })
    expect(result.ok).toBe(true)
    expect(order).toEqual(['scrub', 'request', 'go:/'])
    expect(history.replaceState).toHaveBeenCalledWith(null, '', '/sso')
  })
  it('is single-use even if the page mounts twice (StrictMode): one request, same result', async () => {
    const fetchImpl = reply(400, { error: 'sso_code_invalid' })
    const args = { location: { hash: `#code=${CODE}` }, history: { replaceState() {} }, fetchImpl, go: vi.fn() }
    const [first, second] = await Promise.all([runSsoLanding(args), runSsoLanding(args)])
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(first).toBe(second); expect(first).toEqual({ ok: false, kind: 'invalid' })
    expect(args.go).not.toHaveBeenCalled()
  })
  it('a missing or malformed code never triggers a request', async () => {
    const fetchImpl = vi.fn()
    const result = await runSsoLanding({ location: { hash: '#/' }, history: { replaceState() {} }, fetchImpl, go: vi.fn() })
    expect(result).toEqual({ ok: false, kind: 'invalid' }); expect(fetchImpl).not.toHaveBeenCalled()
  })
})
