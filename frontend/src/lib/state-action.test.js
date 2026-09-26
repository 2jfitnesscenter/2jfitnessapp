import { beforeEach, expect, test, vi } from 'vitest'
import { api } from './api.js'
import { retryStateActions, stateAction } from './state-action.js'

vi.mock('./api.js', () => ({ api: vi.fn() }))
let memory
beforeEach(() => {
  memory = new Map([['gym_user', JSON.stringify({ id: 'trainer' })]])
  vi.stubGlobal('localStorage', {
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
  })
  vi.clearAllMocks()
})

test('startup retry drains a secondary writer after a lost response with the same body', async () => {
  api.mockRejectedValueOnce(Error('offline'))
  await expect(stateAction('/api/admin/user/measurements', { id: 'member', weight: 80 }, { revision: 3, generation: 0 })).rejects.toThrow()
  const stored = JSON.parse([...memory.entries()].find(([k]) => k.startsWith('gym_state_action:'))[1])
  api.mockResolvedValueOnce({ ok: true })
  await retryStateActions()
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual(stored.body)
  expect([...memory.keys()].some(k => k.startsWith('gym_state_action:'))).toBe(false)
})

test('lost response keeps operationId and original revision even after caller reloads newer metadata', async () => {
  let applied
  api.mockImplementationOnce(async (path, opts) => {
    applied = JSON.parse(opts.body)
    throw Error('response lost')
  })
  await expect(stateAction('/api/trainer/assign-routine', { memberId: 'member', routineId: 'r' }, { revision: 4, generation: 0 })).rejects.toThrow()
  api.mockImplementationOnce(async (path, opts) => JSON.parse(opts.body))
  const retried = await stateAction('/api/trainer/assign-routine', { memberId: 'member', routineId: 'r' }, { revision: 5, generation: 0 })
  expect(retried).toEqual(applied)
  expect([...memory.keys()].filter(k => k.startsWith('gym_state_action:'))).toEqual([])
})
