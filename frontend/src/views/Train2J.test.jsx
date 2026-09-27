import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/* Entrena con 2J — starting an official routine is a free session built from a snapshot: Workout
 * V2 and the guided runner run it, the member's plan is never touched, and the finished workout
 * is ordinary history that remembers where it came from. Also the offline catalogue and local
 * favourites. Same harness as GuidedWorkout.test.jsx; the network is down the whole time. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../components/WorkoutGuide.jsx', () => ({ openWorkoutGuide: vi.fn() }))

const here = dirname(fileURLToPath(import.meta.url))
const SEED = JSON.parse(readFileSync(join(here, '..', '..', '..', 'api', 'lib', 'guided-official.json'), 'utf8'))
const PROGRAM_SEED = JSON.parse(readFileSync(join(here, '..', '..', '..', 'api', 'lib', 'guided-programs-official.json'), 'utf8'))
const TABATA = SEED.routines.find(r => r.id === 'r2j-tabata-fullbody')
const clone = x => JSON.parse(JSON.stringify(x))
const mine = { id: 'r1', name: 'Pierna A', ex: [{ id: '0043', sets: 3, reps: 8, mode: 'reps', rest: 150 }] }
let memory, store, ui, sheets, guidedApi, Workout

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
  guidedApi = await import('../lib/guided-api.js')
  ;({ default: Workout } = await import('./Workout.jsx'))
}
async function seed(over = {}) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { onboarded: true, routines: [clone(mine)], week: { 1: 'r1' }, dayPlan: { '2026-09-25': 'r1' },
    bodyweight: [{ d: '2026-09-25', w: 78, t: 1 }] }, over)))
  await boot()
}
const S = () => store.getState().S
const A = () => S().active

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-25T18:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('starting an official routine', () => {
  it('builds a free session from the snapshot: guided blocks on, the plan untouched', async () => {
    await seed()
    const plan = JSON.stringify([S().routines, S().week, S().dayPlan, S().programs])
    sheets.startOfficialRoutine(TABATA)
    expect(A().routineId).toBe(null)
    expect(A().name).toBe(TABATA.name)
    expect(A().src2j).toEqual({ id: TABATA.id, name: TABATA.name, category: 'tabata', v: 1 })
    expect(A().entries.map(e => e.id)).toEqual(TABATA.ex.map(e => e.id))
    expect(A().guidedBlocks.map(b => b.type)).toEqual(TABATA.blocks.map(b => b.type))
    expect(A().guidedBlocks.find(b => b.type === 'hiit').timing).toMatchObject({ work: 20, rest: 10 })
    expect(JSON.stringify([S().routines, S().week, S().dayPlan, S().programs])).toBe(plan)
    await boot()   // reopen from storage, then render with the fresh modules
    const html = renderToStaticMarkup(<MemoryRouter><Workout /></MemoryRouter>)
    expect(html).toContain('t2-inwork')
  })
  it('never replaces a workout in progress', async () => {
    await seed()
    sheets.beginWorkout('r1', null)
    const id = A().id
    sheets.startOfficialRoutine(TABATA)
    expect(A().id).toBe(id)
    expect(A().src2j).toBeUndefined()
    expect(ui.getState().sheets.at(-1)?.kind).toBe('center')
  })
  it('finishing writes normal history that remembers the official routine', async () => {
    await seed()
    sheets.beginOfficialWorkout(TABATA, null)
    store.getState().update(s => { s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true })); s.active.guided = null })
    sheets.finishWorkout()
    const w = S().workouts.at(-1)
    expect(S().active).toBe(null)
    expect(w.src2j.id).toBe(TABATA.id)
    expect(w.routineId ?? null).toBe(null)
    expect(w.entries).toHaveLength(TABATA.ex.length)
    expect(S().routines).toEqual([mine])
    const { historyStats } = await import('../lib/train2j.js')
    expect(historyStats(S().workouts)[TABATA.id]).toEqual({ count: 1, last: '2026-09-25' })
  })
  it('runs a program session through the normal Workout/history flow and counts its origin once', async () => {
    await seed()
    const source = PROGRAM_SEED.programs[0]
    const routineIds = [...new Set(source.weeks.flatMap(w => w.sessions.map(s => s.routineId)))]
    const routines = Object.fromEntries(routineIds.map(id => [id, SEED.routines.find(r => r.id === id)]))
    const catalog = { ...source, routineIds, routines }
    const { startGuidedProgram, flattenProgramSessions, programProgress } = await import('../lib/guided-programs.js')
    let started
    store.getState().update(s => { started = startGuidedProgram(s, catalog, { id: 'u1', makeId: () => 'fixture-program' }) })
    const session = flattenProgramSessions(catalog)[0]
    const routine = started.program.routineSnapshots[session.routineId]
    sheets.beginOfficialWorkout(routine, null, { programId: started.program.id, sessionId: session.sessionId, week: 1, day: session.day, routineId: session.routineId })
    store.getState().update(s => { s.active.entries.forEach(e => e.sets.forEach(x => { x.done = true })) })
    sheets.finishWorkout()
    expect(S().workouts).toHaveLength(1)
    expect(S().workouts[0].src2j.program).toMatchObject({ programId: started.program.id, sessionId: session.sessionId, week: 1 })
    expect(programProgress(S().programs.find(p => p.id === started.program.id), S().workouts)).toMatchObject({ completed: 1, total: 12 })
    expect(S().routines).toEqual([mine])
  })
})

describe('offline catalogue and favourites', () => {
  it('without a connection, the last catalogue this account received is shown; favourites stay on the device', async () => {
    await seed()
    memory.set('g2j_catalog:u1', JSON.stringify({ routines: SEED.routines, programs: PROGRAM_SEED.programs, collections: SEED.collections }))
    const g = guidedApi.useGuided
    await g.getState().load('u1')
    expect(g.getState()).toMatchObject({ status: 'ready', offline: true })
    expect(g.getState().routines).toHaveLength(39)
    expect(g.getState().programs).toHaveLength(4)
    expect(Object.keys(g.getState().programs[0].routines)).toContain(PROGRAM_SEED.programs[0].weeks[0].sessions[0].routineId)
    expect(g.getState().toggleFavorite(TABATA.id)).toBe(true)
    expect(JSON.parse(memory.get('g2j_favs:u1'))).toEqual([TABATA.id])
    expect(g.getState().toggleFavorite(TABATA.id)).toBe(false)
    // another account on the same device has nothing cached: an error, not someone else's data
    await g.getState().load('u2', true)
    expect(g.getState().status).toBe('error')
  })
})
