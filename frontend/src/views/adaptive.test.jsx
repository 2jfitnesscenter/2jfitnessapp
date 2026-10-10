import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Adaptive UX over the real store (same harness as Mi2J.test.jsx): Home stays simple, Progress holds the depth and
 * each module appears only when it is allowed by the admin, chosen by the member and justified by data; existing
 * profiles (S.ux === null) keep everything; the configurator only offers what can really be switched. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, views, F
const BENCH = '0025'
const wk = (id, d, sets) => ({ id, d, start: 1, end: 2, name: 'Pecho', prs: [], vol: 1,
  entries: [{ id: BENCH, target: { sets: sets.length, reps: 5, mode: 'reps' }, sets: sets.map(([w, r]) => ({ w, r, done: true })) }] })
const HISTORY = () => ({ workouts: [wk('a', '2026-09-02', [[80, 5]]), wk('b', '2026-09-09', [[85, 5]])], routines: [{ id: 'r1', name: 'Push', emoji: '💪', prog: 'off', ex: [{ id: BENCH, sets: 3, reps: 5, mode: 'reps', weight: 80 }] }] })

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  ;({ useStore: store } = await import('../store/useStore.js'))
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  F = await import('../lib/features.js')
  views = {
    Home: (await import('./Home.jsx')).default,
    Stats: (await import('./Stats.jsx')).default,
    Profile: (await import('./Profile.jsx')).default,
    Settings: (await import('./Settings.jsx')).default,
    Setup: (await import('./ExperienceSetup.jsx')).default,
    TabBar: (await import('../components/TabBar.jsx')).default,
  }
}
async function seed(over = {}, admin = null) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, height: 178 }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
}
const render = async View => renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>)
const ux = uses => F.makeUx(uses)
const COMPOSITION = { bodyFat: [{ d: '2026-09-05', v: 18.4, t: 1 }], muscleMass: [{ d: '2026-09-05', v: 37.2, t: 1 }] }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Home stays simple', () => {
  it('no recovery, body map, weight logging, latest-step or goal cards on Home — for anybody', async () => {
    await seed({ ...HISTORY(), ux: { v: 1, at: 1, uses: { activity: false } }, bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }], measurements: COMPOSITION })
    const html = await render(views.Home)
    expect(html).toContain('Your week')
    for (const gone of ['Recovery', 'Last workout', 'Body weight', 'Latest step forward', 'Close to', 'Time for a new scan', 'Whoop recovery']) expect(html).not.toContain(gone)
  })
  it('Train with 2J disappears when the admin or the member switches it off', async () => {
    await seed({ ...HISTORY() })
    expect(await render(views.Home)).toContain('Train with 2J')
    await seed({ ...HISTORY(), ux: ux({ train2j: false }) })
    expect(await render(views.Home)).not.toContain('Train with 2J')
    await seed({ ...HISTORY() }, { train2j: false })
    expect(await render(views.Home)).not.toContain('Train with 2J')
  })
  it('existing profiles get one discreet invitation to personalise; new choices or dismissal remove it', async () => {
    await seed({ ...HISTORY() })
    expect(await render(views.Home)).toContain('Personalise your experience')
    await seed({ ...HISTORY(), ux: ux({}) })
    expect(await render(views.Home)).not.toContain('Personalise your experience')
    await seed({ ...HISTORY(), uxInviteDismissed: true })
    expect(await render(views.Home)).not.toContain('Personalise your experience')
    await seed({ ...HISTORY(), uxSetup: true })        // a brand-new profile does the setup instead
    expect(await render(views.Home)).not.toContain('Personalise your experience')
  })
})

