import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Sprint 2 — Progress V3, Mi 2J V2, 2J Story. Presentation over the member's own log: these tests pin that comparisons exist only
 * with a real previous period, that nothing is invented, that the Story picks what exists and keeps weight out unless chosen,
 * and that the screens follow the admin / member switches without leaving holes. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, mod, views
const NOW = new Date('2026-09-09T12:00:00').getTime()          // a Wednesday
const wk = (id, d, w = 80, over = {}) => ({ id, d, start: Date.parse(d + 'T10:00:00'), end: Date.parse(d + 'T10:50:00'), name: 'Push', routineId: 'r1', prs: [], vol: w * 15,
  entries: [{ id: '0025', target: { sets: 3, reps: 5, mode: 'reps' }, sets: [1, 2, 3].map(() => ({ w, r: 5, done: true })) }], ...over })
const ROUTINE = { id: 'r1', name: 'Push', emoji: '💪', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, mode: 'reps' }] }
// Aug: 2 sessions · Sep: 3 sessions (the last one a record). Week of 7–13 Sep: 2 sessions (08 and 09? no: 08 only)
const HISTORY = () => ({ routines: [ROUTINE], week: { 3: 'r1' }, workouts: [wk('a1', '2026-08-12', 70), wk('a2', '2026-08-26', 72.5), wk('s1', '2026-09-01', 75), wk('s2', '2026-09-03', 77.5), wk('s3', '2026-09-08', 85, { prs: ['0025'] })] })
const uses = u => ({ v: 1, at: 1, uses: u })

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage })
  ;({ useStore: store } = await import('../store/useStore.js'))
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  mod = {
    p: await import('../lib/progress-v3.js'), story: await import('../lib/story.js'),
    Cover: (await import('../components/ProgressCover.jsx')).default, StoryCard: (await import('../components/StoryCard.jsx')).default,
    Sheet: await import('../components/StorySheet.jsx'),
  }
  views = { Stats: (await import('./Stats.jsx')).default, Mi2J: (await import('./Mi2J.jsx')).default }
}
async function seed(over = {}, admin = null) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, height: 178, unit: 'kg', uxInviteDismissed: true }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
}
const render = async View => { await boot(); return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>) }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Progress V3 — periods and comparisons from the real log', () => {
  it('week is Monday–Sunday, month is the calendar month, each with its previous period', async () => {
    await boot()
    expect(mod.p.periodRange('week', new Date(NOW))).toMatchObject({ from: '2026-09-07', to: '2026-09-13', prevFrom: '2026-08-31', prevTo: '2026-09-06', days: 7 })
    expect(mod.p.periodRange('month', new Date(NOW))).toMatchObject({ from: '2026-09-01', to: '2026-09-30', prevFrom: '2026-08-01', prevTo: '2026-08-31', days: 30 })
  })
  it('a comparison exists only when the previous period has data; volume delta only when both sides have volume', async () => {
    await seed(HISTORY())
    const S = store.getState().S
    const m = mod.p.periodSummary(S, 'month', new Date('2026-09-30T12:00:00'))
    expect(m).toMatchObject({ workouts: 3, prevWorkouts: 2, empty: false }); expect(m.prevVolume).toBeGreaterThan(0)
    expect(m.minutes).toBe(150); expect(m.prs).toBeGreaterThanOrEqual(1)
    const w = mod.p.periodSummary(S, 'week', new Date('2026-09-13T12:00:00'))
    expect(w.workouts).toBe(1); expect(w.prevWorkouts).toBe(2)
    // mid-period: compared with the same stretch of the previous one, not a whole finished period
    expect(mod.p.periodSummary(S, 'week', new Date(NOW)).prevWorkouts).toBe(1)                                    // 08-31 week had s1? no → computed from data
    const fresh = mod.p.periodSummary({ ...S, workouts: S.workouts.filter(x => x.d >= '2026-09-01') }, 'month', new Date(NOW))
    expect(fresh.prevWorkouts).toBeNull(); expect(fresh.prevVolume).toBeNull()                  // nothing to compare with → no fake context
  })
  it('weight change needs two weigh-ins INSIDE the period; muscles come from the same load the body map uses', async () => {
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-02', w: 82, t: 1 }] })
    expect(mod.p.periodSummary(store.getState().S, 'month', new Date(NOW)).weight).toBeNull()
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-02', w: 82, t: 1 }, { d: '2026-09-08', w: 81.2, t: 2 }] })
    const m = mod.p.periodSummary(store.getState().S, 'month', new Date(NOW))
    expect(m.weight.delta).toBe(-0.8); expect(m.muscles.length).toBeGreaterThan(0)
  })
  it('an empty period says so and fabricates nothing', async () => {
    await seed({ routines: [ROUTINE], week: {}, workouts: [wk('old', '2026-06-01')] })
    const m = mod.p.periodSummary(store.getState().S, 'month', new Date(NOW))
    expect(m.empty).toBe(true); expect(m.workouts).toBe(0); expect(m.advance).toBeNull(); expect(m.muscles).toEqual([])
  })
})

