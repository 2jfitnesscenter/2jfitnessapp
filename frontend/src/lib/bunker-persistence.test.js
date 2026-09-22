import { describe, expect, it, vi } from 'vitest'
import { loadPendingFinish, retryPendingFinish, stagePendingFinish } from './bunker-persistence.js'

const memoryStorage = () => {
  const values = new Map()
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key),
  }
}
const workout = { id: 'w1', d: '2026-09-22', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }] }] }

describe('durable Bunker finish', () => {
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
