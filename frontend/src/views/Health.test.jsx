import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Health V2, check-in and integrations — rendered over the real store booted from storage (same
 * harness as Mi2J.test.jsx). The network is down the whole time: every call rejects, so this is
 * also the offline path. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, views

async function boot(nav = {}) {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('navigator', nav)
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  ;({ useStore: store } = await import('../store/useStore.js'))
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  views = {
    Health: (await import('./Health.jsx')).default,
    Integrations: (await import('./HealthIntegrations.jsx')).default,
    CheckIn: (await import('../components/CheckInCard.jsx')).default,
  }
}
async function seed(over = {}, nav) {
  memory = new Map()
  await boot(nav)
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'female', onboarded: true, height: 168 }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  await boot(nav)
}
const render = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)
const journalOps = () => { const r = memory.get('gym_sync_v2:u1'); return r ? JSON.parse(r).operations : [] }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-20T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Health V2 screen', () => {
  it('no data: an inviting empty state, not a wall of zeros', async () => {
    await seed()
    const html = render(<views.Health />)
    expect(html).toContain('Your evolution will appear here')
    expect(html).not.toMatch(/>0 kg</)
  })
  it('real readings with their source, change over the range, never a verdict', async () => {
    await seed({
      bodyweight: [{ d: '2026-06-01', w: 70, t: 1, src: 'manual' }, { d: '2026-09-15', w: 67.5, t: 2, src: 'scan' }],
      measurements: { bodyFat: [{ d: '2026-06-01', v: 29, src: 'scan' }, { d: '2026-09-15', v: 26.5, src: 'scan' }],
        segMuscleArmL: [{ d: '2026-09-15', v: 2.1, src: 'scan' }] },
    })
    const html = render(<views.Health />)
    expect(html).toContain('Your physical evolution')
    expect(html).toContain('67,5')
    expect(html).toContain('−2,5 kg')
    expect(html).toContain('Scanned report')
    expect(html).toContain('BMI')
    expect(html).not.toMatch(/better|worse|healthy|unhealthy|obes/i)
  })
})

describe('check-in', () => {
  it('saved offline travels in the one existing Sync V2 journal — no second queue', async () => {
    await seed()
    const { saveCheckin } = await import('../lib/checkin.js')
    store.getState().update(s => { saveCheckin(s, { energy: 4, sleep: 3, fatigue: 2, pain: true, zones: ['knee'] }) })
    const S = store.getState().S
    expect(S.checkins).toHaveLength(1)
    const ops = journalOps()
    expect(ops.length).toBe(1)
    expect(ops[0].state.checkins[0]).toMatchObject({ energy: 4, zones: ['knee'] })
    expect([...memory.keys()].filter(k => /checkin|health|queue/i.test(k))).toEqual([])
    // Survives a reopen (still offline).
    await boot()
    expect(store.getState().S.checkins).toHaveLength(1)
  })
  it('the card is skippable in one tap and says who can see it', async () => {
    await seed()
    const html = render(<views.CheckIn />)
    expect(html).toContain('>Skip<')
    expect(html).toContain('unless you share check-ins')
  })
})

describe('integrations screen', () => {
  it('no fake buttons: iPhone gets no Bluetooth action and nothing offers Health Connect', async () => {
    await seed({}, {})
    const html = render(<views.Integrations />)
    expect(html).toContain('Not compatible')
    expect(html).toContain('Import Apple Health export')
    expect(html).not.toMatch(/Connect Health Connect|Connect HealthKit|Connect Zepp/i)
  })
  it('Bluetooth shows as compatible only when the browser has it', async () => {
    await seed({}, { bluetooth: { requestDevice: () => {} } })
    const html = render(<views.Integrations />)
    expect(html).toContain('Experimental. Connect a chest strap')
    expect(html).not.toContain('Not compatible')
  })
})

describe('staff follow-up alerts are facts in words', () => {
  it('every alert code has a sentence with its number', async () => {
    await seed()
    const { alertText } = await import('./AdminFollowUp.jsx')
    expect(alertText({ code: 'review_overdue', days: 5 })).toBe('Review overdue by 5 days')
    expect(alertText({ code: 'repeated_discomfort', zone: 'knee', n: 3 })).toBe('Discomfort in knee reported 3 times in 14 days')
    expect(alertText({ code: 'no_recent_workouts', days: 19 })).toContain('19')
  })
})
