import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Experience V2 (2.0.1) over the real store, same harness as adaptive.test.jsx: the Home hero with and without a
 * workout, the two optional modules (Activity indicators, Progress timeline) under admin → member → data, the tab bar's
 * gates, the post-workout summary (it must render from any saved workout and never throw) and reduced motion. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, views, F, mod
const BENCH = '0025'
const wk = (id, d, w, extra = {}) => ({ id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T10:50:00'), name: 'Push', routineId: 'r1', prs: [], vol: w * 5,
  entries: [{ id: BENCH, target: { sets: 1, reps: 5, mode: 'reps' }, sets: [{ w, r: 5, done: true }] }], ...extra })
const ROUTINE = { id: 'r1', name: 'Push', emoji: '💪', prog: 'off', ex: [{ id: BENCH, sets: 3, reps: 5, mode: 'reps' }, { id: BENCH, sets: 3, reps: 5, mode: 'reps' }] }
// 2026-09-09 is a Wednesday (getDay() === 3): Push every Wednesday.
const PLAN = () => ({ routines: [ROUTINE], week: { 3: 'r1' } })
const HISTORY = () => ({ ...PLAN(), workouts: [wk('b', '2026-08-26', 77.5), wk('a', '2026-09-02', 80)] })

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
  mod = {
    indicators: await import('../lib/indicators.js'),
    timeline: await import('../lib/timeline.js'),
    Post: await import('../components/PostWorkoutSummary.jsx'),
    Ach: (await import('../components/AchievementCard.jsx')).default,
    Panel: (await import('../components/BodyMapPanel.jsx')).default,
    V2: await import('../components/v2.jsx'),
    motion: await import('../lib/motion.js'),
  }
  views = {
    Home: (await import('./Home.jsx')).default,
    Stats: (await import('./Stats.jsx')).default,
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
const render = async View => { await boot(); return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>) }
const uses = u => ({ v: 1, at: 1, uses: u })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Home hero', () => {
  it('with a workout planned today: its name, exercise count, typical duration, one Start action and the week', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Home)
    expect(html).toContain('v2-hero')
    expect(html).toContain('Hi Ana Socia')
    expect(html).toContain('Push')
    expect(html).toContain('2 exercises')
    expect(html).toContain('50 min')                  // average of this routine's own sessions, never an invented estimate
    expect(html).toContain('Start workout')
    expect(html).toContain('Your week')
    expect(html).not.toContain('Plan a workout')
  })
  it('a workout in progress turns the action into Resume', async () => {
    await seed({ ...HISTORY(), active: { id: 'x', name: 'Push', entries: [], routineId: 'r1', start: 1, d: '2026-09-09' } })
    const html = await render(views.Home)
    expect(html).toContain('Resume workout')
    expect(html).not.toContain('Start workout')
  })
  it('rest day (routines exist, none today): a contextual action, no empty workout card', async () => {
    await seed({ ...HISTORY(), week: { 1: 'r1' } })
    const html = await render(views.Home)
    expect(html).toContain('Rest day')
    expect(html).toContain('Plan a workout')
    expect(html).not.toContain('Start workout')
    expect(html).not.toContain('exercises</span>')
  })
  it('no routines at all: just the greeting; the welcome card keeps the set-up paths', async () => {
    await seed({ routines: [], week: {}, workouts: [] })
    const html = await render(views.Home)
    expect(html).toContain('Hi Ana Socia')
    expect(html).not.toContain('v2-hero-today')
    expect(html).toContain('Load starter plan (PPL)')
  })
  it('keeps the news slot, the week strip and Train with 2J', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Home)
    expect(html).toContain('class="week"')
    expect(html).toContain('Train with 2J')
  })
})