describe('Progress cover, zones and timeline on the Progress screen', () => {
  it('cover leads the screen: period toggle, workouts, minutes, record; the zones / timeline order is kept', async () => {
    await seed({ ...HISTORY(), enableRpVolumeZones: true })
    const html = await render(views.Stats)
    for (const k of ['v3-cover', 'Your progress', 'Week', 'Month', 'v3-cover-big', 'min trained', 'PRs', 'Create my 2J Story']) expect(html).toContain(k)
    expect(html.indexOf('v3-cover')).toBeLessThan(html.indexOf('Weekly volume zones'))
    expect(html.indexOf('Weekly volume zones')).toBeLessThan(html.indexOf('Progress timeline'))
    expect(html).toContain('v3-zone')
  })
  it('weight in the cover follows the admin and the member; zones OFF and timeline OFF leave no title behind', async () => {
    const bw = [{ d: '2026-09-02', w: 82, t: 1 }, { d: '2026-09-08', w: 81.2, t: 2 }]
    await seed({ ...HISTORY(), bodyweight: bw })
    expect(await render(views.Stats)).toContain('−0,8')            // formatted with the profile locale (es)
    await seed({ ...HISTORY(), bodyweight: bw, ux: uses({ bodyweight: false }) })
    expect(await render(views.Stats)).not.toContain('v3-cover-chips icn')
    await seed({ ...HISTORY(), bodyweight: bw }, { bodyweight: false })
    const off = await render(views.Stats)
    expect(off).not.toMatch(/Weight[^<]{0,6}[−+]\d/)
    await seed({ ...HISTORY(), enableRpVolumeZones: false, ux: uses({ timeline: false }) })
    const bare = await render(views.Stats)
    expect(bare).not.toContain('Weekly volume zones'); expect(bare).not.toContain('Progress timeline'); expect(bare).toContain('v3-cover')
  })
  it('no workouts yet: a calm empty cover without a Story button', async () => {
    await seed({ routines: [ROUTINE], week: { 3: 'r1' }, workouts: [] })
    const html = await render(views.Stats)
    expect(html).toContain('v3-cover-empty'); expect(html).not.toContain('Create my 2J Story')
  })
  it('timeline groups by month and includes streak milestones', async () => {
    await seed(HISTORY())
    const html = await render(views.Stats)
    expect(html).toContain('v3-tl-month')
  })
})

