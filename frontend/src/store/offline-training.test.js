import { beforeEach, afterEach, expect, test, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/exercises.js', () => ({ registerCustom: vi.fn(), setHiddenExercises: vi.fn(), setUnavailableEquipment: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, nativeLoad: vi.fn(), nativeSave: vi.fn(), syncReminder: vi.fn(), syncBioimpedanceReminder: vi.fn() }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'demo' }))
vi.mock('../lib/format.js', () => ({ localTZ: () => 'UTC' }))
vi.mock('../lib/measurements.js', () => ({ daysSinceBioimpedance: () => 0 }))

/* Offline Training V1: a signed-in member with a synced routine trains with no connection,
 * closes the app, reopens it offline, finishes, and reconnects. The fake server mirrors
 * api/lib/sync.js's mutate(): receipts by operationId, revision preconditions, and `active`
 * never taken from a save. Each restart() is a full app close/reopen over the same storage. */
const clone = x => JSON.parse(JSON.stringify(x))
const journal = () => JSON.parse(memory.get('gym_sync_v2:u1')).operations
const local = () => JSON.parse(memory.get('gym_state_v1'))
let memory, remote, revision, generation, receipts, offline, loseNextResponse, posts, clears, store, onlineHandlers

function server(url, opts = {}) {
  if (offline) throw Error('Failed to fetch')
  if (url === '/api/config') return {}
  if (url === '/api/me') return { user: { id: 'u1' } }
  if (url.startsWith('/api/sync?')) return { state: clone(remote), meta: { revision, generation } }
  if (url === '/api/active/clear') { clears.push(JSON.parse(opts.body).id); remote.active = null; return { ok: true } }
  if (url === '/api/sync') {
    const op = JSON.parse(opts.body)
    posts.push(op.operationId)
    if (!receipts.has(op.operationId)) {
      if (op.revision !== revision || op.generation !== generation) throw Object.assign(Error('conflict'), { status: 409, data: { code: 'SYNC_CONFLICT' } })
      const next = clone(op.state)
      next.active = remote.active || null
      remote = next; revision++; receipts.add(op.operationId)
    }
    if (loseNextResponse) { loseNextResponse = false; throw Error('response lost after commit') }
    return { state: clone(remote), meta: { revision, generation }, acknowledged: op.operationId }
  }
  throw Error('unexpected ' + url)
}

async function restart() {
  vi.resetModules()
  onlineHandlers = []
  vi.stubGlobal('window', { addEventListener: (type, fn) => { if (type === 'online') onlineHandlers.push(fn) } })
  const { api } = await import('../lib/api.js')
  api.mockImplementation(async (url, opts) => server(url, opts))
  store = (await import('./useStore.js')).useStore
  await store.getState().boot()
}

const routine = { id: 'r1', name: 'Pierna', ex: [{ id: 'squat', sets: 3, reps: 8 }] }
const start = () => store.getState().update(s => {
  s.active = { id: 'w1', d: '2026-09-24', start: 1, routineId: 'r1', name: 'Pierna', cur: 0,
    entries: [{ id: 'squat', target: { reps: 8 }, sets: [{ w: 0, r: 8, done: false }, { w: 0, r: 8, done: false }, { w: 0, r: 8, done: false }] }] }
})
const logSet = (i, w, rpe) => store.getState().update(s => { Object.assign(s.active.entries[0].sets[i], { w, r: 8, rpe, done: true }) })
const finish = async () => {
  const A = store.getState().S.active
  store.getState().update(s => { s.workouts = [...s.workouts, { id: A.id, d: A.d, entries: A.entries, name: A.name }]; s.active = null })
  await store.getState().clearActiveOnServer(A.id)
}

beforeEach(async () => {
  memory = new Map()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('document', { addEventListener: vi.fn() })
  remote = { workouts: [{ id: 'old', d: '2026-09-20', entries: [] }], routines: [routine], programs: [], customEx: [], _ts: 1 }
  revision = 1; generation = 0; receipts = new Set(); offline = false; loseNextResponse = false; posts = []; clears = []
  memory.set('gym_user', JSON.stringify({ id: 'u1' }))
  await restart()   // online boot: routine synced onto this device
  expect(store.getState().syncStatus).toBe('synced')
})
afterEach(() => { vi.unstubAllGlobals() })

test('logging sets journals nothing: the live session is only ever local state', async () => {
  offline = true
  start(); logSet(0, 100, 8); logSet(1, 100, 9)
  expect(journal()).toEqual([])
  expect([...memory.keys()].filter(k => k.includes(':op:'))).toEqual([])
  expect(local().active.entries[0].sets.map(s => s.done)).toEqual([true, true, false])
})

test('close and reopen offline: the signed-in user, routine and in-progress sets all come back', async () => {
  offline = true
  start(); logSet(0, 100, 8)
  await restart()
  const st = store.getState()
  expect(st.user).toEqual({ id: 'u1' })
  expect(st.ready).toBe(true)
  expect(st.S.routines.map(r => r.id)).toEqual(['r1'])
  expect(st.S.active.entries[0].sets[0]).toMatchObject({ w: 100, r: 8, rpe: 8, done: true })
  logSet(1, 105, 9)   // keeps training after reopening
  expect(local().active.entries[0].sets[1]).toMatchObject({ w: 105, done: true })
})

test('finish offline → one durable operation → reopen → reconnect syncs it exactly once', async () => {
  offline = true
  start(); logSet(0, 100, 8); logSet(1, 100, 9); logSet(2, 100, 10)
  await finish()
  expect(journal()).toHaveLength(1)
  expect(store.getState().syncStatus).toBe('offline')
  expect(memory.get('gym_pending_active_clear')).toBe('w1')
  await restart()   // app killed after finishing, reopened still offline
  expect(store.getState().S.active).toBeNull()
  expect(store.getState().S.workouts.map(w => w.id)).toEqual(['old', 'w1'])
  expect(journal()).toHaveLength(1)

  offline = false
  for (const fn of onlineHandlers) await fn()
  await vi.waitFor(() => expect(clears).toEqual(['w1']))
  expect(remote.workouts.map(w => w.id)).toEqual(['old', 'w1'])
  expect(remote.workouts[1].entries[0].sets.map(s => s.rpe)).toEqual([8, 9, 10])
  expect(posts).toHaveLength(1)
  expect(journal()).toEqual([])
  expect(store.getState().syncStatus).toBe('synced')
  expect(memory.get('gym_pending_active_clear')).toBeUndefined()

  await store.getState().pullState()   // later foreground/focus revalidations send nothing more
  expect(posts).toHaveLength(1)
  expect(store.getState().S.workouts.map(w => w.id)).toEqual(['old', 'w1'])
})

test('response lost after the server committed: the retry replays the same operation, no duplicate', async () => {
  offline = true
  start(); logSet(0, 100, 8)
  await finish()
  offline = false
  loseNextResponse = true
  await store.getState().pullState()
  expect(journal()).toHaveLength(1)   // not acknowledged yet, kept
  await store.getState().pullState()
  expect(new Set(posts).size).toBe(1)  // same operationId both times
  expect(revision).toBe(2)
  expect(remote.workouts.filter(w => w.id === 'w1')).toHaveLength(1)
  expect(journal()).toEqual([])
})

test('Workout V2: pad keystrokes, a completed set and an accepted recommendation stay out of the journal', async () => {
  offline = true
  start()
  // what the set pad writes, key by key (8 → 85), then reps, RPE, completion and the
  // recommendation choice — all live-session changes, all durable in gym_state_v1 only
  for (const w of [8, 85]) store.getState().update(s => { s.active.entries[0].sets[0].w = w })
  store.getState().update(s => { s.active.entries[0].sets[0].r = 9 })
  store.getState().update(s => { s.active.entries[0].sets[0].rpe = 8.5 })
  store.getState().update(s => { s.active.entries[0].sets[0].done = true })
  store.getState().update(s => { s.active.entries[0].rec = { kind: 'up', w: 85, r: 8, status: 'accepted' } })
  expect(journal()).toEqual([])
  // a view switch is a preference: journaled like any setting, never carrying the session
  store.getState().update(s => { s.workoutView = 'simple' })
  expect(journal()).toHaveLength(1)
  await restart()
  expect(store.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 85, r: 9, rpe: 8.5, done: true })
  expect(store.getState().S.workoutView).toBe('simple')
  offline = false
  await store.getState().pullState()
  expect(remote.workoutView).toBe('simple')
  expect(remote.active).toBeNull()
  expect(journal()).toEqual([])
  expect(store.getState().S.active.entries[0].sets[0]).toMatchObject({ w: 85, done: true })
})

test('an older journal draft never rolls back sets logged after it', async () => {
  offline = true
  start(); logSet(0, 100, 8)
  store.getState().update(s => { s.routines[0].name = 'Pierna A' })   // a real change, journaled with the session as it was
  logSet(1, 110, 9)                                                  // session-only, not journaled
  await store.getState().pullState()                                 // offline sync publishes the draft
  expect(store.getState().S.active.entries[0].sets[1]).toMatchObject({ w: 110, done: true })
  offline = false
  await store.getState().pullState()
  expect(remote.routines[0].name).toBe('Pierna A')
  expect(store.getState().S.active.entries[0].sets[1]).toMatchObject({ w: 110, done: true })
})