describe('Activity indicators: admin availability → member preference → data presence', () => {
  it('on, with data: Training (this week) and Recovery', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Home)
    expect(html).toContain('v2-hero-rings')
    expect(html).toContain('Training'); expect(html).toContain('Recovery')
  })
  it('the member can switch them off', async () => {
    await seed({ ...HISTORY(), ux: uses({ activity: false }) })
    expect(await render(views.Home)).not.toContain('v2-hero-rings')
  })
  it('admin OFF prevails over the member being ON, and the member cannot re-enable it', async () => {
    await seed({ ...HISTORY(), ux: uses({ activity: true }) }, { activity: false })
    expect(await render(views.Home)).not.toContain('v2-hero-rings')
    expect(F.uxOn({ ux: uses({ activity: true }) }, 'activity')).toBe(false)
  })
  it('no data, no indicator: nothing to recover from and nothing planned → no rings', async () => {
    await seed({ routines: [ROUTINE], week: {}, workouts: [] })
    expect(await render(views.Home)).not.toContain('v2-hero-rings')
  })
  it('Recovery follows its own switch inside the rings; the activity ring needs health data (none here)', async () => {
    await seed({ ...HISTORY(), ux: uses({ recovery: false }) })
    const html = await render(views.Home)
    expect(html).toContain('Training'); expect(html).not.toContain('>Recovery<'); expect(html).not.toContain('>Activity<')
  })
  it('lib: indicators are derived only from real data', async () => {
    await seed({ ...HISTORY() })
    const S = store.getState().S
    const t = mod.indicators.trainingIndicator(S, '2026-09-09')
    expect(t.planned).toBe(1); expect(t.done).toBe(0)
    expect(mod.indicators.activityIndicator('u1')).toBeNull()
    expect(mod.indicators.homeIndicators(S, 'u1').map(i => i.key)).toEqual(['training', 'recovery'])
  })
})

describe('Progress timeline: same three gates', () => {
  it('shows the latest sessions newest first when on and there is history', async () => {
    await seed({ ...HISTORY() })
    const html = await render(views.Stats)
    expect(html).toContain('Progress timeline')
    expect(html.indexOf('v2-tl-item')).toBeGreaterThan(-1)
  })
  it('off for the member, off for the admin, empty without history', async () => {
    await seed({ ...HISTORY(), ux: uses({ timeline: false }) })
    expect(await render(views.Stats)).not.toContain('Progress timeline')
    await seed({ ...HISTORY(), ux: uses({ timeline: true }) }, { timeline: false })
    expect(await render(views.Stats)).not.toContain('Progress timeline')
    await seed({ ...PLAN(), workouts: [] })
    expect(await render(views.Stats)).not.toContain('Progress timeline')
  })
  it('lib: a record shows up on its session', async () => {
    await seed({ ...PLAN(), workouts: [wk('a', '2026-09-02', 80, { prs: [BENCH] }), wk('b', '2026-09-09', 85, { prs: [BENCH] })] })
    const items = mod.timeline.progressTimeline(store.getState().S)
    expect(items.map(i => i.id)).toEqual(['b', 'a'])
    expect(items[0].events.some(e => e.type === 'pr')).toBe(true)
  })
})

describe('Settings → My experience offers exactly the two new preferences', () => {
  it('both are listed, and the admin switching one off removes it from the configurator', async () => {
    await seed({ ...HISTORY() })
    let html = await render(views.Setup)
    expect(html).toContain('Activity indicators'); expect(html).toContain('Progress timeline')
    await seed({ ...HISTORY() }, { timeline: false })
    html = await render(views.Setup)
    expect(html).toContain('Activity indicators'); expect(html).not.toContain('Progress timeline')
  })
  it('stored in the existing S.ux (no second system); never-personalised members keep both on', async () => {
    expect(F.USER_PREFS).toEqual(expect.arrayContaining(['activity', 'timeline']))
    expect(F.makeUx({ activity: false }).uses).toMatchObject({ activity: false, timeline: true })
    expect(F.uxOn({ ux: null }, 'activity')).toBe(true)
    expect(F.PRESETS.simple).toMatchObject({ activity: false, timeline: false })
  })
})

describe('Bottom navigation V2', () => {
  it('marks the current destination, keeps the same tabs and respects the Social gate', async () => {
    await seed({ ...HISTORY() })
    let html = await render(views.TabBar)
    expect(html).toContain('aria-current="page"')
    expect(html).toContain('tb-ic')
    expect(html).toContain('Social')
    await seed({ ...HISTORY(), ux: uses({ social: false }) })
    expect(await render(views.TabBar)).not.toContain('Social')
    await seed({ ...HISTORY() }, { social: false })
    expect(await render(views.TabBar)).not.toContain('Social')
  })
})

