import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

/* Routine actions menu in the member's plan: the two calls it sends, and that the row uses a ⋯ menu — never a permanent trash button. */
const calls = []
vi.mock('../../lib/api.js', () => ({
  api: vi.fn(async (path, opts = {}) => { calls.push({ path, method: opts.method, body: JSON.parse(opts.body) }); return { ok: true } }),
}))

beforeEach(() => {
  calls.length = 0
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {}, length: 0 })
  vi.stubGlobal('crypto', { randomUUID: () => 'op-1' })
})

describe('routine actions', () => {
  it('delete and duplicate go to the member-routine endpoints with the member, routine and sync revision', async () => {
    const api = await import('../../lib/trainer-api.js')
    await api.deleteMemberRoutine('m1', 'r9', { revision: 3, generation: 1 })
    await api.duplicateMemberRoutine('m1', 'r9', { revision: 4, generation: 1 })
    expect(calls.map(c => c.path)).toEqual(['/api/trainer/member-routine-delete', '/api/trainer/member-routine-duplicate'])
    expect(calls[0].body).toMatchObject({ memberId: 'm1', routineId: 'r9', sync: { revision: 3 }, operationId: 'op-1' })
  })

  it('each routine row has a ⋯ menu with Open / Edit / Duplicate / Delete routine, and no always-visible trash icon', () => {
    const src = readFileSync(new URL('./TrainerClientPlan.jsx', import.meta.url), 'utf8')
    const row = src.slice(src.indexOf("loose.map("))
    expect(row).toContain('moreH')
    expect(row).not.toContain('"trash"')
    for (const label of ["t('Open routine')", "t('Edit')", "t('Duplicate')", "t('Delete routine')"]) expect(src).toContain(label)
    expect(src).toContain('confirmSheet')
  })
})
