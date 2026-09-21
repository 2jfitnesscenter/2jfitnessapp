import { expect, test } from 'vitest'
import { SyncClient } from './sync-client.js'
import { lastBW } from './history.js'

function fixture() {
  const map = new Map(), calls = []
  let state = { workouts: [] }, revision = 1, generation = 0, offline = false, loseResponse = false
  const receipts = new Set()
  const storage = { getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) }
  const envelope = () => ({ state: structuredClone(state), meta: { revision, generation } })
  const api = async (url, opts) => {
    if (offline) throw Error('offline')
    if (!opts) return envelope()
    const op = JSON.parse(opts.body); calls.push(op)
    if (!receipts.has(op.operationId)) {
      if (op.revision !== revision || op.generation !== generation) throw Object.assign(Error('conflict'), { status: 409, data: { ...envelope(), code: 'SYNC_CONFLICT' } })
      state = structuredClone(op.state); revision++
      if (op.type === 'reset' || op.type === 'replace') generation++
      receipts.add(op.operationId)
    }
    if (loseResponse) { loseResponse = false; throw Error('lost response') }
    return { ...envelope(), acknowledged: op.operationId }
  }
  const client = (uid = 'user') => new SyncClient({ uid, api, storage, onChange: () => {}, initial: { workouts: [] } })
  return { client, calls, storage, envelope, offline: v => { offline = v }, lose: () => { loseResponse = true }, remoteEdit: s => { state = s; revision++ } }
}
test.each(['reset', 'replace'])('%s survives offline/reload with its exact operationId and type', async type => {
  const f = fixture(), c = f.client(); await c.sync()
  f.offline(true)
  c.enqueue(type, { workouts: [{ id: 'replacement' }] })
  const original = structuredClone(c.record.operations[0])
  await c.sync()
  const reopened = f.client(); expect(reopened.record.operations[0]).toEqual(original)
  f.offline(false); await reopened.sync()
  expect(f.calls[0]).toEqual(original)
  expect(reopened.record.operations).toEqual([])
  expect(f.envelope().meta.generation).toBe(1)
})
test('response lost after commit: retry sends identical operation, revision advances once', async () => {
  const f = fixture(), c = f.client(); await c.sync()
  c.enqueue('save', { workouts: [{ id: 'w' }] }); f.lose(); await c.sync()
  expect(c.record.operations).toHaveLength(1)
  await f.client().sync()
  expect(f.calls[0]).toEqual(f.calls[1])
  expect(f.envelope().meta.revision).toBe(2)
})
test('remote edit conflicts with pending draft; fresh pull never blesses stale payload', async () => {
  const f = fixture(), c = f.client(); await c.sync()
  c.enqueue('save', { workouts: [{ id: 'local' }] })
  f.remoteEdit({ workouts: [{ id: 'remote' }] }); await c.sync()
  expect(c.record.conflict).toBe('SYNC_CONFLICT')
  expect(c.record.draft.workouts[0].id).toBe('local')
  expect(c.record.base.state.workouts[0].id).toBe('remote')
  const count = f.calls.length; await c.sync()
  expect(f.calls).toHaveLength(count)
})
test('successive local edits use successive revisions; account journals are isolated', async () => {
  const f = fixture(), c = f.client(); await c.sync()
  c.enqueue('save', { workouts: [{ id: 'one' }] })
  c.enqueue('save', { workouts: [{ id: 'two' }] })
  expect(f.client('other').record.operations).toEqual([])
  await c.sync()
  expect(f.calls.map(o => o.revision)).toEqual([1, 2])
  expect(f.envelope().state.workouts[0].id).toBe('two')
})
test('a divergent legacy local copy is preserved instead of silently uploaded or discarded', async () => {
  const f = fixture()
  const c = new SyncClient({ uid: 'legacy', storage: f.storage, api: async () => ({ state: { workouts: [{ id: 'remote' }] }, meta: { revision: 1, generation: 0 } }), onChange: () => {}, initial: { workouts: [{ id: 'legacy' }] } })
  await c.sync()
  expect(c.record.conflict).toBe('LEGACY_RECOVERY_REQUIRED')
  expect(c.record.recovery.workouts[0].id).toBe('legacy')
})
test('offline revalidation with no pending work never restores an obsolete local draft', async () => {
  const f = fixture(), c = f.client(); let visible
  c.onChange = state => { visible = state }
  await c.sync()
  f.remoteEdit({ workouts: [{ id: 'from-pc' }] }); await c.sync()
  expect(visible.workouts[0].id).toBe('from-pc')
  f.offline(true); await c.sync()
  expect(visible.workouts[0].id).toBe('from-pc')
})

test('bodyweight current value uses effective date and time, without mutating imported order', () => {
  const bodyweight = [{ d: '2026-09-21', w: 80, t: 1 }, { d: '2026-09-19', w: 90 }, { d: '2026-09-21', w: 81, t: 2 }, { d: '2026-08-01', w: 95 }]
  expect(lastBW({ bodyweight }).w).toBe(81)
  expect(bodyweight.at(-1).w).toBe(95)
  expect(lastBW({})).toBeNull()
})