describe('Post-workout summary', () => {
  const unit = 'kg'
  it('renders from any saved workout and never throws, even with a bare record', async () => {
    await seed({ ...HISTORY() })
    const S = store.getState().S
    const render1 = w => renderToStaticMarkup(<mod.Post.default w={w} S={S} events={[]} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} />)
    expect(render1(S.workouts[1])).toContain('Workout complete!')
    expect(() => render1({ id: 'z', d: '2026-09-09', name: 'Bare', entries: [], vol: 0, start: 1, end: 1 })).not.toThrow()
    expect(() => render1({ id: 'q', d: '2026-09-09', name: 'No fields' })).not.toThrow()
  })
  it('compares with the previous session of the same routine and shows duration / sets / volume', async () => {
    await seed({ ...HISTORY() })
    const S = store.getState().S
    const w = S.workouts[1]                                     // 2026-09-02, after 2026-08-26
    expect(mod.Post.previousSession(S, w).id).toBe('b')
    expect(mod.Post.volumeDelta(w, S.workouts[0])).toBe(3)         // 400 vs 387.5 → +3 %
    const html = renderToStaticMarkup(<mod.Post.default w={w} S={S} events={[]} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} />)
    for (const k of ['Duration', 'Sets', 'Volume', '+3% vs last session', 'View progress', 'Share workout', 'Nice!']) expect(html).toContain(k)
  })
  it('celebrates only a record or a relevant achievement: gold card for a PR, none otherwise', async () => {
    await seed({ ...PLAN(), workouts: [wk('a', '2026-09-02', 80, { prs: [BENCH] }), wk('b', '2026-09-09', 85, { prs: [BENCH] })] })
    const S = store.getState().S
    const events = (await import('../lib/mi2j.js')).postWorkoutEvents(S, 'b')
    const pr = renderToStaticMarkup(<mod.Post.default w={S.workouts[1]} S={S} events={events} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} />)
    expect(pr).toContain('v2-ach gold'); expect(pr).toContain('v2-glow'); expect(pr).toContain('+5 kg')
    const plain = renderToStaticMarkup(<mod.Post.default w={S.workouts[1]} S={S} events={[]} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} />)
    expect(plain).not.toContain('v2-ach'); expect(plain).not.toContain('v2-glow')
  })
  it('the finish flow itself is untouched: finishWorkout is still the sheets.jsx export', async () => {
    await seed({ ...HISTORY() })
    expect(typeof (await import('../sheets.jsx')).finishWorkout).toBe('function')
  })
})

describe('Reusable pieces', () => {
  it('AchievementCard: branding, value, delta and date; gold only for records and achievements', async () => {
    await boot()
    const html = renderToStaticMarkup(<mod.Ach kind="pr" title="Bench press" value="85 kg × 5" delta="+5 kg" date="2026-09-09" />)
    for (const k of ['2J FITNESS', 'Bench press', '85 kg × 5', '+5 kg', 'v2-ach gold', 'New record']) expect(html).toContain(k)
    expect(renderToStaticMarkup(<mod.Ach kind="badge" title="First week" />)).toContain('v2-ach emerald')
  })
  it('BodyMapPanel: nothing without data; with data the most-worked ranking from the same load', async () => {
    await boot()
    expect(renderToStaticMarkup(<mod.Panel load={{}} />)).toBe('')
    const html = renderToStaticMarkup(<mod.Panel load={{ chest: 12, triceps: 6, abs: 2 }} body="male" />)
    expect(html).toContain('Most worked muscles'); expect(html).toContain('12 sets')
    const low = html.toLowerCase()
    expect(low.indexOf('chest')).toBeGreaterThan(-1)
    expect(low.indexOf('chest')).toBeLessThan(low.indexOf('triceps'))
  })
  it('ProgressBar / Ring clamp to 0–100 %', async () => {
    await boot()
    expect(renderToStaticMarkup(<mod.V2.ProgressBar value={3} />)).toContain('aria-valuenow="100"')
    expect(renderToStaticMarkup(<mod.V2.ProgressBar value={-1} />)).toContain('aria-valuenow="0"')
    expect(renderToStaticMarkup(<mod.V2.ProgressBar value={NaN} />)).toContain('aria-valuenow="0"')
  })
})

describe('Reduced motion', () => {
  it('the V2 layer switches its own animations off under prefers-reduced-motion', () => {
    for (const f of ['../v2.css', '../v2-screens.css']) {
      const css = readFileSync(new URL(f, import.meta.url), 'utf8')
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    }
    expect(readFileSync(new URL('../v2.css', import.meta.url), 'utf8')).toMatch(/prefers-reduced-motion: reduce\)\s*\{[^}]*\.v2-rise[^}]*animation: none/)
  })
  it('counters show the final number immediately when nothing can animate', async () => {
    await boot()
    expect(renderToStaticMarkup(<mod.V2.CountUp value={42} />)).toContain('42')
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) })
    expect(mod.motion.reducedMotion()).toBe(true)
  })
})
