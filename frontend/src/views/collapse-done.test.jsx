import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Collapse completed exercises — the detailed list folds an exercise whose working sets are all
 * ticked into one line, only when the member turned the preference on. Rendered for real over the
 * real store (react-dom/server, no DOM library); the set data is compared before and after. */
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
let store, Workout, memory

const T = { sets: 3, reps: 10, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps', weight: 80 }
const routine = { id: 'r1', name: 'Pecho', ex: [{ id: '0025', ...T }, { id: '0294', sets: 2, reps: 12, mode: 'reps' }] }
// One exercise, two warmups (never counted) and three working sets.
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
const doneAllWorking = () => write(s => { s.active.entries[0].sets.forEach(x => { if (x.type !== 'warmup') x.done = true }) })

beforeEach(async () => { await fresh() })
afterEach(() => { vi.unstubAllGlobals() })

describe('collapse completed exercises', () => {
  it('the folded line is the same exercise, expandable: its helper keeps every set open after a tap', async () => {
    const { isFoldedDone } = await import('../lib/workout-prefs.js')
    const done = [{ w: 80, r: 10, done: true }, { w: 80, r: 10, done: true }]
    const on = { collapseDone: true }
    expect(isFoldedDone(on, done, false)).toBe(true)
    expect(isFoldedDone(on, done, true)).toBe(false)
    expect(isFoldedDone({ collapseDone: false }, done, false)).toBe(false)
    expect(isFoldedDone(on, [{ w: 80, r: 10, done: false }], false)).toBe(false)
  })

  it('is off by default: a finished exercise keeps its full set list', async () => {
    doneAllWorking()
    const html = await render()
    expect(html).not.toContain('class="exfold"')
    expect(html).toContain('setrow d done')
  })

  it('on + every working set ticked renders one collapsed line, and no set data changes', async () => {
    write(s => { s.collapseDoneExercises = true })
    doneAllWorking()
    const before = clone(store.getState().S.active)
    const html = await render()
    expect(html).toContain('class="exfold"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('Show sets')
    expect(html).not.toContain('setrow')
    expect(store.getState().S.active).toEqual(before)
  })

  it('on but a working set still open keeps the full list', async () => {
    write(s => { s.collapseDoneExercises = true })
    doneAllWorking()
    write(s => { s.active.entries[0].sets[4].done = false })
    const html = await render()
    expect(html).not.toContain('class="exfold"')
    expect(html).toContain('setrow')
  })

  it('warmups never count: done working sets fold even with warmups still open', async () => {
    write(s => { s.collapseDoneExercises = true })
    doneAllWorking()
    expect(store.getState().S.active.entries[0].sets[0].done).toBe(false)
    expect(await render()).toContain('class="exfold"')
  })
})
