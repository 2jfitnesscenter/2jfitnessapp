import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Sprint 1 — Training V3, Post-workout V3, Home Alive. Presentation over the existing engines: these tests pin that the new
 * pieces read real session / log data, follow the Simple / Detailed and image preferences, never leave empty boxes, and that
 * Home leads with the right thing for each moment. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, mod, views, UI
const NOW = new Date('2026-09-09T12:00:00').getTime()          // a Wednesday
const dayISO = n => { const d = new Date(NOW); d.setDate(d.getDate() - n); return d.toISOString().slice(0, 10) }
const mkEntry = (id, w, done = 0, sg) => ({ id, ...(sg ? { sg } : {}), target: { sets: 3, reps: 5, mode: 'reps', rest: 90 }, sets: [0, 1, 2].map(i => ({ w, r: 5, done: i < done })) })
const finished = (id, n, w, endAgoMs, pr = false) => ({ id, d: dayISO(n), start: NOW - endAgoMs - 3000000, end: NOW - endAgoMs, name: 'Push', routineId: 'r1', prs: pr ? ['0025'] : [], vol: w * 15,
  entries: [{ id: '0025', target: { sets: 3, reps: 5, mode: 'reps' }, sets: [1, 2, 3].map(() => ({ w, r: 5, done: true })) }] })
const ROUTINE = { id: 'r1', name: 'Push', emoji: '💪', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, mode: 'reps' }, { id: '0310', sets: 3, reps: 8, mode: 'reps' }] }
const ROUTINE_B = { id: 'r2', name: 'Pull', emoji: '💪', prog: 'off', ex: [{ id: '0025', sets: 3, reps: 5, mode: 'reps' }] }
const ACTIVE = () => ({ id: 'act', name: 'Push', routineId: 'r1', start: NOW - 25 * 60000, d: dayISO(0), bw: 80, cur: 0, lastActivityAt: NOW,
  entries: [mkEntry('0025', 85, 2), mkEntry('0310', 60, 0, 'g'), mkEntry('0042', 30, 0, 'g'), mkEntry('0057', 20, 0)] })

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
  ;({ useUI: UI } = await import('../store/useUI.js'))
  ;(await import('../components/ui.jsx')).bindUI(UI)
  mod = {
    v3: await import('../lib/training-v3.js'), alive: await import('../lib/home-alive.js'),
    Prog: (await import('../components/WorkoutProgress.jsx')).default, Next: (await import('../components/NextUp.jsx')).default,
    Rest: (await import('../components/RestTimer.jsx')).default, Post: (await import('../components/PostWorkoutSummary.jsx')).default,
    supersetUnits: (await import('../lib/history.js')).supersetUnits,
  }
  views = { Home: (await import('./Home.jsx')).default, Workout: (await import('./Workout.jsx')).default }
}
async function seed(over = {}) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, height: 178, unit: 'kg', uxInviteDismissed: true }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  await boot()
}
const render = async (View) => { await boot(); return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>) }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Training V3 — session derivations', () => {
  it('a superset is ONE exercise unit; progress counts units and sets from the real session', async () => {
    await boot()
    const A = ACTIVE(), units = mod.supersetUnits(A.entries)
    expect(units).toEqual([[0], [1, 2], [3]])
    const up = mod.v3.unitsProgress(A.entries, units)
    expect(up.map(u => u.superset)).toEqual([false, true, false])
    expect(up[0]).toMatchObject({ setsDone: 2, setsTotal: 3, done: false })
    expect(up[1].setsTotal).toBe(6)
  })
  it('next up: the following unit (all its exercises), and nothing after the last one', async () => {
    await boot()
    const A = ACTIVE(), units = mod.supersetUnits(A.entries)
    const n = mod.v3.nextUnit(A.entries, units, 0)
    expect(n.superset).toBe(true); expect(n.sets).toBe(6); expect(n.names).toHaveLength(2)
    expect(mod.v3.nextUnit(A.entries, units, 2)).toBeNull()
  })
  it('rest anticipation: the next set still to do, with its exercise; null when the session is complete', async () => {
    await boot()
    const A = ACTIVE()
    expect(mod.v3.nextTodoSet(A)).toMatchObject({ entryIdx: 0, setIdx: 2, total: 3, sameExercise: true })
    A.entries.forEach(e => e.sets.forEach(s => { s.done = true }))
    expect(mod.v3.nextTodoSet(A)).toBeNull()
    expect(mod.v3.nextTodoSet(null)).toBeNull()
  })
  it('the effort picker offers quick values on the existing scales only', async () => {
    await boot()
    expect(mod.v3.EFFORT_QUICK.rpe).toEqual([6, 7, 8, 9, 10]); expect(mod.v3.EFFORT_QUICK.rir).toEqual([4, 3, 2, 1, 0])
  })
})

