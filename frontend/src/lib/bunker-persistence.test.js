import { describe, expect, it, vi } from 'vitest'
import { loadPendingFinish, retryPendingFinish, stagePendingFinish, drainPendingActive } from './bunker-persistence.js'

const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}
const workout = { id: 'w1', d: '2026-09-22', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }

describe('isolated active queues', () => {
  it('retains a lost response with the same operation and revision for an idempotent retry', async () => {
    const queue = [{ operationId: 'op-A', active: { id: 'A', cur: 2 } }], persist = vi.fn()
    const send = vi.fn().mockRejectedValueOnce(new TypeError('lost response')).mockResolvedValueOnce({ activeRevision: 8 })
    expect((await drainPendingActive({ queue, revision: 7, persist, send })).ok).toBe(false)
    expect(queue[0].expectedActiveRevision).toBe(7)
    expect((await drainPendingActive({ queue, revision: 7, persist, send })).ok).toBe(true)
    expect(send.mock.calls[0][0]).toBe(send.mock.calls[1][0])
    expect(queue).toEqual([])
  })
  it('keeps every local snapshot on conflict and does not blindly send later snapshots', async () => {
    const queue = [{ operationId: 'first', active: workout }, { operationId: 'second', active: workout }]
    const send = vi.fn().mockRejectedValue(Object.assign(new Error('changed'), { status: 409 }))
    const result = await drainPendingActive({ queue, revision: 3, persist: vi.fn(), send })
    expect(result.ok).toBe(false)
    expect(queue).toHaveLength(2)
    expect(send).toHaveBeenCalledTimes(1)
  })
  it('three users drain independently, including one failed queue', async () => {
    const queues = ['A', 'B', 'C'].map(id => [{ operationId: id, active: { id } }])
    const results = await Promise.all(queues.map((queue, i) => drainPendingActive({ queue, revision: i, persist: vi.fn(),
      send: async item => { if (item.active.id === 'B') throw new TypeError('offline'); return { activeRevision: i + 1 } } })))
    expect(results.map(r => r.ok)).toEqual([true, false, true])
    expect(queues.map(q => q.length)).toEqual([0, 1, 0])
  })
})

describe('durable Bunker finish', () => {
  it('keeps a conflicting finish and exposes the conflict for an explicit user choice', async () => {
    const storage = memoryStorage(), error = Object.assign(new Error('replaced'), { status: 409 })
    stagePendingFinish(storage, 'finish', workout)
    const result = await retryPendingFinish({ storage, key: 'finish', drainActive: async () => true, send: async () => { throw error } })
    expect(result).toEqual({ pending: true, completed: false, error })
    expect(loadPendingFinish(storage, 'finish')).toEqual(workout)
  })
  it('retains the exact workout after a network failure and clears it only after retry succeeds', async () => {
    const storage = memoryStorage(), send = vi.fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce({ ok: true })
    stagePendingFinish(storage, 'finish', workout)

    expect(await retryPendingFinish({ storage, key: 'finish', drainActive: async () => true, send }))
      .toEqual({ pending: true, completed: false })
    expect(loadPendingFinish(storage, 'finish')).toEqual(workout)

    expect(await retryPendingFinish({ storage, key: 'finish', drainActive: async () => true, send }))
      .toEqual({ pending: false, completed: true })
    expect(send).toHaveBeenNthCalledWith(1, workout)
    expect(send).toHaveBeenNthCalledWith(2, workout)
    expect(loadPendingFinish(storage, 'finish')).toBeNull()
  })

  it('does not finish while an earlier active snapshot is still pending', async () => {
    const storage = memoryStorage(), send = vi.fn()
    stagePendingFinish(storage, 'finish', workout)
    const result = await retryPendingFinish({ storage, key: 'finish', drainActive: async () => false, send })
    expect(result).toEqual({ pending: true, completed: false })
    expect(send).not.toHaveBeenCalled()
    expect(loadPendingFinish(storage, 'finish')).toEqual(workout)
  })

  it('can retry from its in-memory copy when browser storage is unavailable', async () => {
    const storage = {
      getItem: () => { throw new Error('disabled') },
      setItem: () => { throw new Error('disabled') },
      removeItem: () => { throw new Error('disabled') },
    }
    expect(stagePendingFinish(storage, 'finish', workout)).toBe(workout)
    const send = vi.fn().mockResolvedValue({ ok: true })
    expect(await retryPendingFinish({ storage, key: 'finish', workout, drainActive: async () => true, send }))
      .toEqual({ pending: false, completed: true })
    expect(send).toHaveBeenCalledWith(workout)
  })
})
