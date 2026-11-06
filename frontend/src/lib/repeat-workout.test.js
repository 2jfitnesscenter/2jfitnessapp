import { describe, it, expect } from 'vitest'
import { repeatableRoutineId } from './repeat-workout.js'

const state = { routines: [{ id: 'r1', name: 'Pierna' }, { id: 'r2', name: 'Empuje' }] }

describe('repeatableRoutineId', () => {
  it('returns the routine of a finished workout that still exists', () => {
    expect(repeatableRoutineId(state, { id: 'w1', routineId: 'r2' })).toBe('r2')
  })

  it('returns null for a freestyle workout without a routine', () => {
    expect(repeatableRoutineId(state, { id: 'w1' })).toBeNull()
    expect(repeatableRoutineId(state, { id: 'w1', routineId: null })).toBeNull()
  })

  it('returns null when the routine was deleted since', () => {
    expect(repeatableRoutineId(state, { id: 'w1', routineId: 'gone' })).toBeNull()
  })

  it('tolerates missing state and workout', () => {
    expect(repeatableRoutineId({}, { routineId: 'r1' })).toBeNull()
    expect(repeatableRoutineId(undefined, undefined)).toBeNull()
  })

  it('does not change the state it reads', () => {
    const snapshot = JSON.stringify(state)
    repeatableRoutineId(state, { id: 'w1', routineId: 'r1' })
    expect(JSON.stringify(state)).toBe(snapshot)
  })
})