describe('Training V3 — components', () => {
  it('WorkoutProgress: ring, "Exercise x / y", sets done, one dot per unit with state; superset wording', async () => {
    await boot()
    const A = ACTIVE(), units = mod.supersetUnits(A.entries), go = vi.fn()
    const html = renderToStaticMarkup(<mod.Prog entries={A.entries} units={units} unitIdx={1} done={2} total={12} superset onGo={go} />)
    expect(html).toContain('Superset 2 / 3'); expect(html).toContain('v3-dots'); expect(html.match(/class="v3-dot[ "]/g)).toHaveLength(3)
    expect(html).toContain('aria-selected="true"'); expect(html).toContain('v2-ring')
    expect(renderToStaticMarkup(<mod.Prog entries={A.entries} units={units} unitIdx={0} done={0} total={12} onGo={go} />)).toContain('Exercise 1 / 3')
    const one = [mkEntry('0025', 80)]
    expect(renderToStaticMarkup(<mod.Prog entries={one} units={[[0]]} unitIdx={0} done={0} total={3} onGo={go} />)).not.toContain('v3-dots')   // a single exercise needs no stepper
  })
  it('NextUp: shows the next exercise; the mini preview only with images on; nothing on the last exercise', async () => {
    await boot()
    const A = ACTIVE(), units = mod.supersetUnits(A.entries), next = mod.v3.nextUnit(A.entries, units, 2 - 2 + 0)
    const single = mod.v3.nextUnit(A.entries, units, 1)
    expect(renderToStaticMarkup(<mod.Next next={single} images onGo={() => {}} />)).toContain('v3-next')
    expect(renderToStaticMarkup(<mod.Next next={single} images onGo={() => {}} />)).toContain('thumb')
    expect(renderToStaticMarkup(<mod.Next next={single} images={false} onGo={() => {}} />)).not.toContain('thumb')
    expect(renderToStaticMarkup(<mod.Next next={next} images onGo={() => {}} />)).not.toContain('thumb')        // a superset has no single preview
    expect(renderToStaticMarkup(<mod.Next next={null} images onGo={() => {}} />)).toBe('')
  })
  it('RestTimer: ring + clock + what comes next; unchanged controls (±15, pause, skip)', async () => {
    await seed({ active: ACTIVE() })
    const setTimer = timer => Object.assign(UI.getInitialState(), { timer, work: null })     // react-dom/server reads the store's INITIAL state
    setTimer({ left: 75, total: 90, exercise: 'Press de banca', paused: false })
    const html = renderToStaticMarkup(<mod.Rest />)
    for (const k of ['v3-rest-ring', '1:15', 'Rest', 'Next: set 3 of 3', '15s', 'Pause', 'Skip']) expect(html).toContain(k)
    setTimer({ left: 75, total: 90, exercise: 'Press de banca', paused: true })
    expect(renderToStaticMarkup(<mod.Rest />)).toContain('Paused')
    setTimer(null)
    expect(renderToStaticMarkup(<mod.Rest />)).toBe('')
  })
  it('the Workout screen leads with the session: progress first, GymProfile row below it; Simple and Detailed both get it', async () => {
    for (const view of ['simple', 'detailed']) {
      await seed({ active: ACTIVE(), workoutView: view, routines: [ROUTINE] })
      const html = await render(views.Workout)
      expect(html).toContain('v3-prog'); expect(html).toContain('v3-next'); expect(html).not.toContain('class="wprog"')
      expect(html.indexOf('v3-prog')).toBeLessThan(html.indexOf('Training place'))
      expect(html).toContain(view === 'simple' ? 'class="simple"' : 'workout-sets-card')
    }
  })
  it('images off: the screen recomposes without a picture box or next-up thumbnail', async () => {
    await seed({ active: ACTIVE(), workoutView: 'simple', showExerciseImages: false, routines: [ROUTINE] })
    const html = await render(views.Workout)
    expect(html).not.toContain('exmedia'); expect(html).not.toContain('class="thumb'); expect(html).toContain('v3-next')
  })
})

