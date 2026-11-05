import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Exercise chips — an optional row of numbered chips at the top of the live workout. Off by
 * default; when on, one chip per exercise, filled once its working sets are done, tapping one
 * jumps to that exercise. Rendered for real over the real store (react-dom/server, no DOM library). */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/rest-notification.js', () => ({
  cancelRestNotification: vi.fn(), isAndroidNative: vi.fn(() => false),
  requestRestNotificationPermission: vi.fn().mockResolvedValue(true),
  scheduleRestNotification: vi.fn().mockResolvedValue(true),
}))
vi.mock('../components/WorkoutGuide.jsx', () => ({ openWorkoutGuide: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let store, memory, Workout

const T = { sets: 3, reps: 10, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps', weight: 80 }
const routine = { id: 'r1', name: 'Pecho', ex: [{ id: '0025', ...T }, { id: '0294', sets: 2, reps: 12, mode: 'reps' }] }
// Two exercises: the first has two warmups (never counted) and three working sets, the second two working sets.
const session = () => ({
  id: 'live', d: '2026-09-24', start: 1, routineId: 'r1', name: 'Pecho', cur: 0, entries: [
    { id: '0025', target: { ...T }, plan: { kind: 'off' }, sets: [
      { w: 40, r: 8, done: false, type: 'warmup' }, { w: 60, r: 5, done: false, type: 'warmup' },
      { w: 80, r: 10, done: false }, { w: 80, r: 10, done: false }, { w: 80, r: 10, done: false }] },
    { id: '0294', target: { sets: 2, reps: 12, mode: 'reps' }, sets: [{ w: 12.5, r: 12, done: false }, { w: 12.5, r: 12, done: false }] },
  ] })

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  ;({ useStore: store } = await import('../store/useStore.js'))
  ;(await import('../components/ui.jsx')).bindUI((await import('../store/useUI.js')).useUI)
  ;({ default: Workout } = await import('./Workout.jsx'))
}
async function fresh() {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  const state = Object.assign(clone(DEF), { effort: 'rpe', routines: [clone(routine)], workouts: [], active: session() })
  memory.set('gym_state_v1', JSON.stringify(state))
  await boot()
}
const write = fn => store.getState().update(fn)
const render = async () => { await boot(); return renderToStaticMarkup(<MemoryRouter><Workout /></MemoryRouter>) }
const doneFirstExercise = () => write(s => { s.active.entries[0].sets.forEach(x => { if (x.type !== 'warmup') x.done = true }) })
const chipsOf = html => [...html.matchAll(/<button[^>]*class="ex-chip[^"]*"[^>]*>/g)].map(m => m[0])

beforeEach(async () => { await fresh() })
afterEach(() => { vi.unstubAllGlobals() })

describe('exercise chips', () => {
  it('the preference is off by default: no chips row is drawn', async () => {
    const { workoutPrefs } = await import('../lib/workout-prefs.js')
    expect(workoutPrefs(store.getState().S).chips).toBe(false)
    expect(await render()).not.toContain('ex-chips')
  })

  it('on: one numbered chip per exercise, none filled before any working set is done', async () => {
    write(s => { s.showExerciseChips = true })
    const chips = chipsOf(await render())
    expect(chips).toHaveLength(2)
    expect(chips[0]).toContain('aria-current="step"')
    expect(chips.some(c => / done/.test(c))).toBe(false)
  })

  it('a chip is filled once its working sets are all done (warmups never count)', async () => {
    write(s => { s.showExerciseChips = true })
    doneFirstExercise()
    const chips = chipsOf(await render())
    expect(chips[0]).toMatch(/class="ex-chip done cur"/)
    expect(chips[1]).toMatch(/class="ex-chip"/)
  })

  it('tapping a chip calls the jump with that exercise index', async () => {
    const ExerciseChips = (await import('../components/ExerciseChips.jsx')).default
    const onGo = vi.fn()
    const tree = ExerciseChips({ entries: session().entries, cur: 0, onGo })
    const buttons = tree.props.children
    buttons[1].props.onClick()
    expect(onGo).toHaveBeenCalledWith(1)
    buttons[0].props.onClick()
    expect(onGo).toHaveBeenLastCalledWith(0)
  })
})
