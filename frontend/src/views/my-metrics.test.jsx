import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* "My metrics" V1 over the real store: the Progress page is a closed catalogue the member can hide and re-order (inside S.ux), legacy profiles see exactly what they always saw,
   Health points to the single weight chart, one place for integrations, platform-aware source names, and no stale copy. Decisions live in lib/progress-cards.test.js. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, views, F, P
const BENCH = '0025'
const wk = (id, d, sets) => ({ id, d, start: 1, end: 2, name: 'Pecho', prs: [], vol: 1,
  entries: [{ id: BENCH, target: { sets: sets.length, reps: 5, mode: 'reps' }, sets: sets.map(([w, r]) => ({ w, r, done: true })) }] })
const DATA = () => ({
  workouts: [wk('a', '2026-09-02', [[80, 5]]), wk('b', '2026-09-09', [[85, 5]])],
  routines: [{ id: 'r1', name: 'Push', emoji: '💪', prog: 'off', ex: [{ id: BENCH, sets: 3, reps: 5 }] }],
  bodyweight: [{ d: '2026-09-08', w: 80.4 }, { d: '2026-08-20', w: 82 }],       // deliberately out of order
  measurements: { bodyFat: [{ d: '2026-09-05', v: 18.4, t: 1 }], muscleMass: [{ d: '2026-09-05', v: 37.2, t: 1 }] },
})

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  F = await import('../lib/features.js'); P = await import('../lib/progress-cards.js')
  views = { Stats: (await import('./Stats.jsx')).default, Health: (await import('./Health.jsx')).default, Profile: (await import('./Profile.jsx')).default, Settings: (await import('./Settings.jsx')).default, Setup: (await import('./ExperienceSetup.jsx')).default }
}
async function seed(over = {}) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, height: 178, ...DATA() }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  await boot()
}
const render = async View => renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>)
const at = (h, s) => h.indexOf(s)
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Progress follows the member\'s layout', () => {
  it('a legacy profile (S.ux null) sees the blocks in the order they always had', async () => {
    await seed()
    const h = await render(views.Stats)
    const order = ['Body composition', 'Body weight', 'Activity — last 12 months', 'Exercise progress'].map(k => at(h, k))
    expect(order.every(i => i >= 0)).toBe(true); expect([...order].sort((a, b) => a - b)).toEqual(order)
  })
  it('an S.ux with uses but no progress field is identical to the legacy page', async () => {
    await seed()
    const legacy = await render(views.Stats)
    await seed({ ux: F.makeUx(F.currentUses({ ux: null })) })
    expect(await render(views.Stats)).toBe(legacy)
  })
  it('hiding a block removes only that block; the data stays', async () => {
    await seed({ ux: F.makeUx(F.currentUses({ ux: null }), 1, { progress: { order: P.PROGRESS_IDS, hidden: ['weight'] } }) })
    const h = await render(views.Stats)
    expect(h).not.toContain('Log your weight to see how it evolves'); expect(h).not.toContain('class="seg-range"><button')   // the weight card (chart + ranges) is gone
    expect(h).toContain('Activity — last 12 months'); expect(h).toContain('Exercise progress')
    expect(JSON.parse(memory.get('gym_state_v1')).bodyweight).toHaveLength(2)
  })
  it('re-ordering moves the block: activity before weight', async () => {
    const order = ['activity', ...P.PROGRESS_IDS.filter(i => i !== 'activity')]
    await seed({ ux: F.makeUx(F.currentUses({ ux: null }), 1, { progress: { order, hidden: [] } }) })
    const h = await render(views.Stats)
    expect(at(h, 'Activity — last 12 months')).toBeLessThan(at(h, 'Body composition'))
  })
  it('the structural parts are never hidden: header, period cover and recent workouts', async () => {
    await seed({ ux: F.makeUx(F.currentUses({ ux: null }), 1, { progress: { order: P.PROGRESS_IDS, hidden: [...P.PROGRESS_IDS] } }) })
    const h = await render(views.Stats)
    expect(h).toContain('Progress &amp; history'); expect(h).toContain('v3-cover'); expect(h).toContain('Recent workouts')
  })
  it('a feature switched off still wins over a block the member kept', async () => {
    await seed({ ux: F.makeUx({ ...F.currentUses({ ux: null }), bodyweight: false }, 1, { progress: { order: P.PROGRESS_IDS, hidden: [] } }) })
    expect(await render(views.Stats)).not.toContain('class="seg-range"')
  })
})

