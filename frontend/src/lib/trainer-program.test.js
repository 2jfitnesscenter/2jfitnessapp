import { describe, expect, it } from 'vitest'
import { mergeRoutineIds } from './trainer-program.js'

describe('trainer program routine grouping', () => {
  it('groups multiple existing routines without duplicate or invalid ids', () => {
    expect(mergeRoutineIds(['r1'], ['r2', 'r3', 'r2', '', null])).toEqual(['r1', 'r2', 'r3'])
  })
  it('does not mutate the original program or selection', () => {
    const current = ['r1']; const incoming = ['r2']
    mergeRoutineIds(current, incoming)
    expect(current).toEqual(['r1'])
    expect(incoming).toEqual(['r2'])
  })
})
