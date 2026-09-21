import { beforeEach, afterEach, expect, test, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn() }))
vi.mock('../lib/exercises.js', () => ({ registerCustom: vi.fn(), setHiddenExercises: vi.fn(), setUnavailableEquipment: vi.fn() }))
vi.mock('../lib/mobile.js', () => ({ MOBILE: false, nativeLoad: vi.fn(), nativeSave: vi.fn(), syncReminder: vi.fn(), syncBioimpedanceReminder: vi.fn() }))
vi.mock('../lib/demo.js', () => ({ DEMO: false, DEMO_SEEDED: 'demo' }))
vi.mock('../lib/format.js', () => ({ localTZ: () => 'UTC' }))
vi.mock('../lib/measurements.js', () => ({ daysSinceBioimpedance: () => 0 }))

const clone = x => JSON.parse(JSON.stringify(x))
const pendingKey = 'gym_pending_workout_delete'
let remote, failDelete, store, api
async function restart() {
  vi.resetModules()
  api = (await import('../lib/api.js')).api
  api.mockImplementation(async (url, opts = {}) => {
    if (url === '/api/config') return {}
    if (url === '/api/me') return { user: { id: 'u1' } }
    if (url === '/api/data' && !opts.method) return { state: clone(remote) }
    if (url === '/api/data') {
      const { state, wipe } = JSON.parse(opts.body)
      // Same reconciliation contract as the real API, separately covered by backend tests.
      if (!wipe) {
        const ids = new Set(state.workouts.map(w => w.id))
        state.workouts.push(...remote.workouts.filter(w => !ids.has(w.id)))
      }
      remote = clone(state)
      return { ok: true }
    }
    if (url === '/api/workouts/delete') {
      if (failDelete) throw Error('network failure')
      remote.workouts = remote.workouts.filter(w => w.id !== JSON.parse(opts.body).id)
      return { ok: true }
    }
    throw Error(url)
  })
  store = (await import('./useStore.js')).useStore
}
const ids = () => store.getState().S.workouts.map(w => w.id)
const remoteIds = () => remote.workouts.map(w => w.id)
async function remove(id) {
  store.getState().update(s => { s.workouts = s.workouts.filter(w => w.id !== id) }, false)
  await store.getState().deleteWorkoutOnServer(id)
}
beforeEach(async () => {
  vi.clearAllMocks()
  const memory = new Map()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) })
  vi.stubGlobal('document', { addEventListener: vi.fn() })
  remote = { workouts: ['a', 'b'].map(id => ({ id, d: '2026-09-21', entries: [] })), routines: [], customEx: [], _ts: 1 }
  failDelete = false
  await restart()
  store.getState().setUser({ id: 'u1' })
  store.getState().replaceState(remote, false)
})
afterEach(() => { vi.unstubAllGlobals() })

test('failed delete → pending → restart/pull → successful retry → push never resurrects workout', async () => {
  failDelete = true
  await remove('a')
  expect(JSON.parse(localStorage.getItem(pendingKey))).toEqual(['a'])
  // Make the server copy eligible for hydration, as after another device sync.
  remote._ts = Date.now() + 10000
  await restart()
  failDelete = false
  await store.getState().boot()
  await vi.waitFor(() => expect(localStorage.getItem(pendingKey)).toBeNull())
  expect(ids()).toEqual(['b'])
  expect(JSON.parse(localStorage.getItem('gym_state_v1')).workouts.map(w => w.id)).toEqual(['b'])
  await store.getState().pushState()
  expect(remoteIds()).toEqual(['b'])
})

test('normal online delete remains deleted after push', async () => {
  await remove('a')
  await store.getState().pushState()
  expect(ids()).toEqual(['b'])
  expect(remoteIds()).toEqual(['b'])
})

test('fully offline push and delete retain the intent through restart', async () => {
  failDelete = true
  api.mockImplementationOnce(async () => { throw Error('offline PUT') })
  await remove('a')
  expect(localStorage.getItem('gym_dirty')).toBe('1')
  expect(JSON.parse(localStorage.getItem(pendingKey))).toEqual(['a'])
  await restart()
  failDelete = false
  await store.getState().boot()
  await store.getState().pushState()
  expect(ids()).toEqual(['b'])
  expect(remoteIds()).toEqual(['b'])
  expect(localStorage.getItem(pendingKey)).toBeNull()
})

test('multiple pending deletes survive another failure, then all retries succeed', async () => {
  failDelete = true
  await remove('a'); await remove('b')
  remote._ts = Date.now() + 10000
  await restart()
  await store.getState().boot()
  expect(JSON.parse(localStorage.getItem(pendingKey)).sort()).toEqual(['a', 'b'])
  failDelete = false
  await store.getState().boot()
  await vi.waitFor(() => expect(localStorage.getItem(pendingKey)).toBeNull())
  await store.getState().pushState()
  expect(ids()).toEqual([])
  expect(remoteIds()).toEqual([])
})

test.each([[], [{ id: 'backup', d: '2026-01-01', entries: [] }]])('explicit reset/backup replaces server history: %j', async workouts => {
  await store.getState().replaceStateOnServer({ ...store.getState().S, workouts })
  expect(remote.workouts).toEqual(workouts)
  expect(JSON.parse(api.mock.calls.at(-1)[1].body).wipe).toBe(true)
})
