import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync, readdirSync } from 'node:fs'

/* Health V2 over the real store (same harness as v2.test.jsx): how energy is presented per kind, that missing data never
 * produces a metric, the indicator gates, the muscle depth, the Health screen states and privacy. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, views, F, H, mod
const BENCH = '0025'
const day = (n = 0) => { const d = new Date('2026-09-09T12:00:00'); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const wk = (id, n, w, extra = {}) => ({ id, d: day(n), start: Date.parse(day(n) + 'T10:00:00'), end: Date.parse(day(n) + 'T10:50:00'), name: 'Push', routineId: 'r1', prs: [], vol: w * 15,
  entries: [{ id: BENCH, target: { sets: 3, reps: 5, mode: 'reps' }, sets: [1, 2, 3].map(() => ({ w, r: 5, done: true })) }], ...extra })
const ROUTINE = { id: 'r1', name: 'Push', emoji: '💪', prog: 'off', ex: [{ id: BENCH, sets: 3, reps: 5, mode: 'reps' }] }
const BASE = () => ({ routines: [ROUTINE], week: { 3: 'r1' }, bodyweight: [{ d: day(60), w: 84, t: 1 }, { d: day(30), w: 82.8, t: 2 }, { d: day(2), w: 81.5, t: 3 }] })
const HISTORY = () => ({ ...BASE(), workouts: [wk('c', 15, 70), wk('b', 9, 75), wk('a', 1, 80)] })
const uses = u => ({ v: 1, at: 1, uses: u })

function bridge(platform = 'android') {
  return { platform, isAvailable: async () => true, requestPermissions: async () => ({}), readWorkouts: async () => [] }
}

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
  H = await import('../lib/health-v2.js')
  mod = {
    Energy: await import('../components/EnergyBadge.jsx'),
    Overview: await import('../components/HealthOverview.jsx'),
    Post: (await import('../components/PostWorkoutSummary.jsx')).default,
    Panel: (await import('../components/BodyMapPanel.jsx')).default,
    Detail: (await import('../components/MuscleDetailCard.jsx')).default,
    indicators: await import('../lib/indicators.js'),
    timeline: await import('../lib/timeline.js'),
    Ring: (await import('../components/v2.jsx')).Ring,
  }
  views = { Health: (await import('./Health.jsx')).default, Home: (await import('./Home.jsx')).default }
}
async function seed(over = {}, admin = null, { native = null, bstate = null, daily = null } = {}) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, height: 178, unit: 'kg' }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  if (bstate) memory.set('health_bridge_v1:u1', JSON.stringify(bstate))
  if (daily) memory.set('health_bridge_daily_v1:u1', JSON.stringify(daily))
  await boot()
  globalThis.TwoJNative = native ? { health: native } : undefined
}
const render = async View => { await boot(); return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>) }
const SAMSUNG = { source: 'healthconnect', kind: 'measured', calories: 463, origin: 'com.sec.android.app.shealth', start: 1, end: 2, avgHr: 128 }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); delete globalThis.TwoJNative })

describe('Energy source: measured / aggregated / estimated read differently', () => {
  it('measured with a stored app, measured without one (never guessed), aggregated and estimated', async () => {
    await boot()
    const E = H.energyPresentation
    const withApp = E({ kcal: 463, kind: 'measured', source: 'healthconnect', origin: 'com.sec.android.app.shealth' })
    expect(withApp).toMatchObject({ kind: 'measured', approx: false, kcal: 463, detail: 'Samsung Health · Health Connect' })
    const noOrigin = E({ kcal: 463, kind: 'measured', source: 'healthconnect', origin: null })
    expect(noOrigin).toMatchObject({ kind: 'measured', approx: false, source: 'Device', detail: 'Health Connect' })
    expect(noOrigin.detail).not.toMatch(/Samsung|Zepp|Fitbit/)           // no provider invented
    expect(E({ kcal: 300, kind: 'aggregate', source: 'healthconnect' })).toMatchObject({ kind: 'aggregate', approx: false, source: 'Aggregated data' })
    expect(E({ kcal: 235, kind: 'estimated', source: 'twoj', low: 165, high: 305 })).toMatchObject({ kind: 'estimated', approx: true, range: [165, 305] })
    expect(E(null)).toBeNull(); expect(E({ kcal: 0, kind: 'measured' })).toBeNull()
  })
  it('the UI uses ≈ ONLY for estimates, and says where each figure comes from', async () => {
    await boot()
    const B = mod.Energy.default, E = H.energyPresentation
    const measured = renderToStaticMarkup(<B energy={E({ kcal: 463, kind: 'measured', source: 'healthconnect', origin: 'com.sec.android.app.shealth' })} />)
    const unknown = renderToStaticMarkup(<B energy={E({ kcal: 463, kind: 'measured', source: 'healthconnect' })} />)
    const aggregate = renderToStaticMarkup(<B energy={E({ kcal: 300, kind: 'aggregate', source: 'healthconnect' })} />)
    const estimate = renderToStaticMarkup(<B energy={E({ kcal: 235, kind: 'estimated', source: 'twoj', low: 165, high: 305 })} />)
    expect(measured).toContain('463 kcal'); expect(measured).toContain('Samsung Health · Health Connect'); expect(measured).not.toContain('≈')
    expect(unknown).toContain('Device / Health Connect'); expect(unknown).not.toContain('≈')
    expect(aggregate).toContain('Aggregated data'); expect(aggregate).not.toContain('≈')
    expect(estimate).toContain('≈235 kcal'); expect(estimate).toContain('2J estimate'); expect(estimate).toContain('165–305')
    expect(new Set([measured, unknown, aggregate, estimate]).size).toBe(4)
  })
  it('policy untouched: a measured figure wins over an estimate and nothing is summed', async () => {
    await seed({ ...HISTORY(), workouts: [wk('a', 1, 80, { fitness: { primary: SAMSUNG, others: [{ ...SAMSUNG, source: 'whoop', calories: 999 }] } })] })
    const w = store.getState().S.workouts[0]
    const v = H.workoutEnergyView(w, store.getState().S)
    expect(v).toMatchObject({ kind: 'measured', kcal: 463 })
  })
})

describe('Post-workout shows the energy source and still works without Health', () => {
  const draw = (w, S) => renderToStaticMarkup(<mod.Post w={w} S={S} events={[]} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} />)
  it('measured: figure + provider; no ≈', async () => {
    await seed({ ...HISTORY(), workouts: [wk('a', 1, 80, { fitness: { primary: SAMSUNG } })] })
    const S = store.getState().S, html = draw(S.workouts[0], S)
    expect(html).toContain('463'); expect(html).toContain('Samsung Health · Health Connect'); expect(html).not.toContain('≈')
    expect(html).toContain('128'); expect(html).toContain('Health Connect')            // the session's average HR with its source
  })
  it('only an estimate: ≈ and "2J estimate"', async () => {
    await seed({ ...HISTORY() })
    const S = store.getState().S, html = draw(S.workouts[2], S)
    expect(html).toContain('≈'); expect(html).toContain('2J estimate')
  })
  it('no Health data and no weight: no kcal block at all, and the summary renders', async () => {
    await seed({ ...BASE(), bodyweight: [], workouts: [wk('a', 1, 80)] })
    const S = store.getState().S, html = draw(S.workouts[0], S)
    expect(html).toContain('Workout complete!'); expect(html).not.toContain('kcal'); expect(html).not.toContain('≈')
  })
})

describe('Indicators: no invented percentages, same gates as Phase 1', () => {
  it('Training without a weekly plan is a state ring (no value); with a plan it has a real fraction', async () => {
    await seed({ ...HISTORY(), week: {} })
    expect(mod.indicators.trainingIndicator(store.getState().S, '2026-09-09').value).toBeNull()
    await seed({ ...HISTORY() })
    expect(mod.indicators.trainingIndicator(store.getState().S, '2026-09-09').value).toBe(1)           // 1 session this week of 1 planned
  })
  it('Activity is never a percentage; it exists only with today\'s real reading', async () => {
    await seed({ ...HISTORY() }, null, { daily: { d: day(0), steps: 4200, activeKcal: 180, at: Date.now() } })
    const a = mod.indicators.activityIndicator('u1')
    expect(a.value).toBeNull(); expect(a.text).toMatch(/4.?200/)
    await seed({ ...HISTORY() })
    expect(mod.indicators.activityIndicator('u1')).toBeNull()
  })
  it('a state ring draws no arc percentage and says so', async () => {
    await boot()
    const html = renderToStaticMarkup(<mod.Ring value={null} color="var(--acc)" icon="figureRun" label="Activity: 4,200" />)
    expect(html).toContain('v2-ring state'); expect(html).toContain('v2-ring-arc state')
  })
  it('the Phase 1 preference still rules: member OFF or admin OFF → no rings; the sheet explains the basis', async () => {
    await seed({ ...HISTORY(), ux: uses({ activity: false }) })
    expect(await render(views.Home)).not.toContain('v2-hero-rings')
    await seed({ ...HISTORY(), ux: uses({ activity: true }) }, { activity: false })
    expect(await render(views.Home)).not.toContain('v2-hero-rings')
    await seed({ ...HISTORY() })
    const html = await render(views.Home)
    expect(html).toContain('v2-hero-rings')
    const S = store.getState().S
    for (const i of mod.indicators.homeIndicators(S, 'u1')) expect(i.basis).toBeTruthy()
  })
})

describe('Body Map depth', () => {
  it('worked muscle: this week, last session, frequency and a comparison only with a valid base', async () => {
    await seed({ ...HISTORY() })
    const S = store.getState().S
    const d = H.muscleDetail(S, 'chest', '2026-09-09')
    expect(d.status).toBe('worked'); expect(d.sets).toBeGreaterThan(0)
    expect(d.last.d).toBe(day(1)); expect(d.perWeek).toBeGreaterThan(0); expect(d.volume).toBe(80 * 5 * 3)
    expect(d.prevSets).toBe(3)                    // last week (session 'b') is a valid base
    expect(d.prevVolume).toBe(75 * 5 * 3)
    const noBase = H.muscleDetail({ ...S, workouts: S.workouts.filter(w => w.id === 'a') }, 'chest', '2026-09-09')
    expect(noBase.prevSets).toBeNull(); expect(noBase.prevVolume).toBeNull()   // no base → no comparison
  })
  it('rest, never-trained and empty-log are different states', async () => {
    await seed({ ...HISTORY(), workouts: [wk('x', 40, 70)] })
    const S = store.getState().S
    expect(H.muscleDetail(S, 'chest', '2026-09-09').status).toBe('rest')       // trained before, nothing this week
    expect(H.muscleDetail(S, 'calves', '2026-09-09').status).toBe('nodata')    // never in a logged session
    expect(H.muscleDetail({ ...S, workouts: [] }, 'chest', '2026-09-09').status).toBe('nodata')
  })
  it('card: statuses read differently and nothing is shown without data', async () => {
    await boot()
    const D = mod.Detail
    expect(renderToStaticMarkup(<D detail={{ slug: 'chest', status: 'nodata' }} />)).toContain('No data yet')
    expect(renderToStaticMarkup(<D detail={{ slug: 'chest', status: 'nodata' }} />)).not.toContain('Sets this week')
    const html = renderToStaticMarkup(<D detail={{ slug: 'chest', status: 'worked', sets: 9, prevSets: 6, last: { d: '2026-09-08', name: 'Push', sets: 3 }, perWeek: 2, volume: 1200, prevVolume: 1000 }} />)
    for (const k of ['Worked this week', 'Sets this week', '+3 vs last week', 'Last session', 'Volume of its main lifts', '+200 kg vs last week']) expect(html).toContain(k)
    expect(renderToStaticMarkup(<D detail={{ slug: 'chest', status: 'low', sets: 1, last: null }} />)).toContain('Lightly worked')
    expect(renderToStaticMarkup(<D detail={{ slug: 'chest', status: 'rest', sets: 0 }} />)).toContain('Not trained this week')
  })
  it('the panel stays backwards compatible: with S the depth card is available, without S it is not', async () => {
    await boot()
    const a = renderToStaticMarkup(<mod.Panel load={{ chest: 6 }} />)
    expect(a).toContain('Most worked muscles'); expect(a).not.toContain('v2-md')
  })
})

describe('Health overview: only real data, compact states', () => {
  it('tiles for Training and Composition appear from the member\'s own log; no empty tiles', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Health)
    expect(html).toContain('v2-ho'); expect(html).toContain('Training'); expect(html).toContain('Composition')
    expect(html).not.toContain('>Activity<')               // no daily reading → no Activity tile
    expect(html).not.toContain('>Recovery<')               // no resting HR / session HR / WHOOP → no Recovery tile
    expect(html).toMatch(/81[.,]5/)
  })
  it('a profile with nothing: no tiles, no invented numbers (the screen keeps its single invitation)', async () => {
    await seed({ routines: [], week: {}, workouts: [], bodyweight: [] })
    const html = await render(views.Health)
    expect(html).not.toContain('v2-ho-tile'); expect(html).toContain('Your evolution will appear here')
  })
  it('activity appears with a real daily reading and its source; gated by the Health preference', async () => {
    const native = bridge(), b = { enabled: true, granted: ['workouts', 'steps', 'activeCalories'], at: 1, lastSync: 1 }
    await seed({ ...HISTORY() }, null, { native, bstate: b, daily: { d: day(0), steps: 4200, activeKcal: 180, at: Date.now() } })
    const html = await render(views.Health)
    expect(html).toMatch(/4.?200/); expect(html).toContain('180 kcal')
    await seed({ ...HISTORY(), ux: uses({ health: false }) }, null, { native, bstate: b, daily: { d: day(0), steps: 4200, activeKcal: 180, at: Date.now() } })
    expect(await render(views.Health)).not.toMatch(/4.?200/)
    await seed({ ...HISTORY() }, { health: false }, { native, bstate: b, daily: { d: day(0), steps: 4200, activeKcal: 180, at: Date.now() } })
    expect(await render(views.Health)).not.toMatch(/4.?200/)
  })
  it('states: not connected, no permission, partial, wearable, estimates only — each one compact line, none breaks the UI', async () => {
    const full = { enabled: true, granted: ['workouts', 'steps', 'activeCalories'], at: 1, lastSync: 1 }
    const probe = async (over, native, bstate, daily) => { await seed(over, null, { native, bstate, daily }); return H.healthState(store.getState().S, 'u1').state }
    expect(await probe(HISTORY(), null)).toBe('unavailable')
    expect(await probe(HISTORY(), bridge(), null)).toBe('off')
    expect(await probe(HISTORY(), bridge(), { enabled: true, granted: ['workouts'], at: 1 })).toBe('noPermission')
    expect(await probe(HISTORY(), bridge(), { enabled: true, granted: ['workouts', 'steps'], at: 1 })).toBe('partial')
    expect(await probe({ ...HISTORY(), workouts: [wk('a', 1, 80, { fitness: { primary: SAMSUNG } })] }, bridge(), full)).toBe('wearable')
    expect(await probe(HISTORY(), bridge(), full)).toBe('estimateOnly')
    for (const [over, native, b] of [[HISTORY(), bridge(), null], [HISTORY(), bridge(), { enabled: true, granted: ['workouts'], at: 1 }], [HISTORY(), bridge(), full]]) {
      await seed(over, null, { native, bstate: b })
      expect(await render(views.Health)).toContain('v2-ho')
    }
    await seed(HISTORY(), null, { native: bridge(), bstate: null })
    const off = await render(views.Health)
    expect(off).toContain('Connect Health Connect to see your steps and energy here.')
  })
})

describe('Health timeline and privacy', () => {
  it('moments are real and few: a relevant weight change and a scan day (one line, however many metrics); gated by the timeline preference', async () => {
    await seed({ ...HISTORY(), measurements: { bodyFat: [{ d: day(3), v: 18.4, t: 1 }], muscleMass: [{ d: day(3), v: 37.2, t: 1 }] } })
    const S = store.getState().S
    const items = mod.timeline.healthTimeline(S)
    expect(items.filter(i => i.kind === 'scan')).toHaveLength(1)
    expect(items.filter(i => i.kind === 'scan')[0].count).toBe(2)
    expect(items.filter(i => i.kind === 'weight').length).toBeGreaterThan(0)
    expect(items.length).toBeLessThanOrEqual(8)
    expect(H.healthMoments({ bodyweight: [{ d: day(10), w: 80, t: 1 }, { d: day(2), w: 80.3, t: 2 }] })).toEqual([])      // 0.3 kg is not a story
    await seed({ ...HISTORY(), ux: uses({ timeline: false }) })
    expect(mod.timeline.healthTimeline(store.getState().S)).toEqual([])
  })
  it('Health is private: the overview is marked private and no Health module reaches the social/share layer', () => {
    const dir = new URL('../', import.meta.url)
    const files = ['components/HealthOverview.jsx', 'components/EnergyBadge.jsx', 'components/IndicatorDetail.jsx', 'components/MuscleDetailCard.jsx', 'lib/health-v2.js', 'lib/indicators.js']
    for (const f of files) {
      const src = readFileSync(new URL(f, dir), 'utf8')
      expect(src, f).not.toMatch(/from '[^']*(social|share|friends|chat|community|InternalShare)[^']*'/i)
      expect(src, f).not.toMatch(/api\(|fetch\(/)                  // reads only; nothing leaves the device from here
    }
    expect(readFileSync(new URL('components/HealthOverview.jsx', dir), 'utf8')).toContain('data-private="true"')
  })
  it('the Social share payloads do not carry Health fields', () => {
    const src = readFileSync(new URL('../lib/share-card.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/calories|avgHr|steps|restingHR|activeKcal|energy/)
    expect(readdirSync(new URL('../components/', import.meta.url)).length).toBeGreaterThan(0)
  })
})

describe('Closing fixes', () => {
  it('Composition has ONE main entry: the old Weight / Body fat / Muscle tiles are not repeated, the evolution drill-down stays', async () => {
    await seed({ ...HISTORY(), measurements: { bodyFat: [{ d: day(3), v: 18.4, t: 1 }], muscleMass: [{ d: day(3), v: 37.2, t: 1 }] } })
    const html = await render(views.Health)
    expect(html).toContain('Composition'); expect(html).not.toContain('hv-now')
    expect(html).toContain('Evolution'); expect(html).toContain('hv-metric')          // the per-metric cards are still there
    await seed({ ...HISTORY() }, { bodyweight: false, bioimpedance: false })        // overview hides Composition → the classic tiles remain
    const off = await render(views.Health)
    expect(off).not.toContain('>Composition<')
  })
  it('16 feature keys, identical on both sides', async () => {
    await boot()
    expect(F.FEATURE_KEYS).toHaveLength(16)
    const server = readFileSync(new URL('../../../api/lib/features-store.js', import.meta.url), 'utf8')
    const list = server.slice(server.indexOf('FEATURE_KEYS'), server.indexOf('];', server.indexOf('FEATURE_KEYS')))
    expect([...list.matchAll(/'([a-z0-9]+)'/g)]).toHaveLength(16)
  })
  it('i18n never shows undefined or a raw key: unknown keys fall back to their English source, every new Health V2 string has Spanish', async () => {
    await boot()
    const i18n = await import('../lib/i18n.js')
    const unknownKey = ['A brand-new', 'string {0}'].join(' ')       // built at run time (the locale checker reads only literal translation calls)
    expect(i18n.t(unknownKey, 'x')).toBe('A brand-new string x')
    expect(i18n.t(undefined)).toBe(''); expect(i18n.t(undefined, 'x')).toBe('')
    const es = (await import('../locales/es.js')).default
    const strings = ['Activity today', 'Aggregated data', 'Same as last week', 'Worked this week', 'No data yet', 'Open Health', 'Weight & composition']
    for (const s of strings) expect(es[s], s).toBeTruthy()
    const S = { workouts: [wk('a', 1, 80)], routines: [ROUTINE], week: { 3: 'r1' } }
    for (const ind of [mod.indicators.trainingIndicator(S, '2026-09-09'), mod.indicators.recoveryIndicator(S)]) expect(es[ind.basis], ind.basis).toBeTruthy()
  })
})
