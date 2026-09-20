import { describe, it, expect, afterEach } from 'vitest'
import {
  EXDB, isHidden, setHiddenExercises, isEquipmentUnavailable, setUnavailableEquipment, isUnavailable,
} from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio' && e.eq === 'dumbbell')
const OTHER_EQ = EXDB.find(e => e.bp !== 'cardio' && e.eq !== LIFT.eq)

describe('V2 — equipment availability (isUnavailable)', () => {
  afterEach(() => { setHiddenExercises([]); setUnavailableEquipment([]) })

  it('an exercise is available when nothing blocks it', () => {
    expect(isUnavailable(LIFT.id)).toBe(false)
    expect(isUnavailable(LIFT)).toBe(false)
  })

  it('admin-hidden still works exactly as before (V1 behaviour untouched)', () => {
    setHiddenExercises([LIFT.id])
    expect(isHidden(LIFT.id)).toBe(true)
    expect(isUnavailable(LIFT.id)).toBe(true)
  })

  it('marking its equipment unavailable blocks the exercise too, without hiding it', () => {
    setUnavailableEquipment([LIFT.eq])
    // equipment-unavailable is a separate mechanism from the admin blacklist
    expect(isHidden(LIFT.id)).toBe(false)
    expect(isEquipmentUnavailable(LIFT.eq)).toBe(true)
    expect(isUnavailable(LIFT.id)).toBe(true)
    expect(isUnavailable(LIFT)).toBe(true)
  })

  it('an exercise on different equipment is unaffected', () => {
    setUnavailableEquipment([LIFT.eq])
    expect(isUnavailable(OTHER_EQ)).toBe(false)
  })

  it('restoring the equipment immediately un-blocks every exercise that needed it', () => {
    setUnavailableEquipment([LIFT.eq])
    expect(isUnavailable(LIFT.id)).toBe(true)
    setUnavailableEquipment([])
    expect(isUnavailable(LIFT.id)).toBe(false)
  })

  it('both mechanisms can be true for the same exercise at once, and either alone is enough', () => {
    setHiddenExercises([LIFT.id])
    setUnavailableEquipment([LIFT.eq])
    expect(isUnavailable(LIFT.id)).toBe(true)
    setHiddenExercises([])
    // the equipment block alone still applies
    expect(isUnavailable(LIFT.id)).toBe(true)
  })

  it('an unknown id or a null exercise is simply not unavailable, never throws', () => {
    expect(isUnavailable('not-a-real-id')).toBe(false)
    expect(isUnavailable(null)).toBe(false)
    expect(isUnavailable(undefined)).toBe(false)
  })
})
