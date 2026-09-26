import { expect, test } from 'vitest'
import { SyncClient } from './sync-client.js'
import { lastBW } from './history.js'

function fixture() {
  const makeStorage = () => {
    const map = new Map()
    return { map, get length() { return map.size }, key: i => [...map.keys()][i] ?? null,
      getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }
  }
  const storage = makeStorage(), calls = []
  let state = { workouts: [] }, revision = 1, generation = 0, offline = false, loseResponse = false
  const receipts = new Map(), tombstones = { workouts: [], routines: [], programs: [] }
  const envelope = () => ({ state: structuredClone(state), meta: { revision, generation, tombstones: structuredClone(tombstones), receipts: Object.fromEntries(receipts) } })
  const api = async (url, opts) => {
    if (offline) throw Error('offline')
    if (!opts) return envelope()
    const op = JSON.parse(opts.body); calls.push(op)
    if (!receipts.has(op.operationId)) {
      if (op.revision !== revision || op.generation !== generation) throw Object.assign(Error('conflict'), { status: 409, data: { ...envelope(), code: 'SYNC_CONFLICT' } })
      if (op.type === 'delete') {
        state[op.kind] = (state[op.kind] || []).filter(x => x.id !== op.id)
        tombstones[op.kind].push(op.id)
      } else {
        const next = structuredClone(op.state)
        next.active = state.active || null
        for (const kind of ['workouts', 'routines', 'programs']) {
          const dead = new Set(tombstones[kind])
          if ((next[kind] || []).some(x => dead.has(x.id))) throw Object.assign(Error('deleted'), { status: 409, data: { ...envelope(), code: 'ENTITY_DELETED' } })
          const present = new Set((next[kind] || []).map(x => x.id)), deleted = new Set(op.deletes?.[kind] || [])
          next[kind] = [...(next[kind] || []), ...(state[kind] || []).filter(x => !present.has(x.id) && !deleted.has(x.id))]
        }
        state = next
      }
      revision++
      if (op.type === 'reset' || op.type === 'replace') generation++
      receipts.set(op.operationId, { revision })
    }
    if (loseResponse) { loseResponse = false; throw Error('lost response') }
    return { ...envelope(), acknowledged: op.operationId }
  }
  const client = (uid = 'user', deviceStorage = storage, initial = { workouts: [] }, legacyDirty = false) =>
    new SyncClient({ uid, api, storage: deviceStorage, onChange: () => {}, initial, legacyDirty })
  return { client, calls, storage, makeStorage, envelope, offline: v => { offline = v }, lose: () => { loseResponse = true },
    remoteEdit: s => { state = structuredClone(s); revision++ },
    remoteDelete: (kind, id) => { state[kind] = (state[kind] || []).filter(x => x.id !== id); tombstones[kind].push(id); revision++ } }
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

test('two devices can explicitly keep the second draft without losing the first device addition', async () => {
  const f = fixture(), a = f.client('user', f.makeStorage()), b = f.client('user', f.makeStorage())
  await a.sync(); await b.sync()
  a.enqueue('save', { workouts: [{ id: 'pc' }] }); await a.sync()
  b.enqueue('save', { workouts: [{ id: 'mobile' }] }); await b.sync()
  expect(b.record.conflict).toBe('SYNC_CONFLICT')
  await b.resolveConflict('local')
  expect(f.envelope().state.workouts.map(x => x.id).sort()).toEqual(['mobile', 'pc'])
  expect(f.envelope().meta.generation).toBe(0)
})

test('pre-Sync-V2 client can choose the server while its local copy remains recoverable', async () => {
  const f = fixture(), storage = f.makeStorage()
  f.remoteEdit({ workouts: [{ id: 'server' }] })
  const c = f.client('legacy', storage, { workouts: [{ id: 'phone' }] }, true)
  await c.sync()
  expect(c.record.conflict).toBe('LEGACY_RECOVERY_REQUIRED')
  await c.resolveConflict('server')
  expect(c.record.draft.workouts[0].id).toBe('server')
  const recoveryKey = [...storage.map.keys()].find(k => k.includes(':recovery:'))
  expect(JSON.parse(storage.getItem(recoveryKey)).local.workouts[0].id).toBe('phone')
})

test('lost response while keeping local retries the same resolution operation exactly once', async () => {
  const f = fixture(), c = f.client(); await c.sync()
  c.enqueue('save', { workouts: [{ id: 'local' }] }); f.remoteEdit({ workouts: [{ id: 'remote' }] }); await c.sync()
  f.lose(); await c.resolveConflict('local')
  const pending = structuredClone(c.record.operations[0])
  expect(pending).toBeTruthy()
  await f.client().sync()
  expect(f.calls.at(-1)).toEqual(pending)
  expect(f.envelope().meta.revision).toBe(3)
})

test('keeping local filters server tombstones and cannot resurrect a deleted workout', async () => {
  const f = fixture(), c = f.client(); await c.sync()
  c.enqueue('save', { workouts: [{ id: 'deleted' }, { id: 'local' }] })
  f.remoteDelete('workouts', 'deleted'); await c.sync()
  await c.resolveConflict('local')
  expect(f.envelope().state.workouts.map(x => x.id)).toEqual(['local'])
  expect(f.envelope().meta.tombstones.workouts).toContain('deleted')
})

test('choosing server supersedes every pending operation without sending it', async () => {
  const f = fixture(), c = f.client(); await c.sync()
  c.enqueue('save', { workouts: [{ id: 'first' }] })
  c.enqueue('save', { workouts: [{ id: 'second' }] })
  f.remoteEdit({ workouts: [{ id: 'server' }] }); await c.sync()
  const calls = f.calls.length
  await c.resolveConflict('server')
  expect(f.calls).toHaveLength(calls)
  expect(c.record.operations).toEqual([])
  expect(c.record.draft.workouts[0].id).toBe('server')
})

test('finish conflict keeps one completed workout and the server active protocol authoritative', async () => {
  const f = fixture(), c = f.client(); await c.sync()
  c.enqueue('save', { workouts: [{ id: 'session-1', end: 'phone' }], active: null })
  f.remoteEdit({ workouts: [{ id: 'session-1', end: 'bunker' }], active: null }); await c.sync()
  await c.resolveConflict('local')
  expect(f.envelope().state.workouts.filter(x => x.id === 'session-1')).toHaveLength(1)
  expect(f.envelope().state.active).toBeNull()
})

test('bodyweight current value uses effective date and time, without mutating imported order', () => {
  const bodyweight = [{ d: '2026-09-21', w: 80, t: 1 }, { d: '2026-09-19', w: 90 }, { d: '2026-09-21', w: 81, t: 2 }, { d: '2026-08-01', w: 95 }]
  expect(lastBW({ bodyweight }).w).toBe(81)
  expect(bodyweight.at(-1).w).toBe(95)
  expect(lastBW({})).toBeNull()
})
