import { describe, expect, it, vi } from 'vitest'
import { removeBlocksSequentially } from './trainer-block-actions.js'

describe('trainer block bulk removal', () => {
  it('removes each selected library block once and reports partial failures', async () => {
    const remove = vi.fn(async id => { if (id === 'b2') throw new Error('denied') })
    await expect(removeBlocksSequentially(['b1', 'b2', 'b1', 'b3'], remove)).resolves.toEqual({ deleted: ['b1', 'b3'], failed: ['b2'] })
    expect(remove).toHaveBeenCalledTimes(3)
  })
})