describe('the configurator (the existing screen) carries the layout', () => {
  it('lists the blocks that can really be shown, with up/down and a switch, and the restore button', async () => {
    await seed()
    const h = await render(views.Setup)
    for (const k of ['Progress page', 'Restore recommended settings', 'Highlights', 'Body weight', 'Activity map', 'Exercise progress', 'Move down: Highlights']) expect(h).toContain(k)
    expect(h).toMatch(/<button[^>]*ux-pc-mv[^>]*disabled=""[^>]*aria-label="Move up: Highlights"/)      // the first row cannot go up
    expect((h.match(/ux-pc-row/g) || []).length).toBe(P.PROGRESS_IDS.length + (await import('../lib/home-blocks.js')).HOME_IDS.length)   // the Progress blocks + the Home blocks
  })
  it('hidden blocks show as off; a block whose feature is off is not offered', async () => {
    await seed({ ux: F.makeUx({ ...F.currentUses({ ux: null }), bioimpedance: false }, 1, { progress: { order: P.PROGRESS_IDS, hidden: ['cardio'] } }) })
    const h = await render(views.Setup)
    expect(h).toMatch(/ux-pc-row off[^>]*>(?:(?!ux-pc-row)[\s\S])*Cardio tests/)
    expect(h.match(/<span class="ux-pc-t">([^<]*)</g).join()).not.toContain('Body composition')
  })
})

describe('Health, integrations, labels and copy', () => {
  it('Health shows a weight summary that leads to the one chart (Progress), or to Measurements when that block is hidden', async () => {
    await seed()
    const h = await render(views.Health)
    expect(h).toContain('The weight chart is in Progress.')
    await seed({ ux: F.makeUx(F.currentUses({ ux: null }), 1, { progress: { order: P.PROGRESS_IDS, hidden: ['weight'] } }) })
    expect(await render(views.Health)).toContain('Log and review your weight in Measurements.')
  })
  it('Settings has one Integrations row and no second "Connected apps"; the reminder copy says Progress', async () => {
    await seed()
    const h = await render(views.Settings)
    expect(h).toContain('Integrations'); expect(h).not.toContain('Connected apps')
    expect(h).toContain('A reminder in Progress'); expect(h).not.toContain('A nudge on Home')
  })
  it('Profile names the real health source, never a fixed "Apple Health"', async () => {
    const profile = readFileSync(new URL('./Profile.jsx', import.meta.url), 'utf8')          // the row lives inside a collapsed section, so check the source
    expect(profile).toContain("t('Steps, sleep and heart rate from {0}', t(platformLabel(getBridge())))"); expect(profile).not.toContain('from Apple Health')
    const { platformLabel } = await import('../lib/health-bridge.js')
    expect(platformLabel({ platform: 'android' })).toBe('Health Connect'); expect(platformLabel({ platform: 'ios' })).toBe('Apple Health'); expect(platformLabel(null)).toBe('Health')
  })
  it('one integrations screen: WHOOP and Strava connect there, /connected-apps only forwards, Apple export is not offered on Android', () => {
    const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')
    const hi = read('./HealthIntegrations.jsx')
    expect(hi).toContain('connectStrava'); expect(hi).toContain('disconnectStrava'); expect(hi).toContain("params.get('strava')")
    expect(hi).toContain("bridge?.platform !== 'android'")
    expect(read('./ConnectedApps.jsx')).toContain("'/health/integrations' + search")
    expect(read('../App.jsx')).toContain('<Route path="/health/integrations" element={<HealthIntegrations />} />')
    expect(read('./Rank.jsx')).not.toContain('Log bodyweight on Home')
  })
})
