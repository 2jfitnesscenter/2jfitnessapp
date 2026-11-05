import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Focus view — in the detailed list, one exercise at a time with nothing else on screen, moved with
 * prev/next. Rendered for real over the real store (react-dom/server); set data is compared before
 * and after. */
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
// Two exercises: the first has two warmups and three working sets (five rows), the second two rows.
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
const rows = html => (html.match(/class="setrow /g) || []).length

beforeEach(async () => { await fresh() })
afterEach(() => { vi.unstubAllGlobals() })

describe('focus view', () => {
  it('is off by default: the normal list keeps its progress, next-up and move controls', async () => {
    const html = await render()
    expect(html).toContain('v3-prog')
    expect(html).toContain('v3-next')
    expect(html).not.toContain('focus-nav')
  })

  it('on renders only the current entry, with its own prev/next and nothing else', async () => {
    write(s => { s.focusView = true })
    const html = await render()
    expect(html).toContain('focus-nav')
    expect(html).toContain('aria-label="Previous exercise"')
    expect(html).toContain('aria-label="Next exercise"')
    expect(html).toContain('1 / 2')
    expect(html).not.toContain('v3-prog')
    expect(html).not.toContain('v3-next')
    expect(rows(html)).toBe(5)
  })

  it('moving to the next entry shows only that entry, and the previous button is disabled on the first', async () => {
    write(s => { s.focusView = true })
    write(s => { s.active.cur = 1 })
    const html = await render()
    expect(html).toContain('2 / 2')
    expect(rows(html)).toBe(2)
    expect(html).toMatch(/aria-label="Next exercise"[^>]*disabled/)
    expect(html).not.toMatch(/aria-label="Previous exercise"[^>]*disabled/)
  })

  it('no set data changes when focus is switched on or the view is stepped', async () => {
    write(s => { s.active.entries[0].sets[2].done = true })
    const before = clone(store.getState().S.active)
    write(s => { s.focusView = true })
    await render()
    write(s => { s.active.cur = 1 })
    await render()
    expect(store.getState().S.active.entries).toEqual(before.entries)
  })

  it('stepping clamps to the session and the preference defaults to off', async () => {
    const { focusStep, workoutPrefs } = await import('../lib/workout-prefs.js')
    expect(focusStep(0, -1, 2)).toBe(0)
    expect(focusStep(0, 1, 2)).toBe(1)
    expect(focusStep(1, 1, 2)).toBe(1)
    expect(focusStep(0, 1, 0)).toBe(0)
    expect(workoutPrefs({}).focus).toBe(false)
    expect(workoutPrefs({ focusView: true }).focus).toBe(true)
  })
})
