import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Constructor V2.1 — guided blocks inside the live workout, rendered over the real store and
 * booted from storage like a reopen (same harness as Workout.test.jsx). Also: Home no longer
 * duplicates body composition. The network is down the whole time. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../components/WorkoutGuide.jsx', () => ({ openWorkoutGuide: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, ui, sheets, guided, Workout, Home
const tabata = { iid: 'kt', src: 'off-cardio-general-advanced-x-hiit', name: 'Tabata bici', type: 'hiit', goal: 'general', level: 'advanced', v: '1.0',
  timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 8, roundRest: 0 } }
const routine = { id: 'r1', name: 'Pierna + Tabata', blocks: [tabata], ex: [
  { id: '0043', sets: 3, reps: 8, mode: 'reps', rest: 150 },
  { id: '2138', sets: 8, mode: 'time', sec: 20, weight: 0, blk: 'kt' },
] }

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible', body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  ;({ useStore: store } = await import('../store/useStore.js'))
  ;({ useUI: ui } = await import('../store/useUI.js'))
  ;(await import('../components/ui.jsx')).bindUI(ui)
  sheets = await import('../sheets.jsx')
  guided = await import('../lib/guided.js')
  ;({ default: Workout } = await import('./Workout.jsx'))
  ;({ default: Home } = await import('./Home.jsx'))
}
async function seed(over = {}) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { onboarded: true, routines: [clone(routine)], bodyweight: [{ d: '2026-09-24', w: 78, t: 1 }] }, over)))
  await boot()
}
const write = fn => store.getState().update(fn)
// Boot first, then pick the view from the fresh modules (a view captured before the boot reads the old store).
const render = async name => { await boot(); const View = name === 'Home' ? Home : Workout; return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>) }
const A = () => store.getState().S.active

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-25T18:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('a routine with a guided block', () => {
  it('starting the workout snapshots the block and its timing; the plain exercise is unchanged', async () => {
    await seed()
    sheets.beginWorkout('r1', null)
    expect(A().guidedBlocks).toEqual([{ iid: 'kt', name: 'Tabata bici', type: 'hiit', timing: tabata.timing }])
    expect(A().entries[0].target.rest).toBe(150)
    expect(A().guided).toBeUndefined()
  })
  it('on the block, the workout offers to run it paced — and keeps normal logging below', async () => {
    await seed()
    sheets.beginWorkout('r1', null)
    write(s => { s.active.cur = 1 })
    const html = await render('Workout')
    expect(html).toContain('gx-launch')
    expect(html).toContain('Start guided block')
    expect(html).toContain('20 s work · 10 s rest · 8 rounds')
    expect(html).toContain('Tabata')
    expect(html).toMatch(/workout-sets-card|class="simple"/)
  })
  it('a legacy exercise shows no guided UI at all', async () => {
    await seed()
    sheets.beginWorkout('r1', null)
    const html = await render('Workout')
    expect(html).not.toContain('gx-launch')
    expect(html).not.toContain('class="gx ')
  })
  it('running: the executor takes the screen; its state survives a reload from storage, clock-based', async () => {
    await seed()
    sheets.beginWorkout('r1', null)
    const block = A().guidedBlocks[0]
    write(s => { s.active.guided = guided.startRun(s.active, block, { sound: true, vibrate: true }) })
    let html = await render('Workout')
    expect(html).toContain('class="gx prep"')
    expect(html).toContain('Get ready')
    expect(html).toContain('0:10')
    expect(html).toContain('Round 1 of 8')
    expect(html).not.toContain('Transfer to the Bunker')
    // a reload (new boot) reads the same run back from storage — nothing lives only in memory
    const endsAt = A().guided.endsAt
    await boot()
    expect(store.getState().S.active.guided.endsAt).toBe(endsAt)
    // 35 s later (screen was locked): prep + first bout + part of the rest — caught up in order
    const steps = guided.buildSteps(A(), block)
    const out = guided.catchUp(A().guided, steps, Date.now() + 35_000)
    expect(out.marks).toEqual([{ e: 1, s: 0, sec: 20 }])
    expect(out.run.bg).toBe(1)
  })
  it('pause shows the seconds left; finishing the workout keeps a guided summary in history', async () => {
    await seed()
    sheets.beginWorkout('r1', null)
    const block = A().guidedBlocks[0]
    write(s => {
      s.active.guided = guided.pause({ ...guided.startRun(s.active, block, {}), i: 1, endsAt: Date.now() + 12_000 })
      s.active.entries[1].sets[0].done = true
      s.active.entries[0].sets.forEach(x => { x.done = true })
    })
    const html = await render('Workout')
    expect(html).toContain('class="gx work"')
    expect(html).toContain('Paused')
    expect(html).toContain('0:12')
    // every set logged (the open run is closed by the finish itself), so no 'finish early?' prompt
    write(s => { s.active.entries[1].sets.forEach(x => { x.done = true }) })
    sheets.finishWorkout()
    const w = store.getState().S.workouts.at(-1)
    expect(store.getState().S.active).toBe(null)
    expect(w.guided).toHaveLength(1)
    expect(w.guided[0]).toMatchObject({ iid: 'kt', type: 'hiit', preset: 'tabata', bouts: 8, boutsPlanned: 8, roundsPlanned: 8, roundsDone: 8, completed: true })
    expect(w.entries.map(e => e.id)).toEqual(['0043', '2138'])
    expect(JSON.stringify(w.guided).length).toBeLessThan(700)   // a summary, not a tick log
  })
  it('a finished block leaves the executor and moves the workout past it', async () => {
    await seed({ routines: [{ ...clone(routine), ex: [...clone(routine).ex, { id: '0025', sets: 3, reps: 8, mode: 'reps' }] }] })
    sheets.beginWorkout('r1', null)
    const block = A().guidedBlocks[0]
    const { commitGuided } = await import('../components/GuidedRunner.jsx')
    const run = guided.startRun(A(), block, {})
    const steps = guided.buildSteps(A(), block)
    commitGuided(store.getState().update, block, guided.catchUp(run, steps, Date.now() + 3_600_000))
    expect(A().guided).toBe(null)
    expect(A().cur).toBe(2)
    expect(A().entries[1].sets.every(s => s.done)).toBe(true)
    expect(A().guidedLog[0]).toMatchObject({ completed: true, bouts: 8, background: 8 })
    const html = await render('Workout')
    expect(html).not.toContain('class="gx ')
  })
})

describe('Home', () => {
  it('no longer shows body composition (it lives in Profile → Health / Measurements); the data is untouched', async () => {
    const bio = [{ d: '2026-09-20', type: 'bioimpedance', weight: 78, bodyFat: 18, muscleMass: 60, segments: { trunk: { fat: 20, muscle: 28 } } }]
    await seed({ measurements: bio })
    const html = await render('Home')
    expect(html).not.toContain('Body composition')
    expect(html).not.toContain('sbd-svg')
    expect(store.getState().S.measurements).toEqual(bio)
  })
})
