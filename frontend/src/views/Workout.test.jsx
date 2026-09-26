import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Workout V2 — behaviour of the live workout screen, rendered for real (react-dom/server) over
 * the real store. No DOM library: interactions go through the same store writes the UI makes
 * (update(), the pad's onField path, acceptRecommendation), then the screen is rendered again. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../components/WorkoutGuide.jsx', () => ({ openWorkoutGuide: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let store, ui, Workout, SetPad, sound, api, guide, sheets

const T = { sets: 3, reps: 10, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps', weight: 80, note: 'Bajada lenta de 3 segundos' }
const routine = { id: 'r1', name: 'Pecho', ex: [
  { id: '0025', ...T },
  { id: '0294', sets: 2, reps: 12, mode: 'reps', sg: 's1' },
  { id: '0447', sets: 2, reps: 10, mode: 'reps', sg: 's1' },
  { id: '0685', sets: 1, min: 20, speed: 9 },
] }
const hist = d => ({ id: 'w' + d, d, entries: [{ id: '0025', target: T, sets: [10, 10, 11].map(r => ({ w: 80, r, rpe: 8, done: true })) }] })
const session = () => ({
  id: 'live', d: '2026-09-24', start: 1, routineId: 'r1', name: 'Pecho', cur: 0, entries: [
    { id: '0025', target: { ...T }, plan: { kind: 'off' }, sets: [
      { w: 40, r: 8, done: false, type: 'warmup' }, { w: 60, r: 5, done: false, type: 'warmup' },
      { w: 80, r: 10, done: false }, { w: 80, r: 10, done: false }, { w: 80, r: 10, done: false }] },
    { id: '0294', sg: 's1', target: { sets: 2, reps: 12, mode: 'reps' }, sets: [{ w: 12.5, r: 12, done: false }, { w: 12.5, r: 12, done: false }] },
    { id: '0447', sg: 's1', target: { sets: 2, reps: 10, mode: 'reps', note: 'Codos pegados' }, sets: [{ w: 20, r: 10, done: false }, { w: 20, r: 10, done: false }] },
    { id: '0685', target: { sets: 1, min: 20, speed: 9 }, sets: [{ min: 20, speed: 9, done: false }] },
  ] })

let memory, state
// Boots the app modules over whatever is in storage — exactly what a reopen does — so every
// render shows the store as it really is after the writes a test made.
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  ;({ useStore: store } = await import('../store/useStore.js'))
  ;({ useUI: ui } = await import('../store/useUI.js'))
  ;(await import('../components/ui.jsx')).bindUI(ui)
  ;({ default: Workout } = await import('./Workout.jsx'))
  ;({ SetPad } = await import('../components/SetPad.jsx'))
  sound = await import('../lib/sound.js')
  api = (await import('../lib/api.js')).api
  guide = await import('../components/WorkoutGuide.jsx')
  sheets = await import('../sheets.jsx')
}
async function fresh(over = {}) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  state = Object.assign(clone(DEF), { effort: 'rpe', routines: [clone(routine)], workouts: [hist('2026-09-17'), hist('2026-09-21')], bodyweight: [{ d: '2026-09-24', w: 78 }], active: session() }, over)
  memory.set('gym_state_v1', JSON.stringify(state))
  await boot()
}
// A write through the real store (the same update() every workout control uses).
const write = fn => store.getState().update(fn)
const render = async () => { await boot(); return renderToStaticMarkup(<MemoryRouter><Workout /></MemoryRouter>) }
const count = (html, needle) => html.split(needle).length - 1
const setView = v => write(s => { s.workoutView = v })

beforeEach(async () => { vi.clearAllMocks(); await fresh() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('two views of one session', () => {
  it('Simple and Detailed show the same logged values, and switching never touches the session', async () => {
    write(s => { Object.assign(s.active.entries[0].sets[2], { w: 82.5, r: 9, rpe: 8.5 }) })
    const before = clone(store.getState().S.active)
    setView('detailed')
    const detailed = await render()
    expect(detailed).toContain('class="dcell w"')
    expect(detailed).toMatch(/aria-label="Weight: 82.5"/)
    setView('simple')
    const simple = await render()
    expect(simple).toContain('class="simple"')
    expect(simple).not.toContain('class="dcell')
    expect(store.getState().S.active).toEqual(before)
    // the simple view walks to the first unfinished set: a warmup here, clearly marked
    expect(simple).toContain('sset warm')
    expect(simple.match(/class="sdot[^"]*warmup"/g)).toHaveLength(2)
  })
  it('an existing profile keeps the detailed list; a view switch is only a preference', async () => {
    expect(await render()).toContain('setrow d')
    setView('simple')
    expect(store.getState().S.workoutView).toBe('simple')
    expect(await render()).toContain('class="simple"')
  })
  it('warmup sets are drawn apart from working sets in the detailed view', async () => {
    const html = await render()
    expect(html).toContain('setgroup-title warm')
    expect(count(html, 'setrow d eff3 warm')).toBe(2)
  })
})

describe('prescription cues', () => {
  it('the trainer note and the library tips are two separate blocks; tips follow the preference', async () => {
    let html = await render()
    expect(html).toMatch(/class="cue note"[\s\S]*Bajada lenta de 3 segundos/)
    expect(html).toContain('class="cue tips"')
    write(s => { s.showExerciseTips = false })
    html = await render()
    expect(html).toContain('Bajada lenta de 3 segundos')
    expect(html).not.toContain('class="cue tips"')
  })
  it('images follow their preference', async () => {
    expect(await render()).toContain('exmedia')
    write(s => { s.showExerciseImages = false })
    expect(await render()).not.toContain('exmedia')
  })
})

describe('supersets and cardio', () => {
  it('simple view shows a superset as A1/A2 tabs and moves to the partner after a set', async () => {
    setView('simple')
    write(s => { s.active.cur = 1 })
    let html = await render()
    expect(html.match(/class="ss-tab( on)?"/g)).toHaveLength(2)
    expect(html).toMatch(/aria-selected="true" class="ss-tab on"[^>]*><span class="ss-badge">A1/)
    write(s => { s.active.entries[1].sets[0].done = true })
    html = await render()
    expect(html).toMatch(/aria-selected="true" class="ss-tab on"[^>]*><span class="ss-badge">A2/)
    expect(html).toContain('Codos pegados')
  })
  it('cardio is logged as minutes and speed, not squeezed into weight × reps', async () => {
    setView('simple')
    write(s => { s.active.cur = 3 })
    const html = await render()
    expect(html).toMatch(/aria-label="Minutes: 20"/)
    expect(html).toMatch(/aria-label="Speed: 9"/)
    expect(html).not.toContain('class="splates"')
  })
})

describe('intelligent progression in the session', () => {
  it('offers an explained recommendation before the first set; accepting changes only this session', async () => {
    const html = await render()
    expect(html).toContain('reccard up')
    expect(html).toContain('Use recommendation')
    expect(html).toContain('Keep plan')
    expect(html).toMatch(/within the target in your last two sessions/)
    const { recommendationFor, acceptRecommendation } = await import('../lib/overload.js')
    const S = store.getState().S
    const rec = recommendationFor(S, S.active.entries[0], 'barbell')
    const routineBefore = clone(S.routines)
    write(s => acceptRecommendation(s.active.entries[0], rec, s.unit))
    const after = store.getState().S
    expect(after.active.entries[0].sets.filter(x => !x.type).map(x => x.w)).toEqual([85, 85, 85])
    expect(after.routines).toEqual(routineBefore)
    expect(after.active.entries[0].target).toEqual(T)
    expect(await render()).not.toContain('reccard')
  })
  it('is not offered when the assistant is off', async () => {
    write(s => { s.enableProgressiveOverloadCoach = false })
    expect(await render()).not.toContain('reccard')
  })
})

describe('the set pad', () => {
  const pad = async (entryIdx, setIdx, field) => { await boot(); return renderToStaticMarkup(<SetPad entryIdx={entryIdx} setIdx={setIdx} field={field} actions={{}} close={() => {}} />) }
  it('shows weight → reps → RPE with the contextual Plates shortcut on a loaded barbell set', async () => {
    const html = await pad(0, 2, 'w')
    expect(html.indexOf('>Weight<')).toBeLessThan(html.indexOf('>Reps<'))
    expect(html.indexOf('>Reps<')).toBeLessThan(html.indexOf('>RPE<'))
    expect(html).toContain('class="sp-plates"')
    expect(await pad(0, 0, 'w')).not.toContain('class="sp-plates"')      // warmup
    expect(await pad(1, 0, 'w')).not.toContain('class="sp-plates"')      // dumbbell
  })
  it('auto-complete off: the pad ends with Done plus an explicit Complete set; on: it completes', async () => {
    let html = await pad(0, 2, 'rpe')
    expect(html).toContain('>Done<')
    expect(html).toContain('class="sp-complete"')
    write(s => { s.autoCompleteSets = true })
    html = await pad(0, 2, 'rpe')
    expect(html).not.toContain('class="sp-complete"')
    expect(html).toMatch(/Complete set/)
  })
})

describe('rest V2', () => {
  it('pause freezes the countdown, resume continues it; the end alert follows alert/sound/vibration', async () => {
    vi.useFakeTimers()
    const { announceRestOver } = await import('../store/useUI.js')
    store.setState({ user: { id: 'u1' } })
    ui.getState().startRest(10, 'Press')
    vi.advanceTimersByTime(3000)
    expect(ui.getState().timer.left).toBe(7)
    ui.getState().pauseRest()
    vi.advanceTimersByTime(5000)
    expect(ui.getState().timer).toMatchObject({ left: 7, paused: true })
    ui.getState().resumeRest()
    vi.advanceTimersByTime(2000)
    expect(ui.getState().timer.left).toBe(5)
    expect(api.mock.calls.map(c => c[0])).toEqual(['/api/push/rest-timer', '/api/push/rest-timer/cancel', '/api/push/rest-timer'])
    vi.advanceTimersByTime(6000)
    expect(ui.getState().timer).toBeNull()
    expect(sound.vibrate).toHaveBeenCalledWith([200, 100, 200])

    const toast = vi.fn()
    vi.clearAllMocks()
    announceRestOver({ restAlert: false, sound: true, vibrate: true }, toast)
    expect(sound.beep).not.toHaveBeenCalled(); expect(sound.vibrate).not.toHaveBeenCalled(); expect(toast).not.toHaveBeenCalled()
    announceRestOver({ restAlert: true, sound: false, vibrate: false }, toast)
    expect(sound.beep.mock.calls.every(c => c[0] === false)).toBe(true)
    expect(sound.vibrate).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledTimes(1)
  })
  it('with the alert off, no rest push is ever scheduled', async () => {
    vi.useFakeTimers()
    store.setState({ user: { id: 'u1' } })
    write(s => { s.restAlert = false })
    ui.getState().startRest(5, 'Press')
    vi.advanceTimersByTime(6000)
    expect(api.mock.calls.filter(c => c[0] === '/api/push/rest-timer')).toEqual([])
  })
})

describe('the training guide trigger', () => {
  it('opens before a new member’s first workout and never for an existing profile', async () => {
    write(s => { s.active = null; s.workouts = []; s.workoutGuidePending = true })
    sheets.startFlow('r1')
    expect(guide.openWorkoutGuide).toHaveBeenCalledTimes(1)
    expect(store.getState().S.active).toBeNull()

    write(s => { s.workoutGuidePending = false })
    sheets.startFlow('r1')
    expect(guide.openWorkoutGuide).toHaveBeenCalledTimes(1)
    expect(store.getState().S.active?.routineId).toBe('r1')
  })
})

describe('Constructor V2 prescriptions reach the workout unchanged', () => {
  it('the planned 2J effort shows next to the target, and the prescribed rest drives the timer', async () => {
    write(s => { s.active.entries[0].target = { ...s.active.entries[0].target, rpe: [8, 8, 10], rest: 150 }; s.workoutView = 'simple' })
    const html = await render()
    expect(html).toContain('RPE 8·8·10')
    const { restSecondsFor } = await import('./Workout.jsx')
    expect(restSecondsFor({ target: { rest: 150 } }, { restSec: 90 })).toBe(150)
    expect(restSecondsFor({ target: {} }, { restSec: 90 })).toBe(90)          // old routines: the member's setting
    expect(restSecondsFor({ target: { rest: 0 } }, { restSec: 75 })).toBe(75)
  })
})

describe('Series Feedback V1', () => {
  const doneFirst = extra => write(s => { Object.assign(s.active.entries[0].sets[2], { w: 80, r: 10, done: true }, extra) })
  it('asks after a finished working set, suggests the next set only, and changes nothing by itself', async () => {
    doneFirst()
    let html = await render()
    expect(html).toContain('class="setfb"')
    expect(html).not.toContain('setfb-sug')                      // no feeling yet: no suggestion
    const { setFeeling } = await import('../lib/set-feedback.js')
    write(s => setFeeling(s.active.entries[0], 2, 'easy'))
    html = await render()
    expect(html).toMatch(/setfb-sug up[\s\S]*80 kg → 85 kg/)
    expect(store.getState().S.active.entries[0].sets.map(x => x.w)).toEqual([40, 60, 80, 80, 80])   // ignored = untouched
    setView('simple')
    expect(await render()).toContain('setfb-sug up')
  })
  it('accept writes only the next set; the routine and its target stay as they were', async () => {
    doneFirst({ feel: 'easy' })
    const routineBefore = clone(store.getState().S.routines)
    const targetBefore = clone(store.getState().S.active.entries[0].target)
    const { nextSetSuggestion, acceptSuggestion } = await import('../lib/set-feedback.js')
    write(s => { const e = s.active.entries[0]; acceptSuggestion(e, 2, nextSetSuggestion(s, e, 2, 'barbell')) })
    const S = store.getState().S
    expect(S.active.entries[0].sets.map(x => x.w)).toEqual([40, 60, 80, 85, 80])
    expect(S.active.entries[0].target).toEqual(targetBefore)
    expect(S.routines).toEqual(routineBefore)
    expect(await render()).not.toContain('setfb-sug')
  })
  it('the feeling lives in S.active offline, survives a reopen and reaches the finished workout', async () => {
    doneFirst({ feel: 'hard' })
    expect(JSON.parse(memory.get('gym_state_v1')).active.entries[0].sets[2].feel).toBe('hard')
    await boot()                                                   // reopen, still offline
    expect(store.getState().S.active.entries[0].sets[2].feel).toBe('hard')
    write(s => { s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true })) })
    sheets.finishWorkout()
    const w = store.getState().S.workouts.at(-1)
    expect(w.entries[0].sets[2].feel).toBe('hard')
    expect(w.entries[0].sets[3].feel).toBeUndefined()              // optional field, never invented
  })
})