describe('Progress holds the depth, adaptively', () => {
  it('a profile never personalised keeps everything it had (migration): recovery, last workout, weight and the insights', async () => {
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }, { d: '2026-09-08', w: 79.5, t: 2 }], measurements: COMPOSITION })
    const html = await render(views.Stats)
    for (const kept of ['Recovery', 'Last workout', 'Body weight', 'Body composition', 'Latest step forward']) expect(html).toContain(kept)
  })
  it('"just train": the optional modules are hidden, the base layer stays', async () => {
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }], measurements: COMPOSITION, ux: ux(F.PRESETS.simple) })
    const html = await render(views.Stats)
    for (const gone of ['Recovery', 'Body weight', 'Weight 30d', 'Body composition']) expect(html).not.toContain(gone)
    // Progress V3: the cover replaced the four stat tiles (period workouts / streak now live in it)
    for (const base of ['Your progress', 'Month', 'Activity', 'Exercise progress', 'Last workout']) expect(html).toContain(base)
  })
  it('bioimpedance appears only with data: no empty panel for someone who never scanned', async () => {
    await seed({ ...HISTORY(), measurements: {} })
    expect(await render(views.Stats)).not.toContain('Body composition')
    await seed({ ...HISTORY(), measurements: COMPOSITION })
    expect(await render(views.Stats)).toContain('Body composition')
  })
  it('body weight: an empty log is a one-line invitation, with data it is the chart; off hides both', async () => {
    await seed({ ...HISTORY(), bodyweight: [] })
    expect(await render(views.Stats)).toContain('Log your weight to see how it evolves')
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }] })
    const html = await render(views.Stats)
    expect(html).toContain('Body weight'); expect(html).not.toContain('Log your weight to see how it evolves')
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }] }, { bodyweight: false })
    expect(await render(views.Stats)).not.toContain('Body weight')
  })
  it('effort: nothing when off, a minimal invitation when on without data, the card when there is data', async () => {
    await seed({ ...HISTORY(), effort: 'none', ux: ux({ effort: false }) })
    expect(await render(views.Stats)).not.toContain('how close to failure')
    await seed({ ...HISTORY(), effort: 'none' })
    expect(await render(views.Stats)).toContain('Rate how hard your sets feel')
    const rated = HISTORY(); rated.workouts[1].entries[0].sets[0].rpe = 8
    await seed({ ...rated, effort: 'rpe' })
    expect(await render(views.Stats)).toContain('how close to failure')
  })
})

describe('Settings, Profile and navigation follow the same rules', () => {
  it('Settings is grouped and opens the configurator from Appearance', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Settings)
    for (const g of ['Personalise my experience', 'Training', 'Data', 'Appearance', 'Advanced']) expect(html).toContain(g)
    expect(html.indexOf('Personalise my experience')).toBeGreaterThan(html.indexOf('Appearance'))
    expect(html.indexOf('Appearance')).toBeLessThan(html.indexOf('Advanced'))
  })
  it('a feature the admin turned off is not offered in Settings at all', async () => {
    await seed({ ...HISTORY() })
    expect(await render(views.Settings)).toContain('Bioimpedance reminder')
    await seed({ ...HISTORY() }, { bioimpedance: false })
    expect(await render(views.Settings)).not.toContain('Bioimpedance reminder')
  })
  it('Profile leads with the essentials and keeps the rest in quiet groups', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Profile)
    expect(html.indexOf('About you')).toBeLessThan(html.indexOf('Training priorities'))
    expect(html).toContain('Body &amp; health')
    expect(html).not.toContain('Body weight')
    await seed({ ...HISTORY(), ux: ux({ bioimpedance: false, health: false }) })
    expect(await render(views.Profile)).not.toContain('Body &amp; health')
  })
  it('the tab bar drops Social when it is off for the gym or for the member', async () => {
    await seed({ ...HISTORY() })
    expect(await render(views.TabBar)).toContain('Social')
    await seed({ ...HISTORY() }, { social: false })
    expect(await render(views.TabBar)).not.toContain('Social')
    await seed({ ...HISTORY(), ux: ux({ social: false }) })
    expect(await render(views.TabBar)).not.toContain('Social')
  })
})

describe('the configurator', () => {
  it('lists the cards the admin allows, with the visual hints that are always the member’s', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Setup)
    for (const c of ['Just train', 'Balanced', 'Everything', 'Effort (RPE / RIR)', 'Body weight', 'Recovery', 'Visual hints', 'AI Coach', 'Social']) expect(html).toContain(c)
    await seed({ ...HISTORY() }, { effort: false, coach: false, social: false, bodyweight: false })
    const off = await render(views.Setup)
    for (const gone of ['Effort (RPE / RIR)', 'AI Coach', 'Body weight']) expect(off).not.toContain(gone)
    expect(off).toContain('Visual hints'); expect(off).toContain('Recovery')
    expect(off).not.toMatch(/ux-t">Social</)
  })
  it('saving writes only the member’s own state (S.ux) and ends the new-profile setup', async () => {
    await seed({ ...HISTORY(), uxSetup: true })
    const { PRESETS, makeUx } = F
    store.getState().update(s => { s.ux = makeUx(PRESETS.simple); s.uxSetup = false; s.uxInviteDismissed = true })
    const S = store.getState().S
    expect(S.ux.v).toBe(1); expect(S.ux.uses.effort).toBe(false); expect(S.uxSetup).toBe(false)
    expect(S.workouts).toHaveLength(2)          // nothing else changed: no data is touched by hiding things
  })
})