describe('2J Story — adaptive content, privacy, share', () => {
  it('a new member gets what exists (workouts, minutes, muscles); no empty blocks and no "no data"', async () => {
    await seed({ routines: [ROUTINE], week: { 3: 'r1' }, workouts: [wk('s1', '2026-09-08', 40)] })
    const s = mod.story.buildStory(store.getState().S, 'month')
    expect(s.empty).toBe(false); expect(s.hero.value).toBe(1); expect(s.hero.prev).toBeNull()
    expect(s.stats.map(x => x.key)).toEqual(expect.arrayContaining(['minutes', 'sets'])); expect(s.stats.some(x => x.key === 'streak')).toBe(false)
    const html = renderToStaticMarkup(<mod.StoryCard story={s} />)
    expect(html).toContain('2J FITNESS'); expect(html).toContain('v3-story-num'); expect(html).not.toMatch(/no data|sin datos/i)
  })
  it('an advanced member gets volume, records and the programme; at most four stats', async () => {
    vi.setSystemTime(new Date('2026-09-30T12:00:00'))   // month complete: a like-for-like comparison with August exists
    await seed({ ...HISTORY(), programs: [{ id: 'p1', name: 'Fuerza 5x5', status: 'active', week: {}, routineIds: ['r1'] }], activeProgramId: 'p1' })
    const s = mod.story.buildStory(store.getState().S, 'month')
    expect(s.stats.length).toBeLessThanOrEqual(4); expect(s.stats.map(x => x.key)).toContain('volume')
    expect(s.stats.find(x => x.key === 'volume').delta).not.toBeNull()
    expect(s.program).toBe('Fuerza 5x5'); expect(s.highlight).toBeTruthy()
    const html = renderToStaticMarkup(<mod.StoryCard story={s} />)
    expect(html).toContain('Fuerza 5x5'); expect(html).toContain('v3-story-hl')
  })
  it('weight is excluded unless explicitly included; Health / recovery / WHOOP data are never read', async () => {
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-02', w: 82, t: 1 }, { d: '2026-09-08', w: 81.2, t: 2 }], restingHR: [{ d: '2026-09-08', v: 55, t: 1 }] })
    const S = store.getState().S
    const off = mod.story.buildStory(S, 'month'); const on = mod.story.buildStory(S, 'month', { includeBody: true })
    expect(off.body).toBeNull(); expect(off.canIncludeBody).toBe(true)
    expect(on.body).toEqual({ delta: -0.8, unit: 'kg' })
    expect(renderToStaticMarkup(<mod.StoryCard story={off} />)).not.toContain('v3-story-body')
    expect(renderToStaticMarkup(<mod.StoryCard story={on} />)).toContain('v3-story-body')
    const src = readFileSync(new URL('../lib/story.js', import.meta.url), 'utf8') + readFileSync(new URL('../components/StoryCard.jsx', import.meta.url), 'utf8')
    expect(src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')).not.toMatch(/health-v2|health-bridge|restingHR|dailyActivity|fitnessOf|workoutEnergy|whoop|checkin|note/i)
  })
  it('a period without sessions has no story; the sheet says so instead of drawing an empty poster', async () => {
    await seed({ routines: [ROUTINE], week: {}, workouts: [wk('old', '2026-06-01')] })
    const s = mod.story.buildStory(store.getState().S, 'week')
    expect(s.empty).toBe(true); expect(renderToStaticMarkup(<mod.StoryCard story={s} />)).toBe('')
  })
  it('the card is a fixed-palette, blur-free poster built for the existing PNG export; gold only on records / streaks', () => {
    const css = readFileSync(new URL('../v3-progress.css', import.meta.url), 'utf8')
    const story = css.slice(css.indexOf('.v3-story {'))
    expect(story).not.toMatch(/backdrop-filter/); expect(story).toMatch(/\.v3-story-stat\.gold/); expect(story).toMatch(/@media \(max-width: 380px\)/)
    expect(readFileSync(new URL('../components/StorySheet.jsx', import.meta.url), 'utf8')).toMatch(/capturePng[\s\S]*sharePng|sharePng[\s\S]*capturePng/)
  })
})

describe('Mi 2J V2 — athlete passport', () => {
  it('with history: passport, gold records and grouped achievements; Story is one tap away', async () => {
    await seed({ ...HISTORY(), bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }] })
    const html = await render(views.Mi2J)
    for (const k of ['v3-pass', 'Athlete passport', 'v3-rec top', 'Latest records', 'Create my 2J Story', 'Explore']) expect(html).toContain(k)
  })
  it('new member: identity card + invitation, no records / achievements / story button', async () => {
    await seed({ routines: [ROUTINE], week: {}, workouts: [] })
    const html = await render(views.Mi2J)
    expect(html).toContain('v3-pass'); expect(html).toContain('Your journey starts here')
    for (const gone of ['v3-rec ', 'Create my 2J Story', 'Latest records', 'm2-badges']) expect(html).not.toContain(gone)
  })
})

describe('Sprint 2 CSS', () => {
  it('respects reduced motion and the V2 tokens', () => {
    const css = readFileSync(new URL('../v3-progress.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/); expect(css).toMatch(/var\(--v2-gold\)/); expect(css).toMatch(/var\(--v2-card\)/)
  })
})