describe('Home Alive', () => {
  const home = async over => { await seed(over); return render(views.Home) }
  it('before training: today\'s session leads; no live, recap or record blocks', async () => {
    const html = await home({ routines: [ROUTINE], week: { 3: 'r1' }, workouts: [finished('a', 9, 80, 9 * 864e5)] })
    expect(html).toContain('Start workout'); expect(html).not.toContain('v3h-live'); expect(html).not.toContain('v3h-recap'); expect(html).not.toContain('v3h-pr')
  })
  it('workout in progress: Resume + the real session progress', async () => {
    const html = await home({ routines: [ROUTINE], week: { 3: 'r1' }, active: ACTIVE() })
    expect(html).toContain('Resume workout'); expect(html).toContain('v3h-live'); expect(html).toContain('2<small> / 12')
  })
  it('right after training: a short recap; a fresh record is celebrated in gold, once, for a limited time', async () => {
    const fresh = [finished('a', 9, 80, 9 * 864e5), finished('b', 0, 85, 20 * 60000, true)]
    const html = await home({ routines: [ROUTINE], week: { 3: 'r1' }, workouts: fresh })
    expect(html).toContain('v3h-recap'); expect(html).toContain('v3h-pr'); expect(html).toContain('New record')
    const old = [finished('a', 9, 80, 9 * 864e5), finished('b', 3, 85, 3 * 864e5, true)]
    const later = await home({ routines: [ROUTINE], week: { 3: 'r1' }, workouts: old })
    expect(later).not.toContain('v3h-pr')                       // 3 days later Home has moved on
    const noPr = await home({ routines: [ROUTINE], week: { 3: 'r1' }, workouts: [finished('a', 9, 90, 9 * 864e5), finished('b', 0, 80, 20 * 60000)] })
    expect(noPr).not.toContain('v3h-pr')                        // a lighter session is not a record
  })
  it('a day without a session is not a hole: it points to the next planned session', async () => {
    const html = await home({ routines: [ROUTINE, ROUTINE_B], week: { 5: 'r2' }, workouts: [finished('a', 9, 80, 9 * 864e5)] })
    expect(html).toContain('Rest day'); expect(html).toContain('Next session'); expect(html).toContain('Pull')
    expect(html).not.toContain('Start workout')
  })
  it('lib: nextPlannedSession / justFinished / recentRecord', async () => {
    await seed({ routines: [ROUTINE, ROUTINE_B], week: { 5: 'r2' }, workouts: [finished('a', 9, 80, 9 * 864e5), finished('b', 0, 85, 20 * 60000, true)] })
    const S = store.getState().S
    expect(mod.alive.nextPlannedSession(S, new Date(NOW)).routine.name).toBe('Pull')
    expect(mod.alive.justFinished(S, NOW).id).toBe('b'); expect(mod.alive.justFinished(S, NOW + 5 * 3600e3)).toBeNull()
    expect(mod.alive.recentRecord(S, NOW).value).toMatch(/85/)
  })
})

describe('Post-workout V3', () => {
  const draw = (w, S, events = []) => renderToStaticMarkup(<mod.Post w={w} S={S} events={events} onDone={() => {}} onShare={() => {}} onSeeProgress={() => {}} />)
  it('hero: name, big duration / sets / volume; gold only with a record or achievement', async () => {
    await seed({ routines: [ROUTINE], workouts: [finished('a', 9, 80, 9 * 864e5), finished('b', 0, 85, 20 * 60000, true)] })
    const S = store.getState().S, w = S.workouts[1]
    const plain = draw(w, S)
    for (const k of ['v3pw-hero', 'Workout complete!', 'Duration', 'Sets', 'Volume', 'Nice!', 'Share workout']) expect(plain).toContain(k)
    expect(plain).not.toContain('v3pw-hero gold'); expect(plain).not.toContain('v2-ach')
    const events = (await import('../lib/mi2j.js')).postWorkoutEvents(S, 'b')
    const gold = draw(w, S, events)
    expect(gold).toContain('v3pw-hero gold'); expect(gold).toContain('v2-ach gold'); expect(gold).toContain('PRs 1')
  })
  it('streak chip only with a real streak; renders from a bare record without throwing', async () => {
    await seed({ routines: [ROUTINE], workouts: [finished('a', 0, 85, 20 * 60000)] })
    const S = store.getState().S
    expect(() => draw({ id: 'z', d: dayISO(0), name: 'Bare' }, S)).not.toThrow()
    expect(draw({ id: 'z', d: dayISO(0), name: 'Bare' }, S)).toContain('Workout complete!')
  })
})

describe('Sprint 1 CSS contract', () => {
  it('respects reduced motion and the Experience V2 tokens', () => {
    const css = readFileSync(new URL('../v3-training.css', import.meta.url), 'utf8')
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
    expect(css).toMatch(/var\(--v2-card\)/); expect(css).toMatch(/var\(--v2-gold\)/)
    expect(css).toMatch(/\.v3-dot::after \{[^}]*inset: -11px/)         // 44 px tap target for 22 px dots
  })
})
