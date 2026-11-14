import { describe, expect, it } from 'vitest'
import { LEVEL_PATH, NOTICE_TEXT, loadBridgeView, noticeText } from './platform-notices.js'
import { ssoErrorFromHash } from './sso-landing.js'
import es from '../locales/es.js'

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const fake = routes => async url => routes[url] ?? reply(404, {})

describe('F9b · 2J Home bridge strip', () => {
  it('stays hidden (and asks nothing else) while the server has the bridge off', async () => {
    const calls = []
    const view = await loadBridgeView(async url => { calls.push(url); return reply(200, { invite_only: false }) })
    expect(view).toBeNull()
    expect(calls).toEqual(['/api/config'])
  })

  it('offers "Back to Home" only to an SSO session, and the fee-pending notice from the single table', async () => {
    const on = { '/api/config': reply(200, { platformBridge: true }) }
    expect(await loadBridgeView(fake({ ...on, [LEVEL_PATH]: reply(200, { sso: true, homeUrl: 'https://home.example.com', notice: null }) })))
      .toEqual({ back: 'https://home.example.com', notice: null })
    expect(await loadBridgeView(fake({ ...on, [LEVEL_PATH]: reply(200, { sso: false, homeUrl: null, notice: 'PAYMENT_PENDING' }) })))
      .toEqual({ back: null, notice: NOTICE_TEXT.PAYMENT_PENDING })
    expect(await loadBridgeView(fake({ ...on, [LEVEL_PATH]: reply(200, { sso: true, homeUrl: 'javascript:alert(1)', notice: 'NOPE' }) }))).toBeNull()
    expect(await loadBridgeView(async () => { throw new Error('offline') })).toBeNull()
  })

  it('every notice has its Spanish text; unknown codes show nothing', () => {
    for (const text of Object.values(NOTICE_TEXT)) expect(es[text], text).toBeTruthy()
    expect(es['Back to Home']).toBe('Volver a Home')
    expect(noticeText('UNKNOWN')).toBeNull()
  })

  it('the receiver redirects are understood by the /sso landing', () => {
    expect(ssoErrorFromHash('#error=denied')).toBe('denied')
    expect(ssoErrorFromHash('#error=switch')).toBe('switch')
    expect(ssoErrorFromHash('#error=other')).toBeNull()
  })
})
