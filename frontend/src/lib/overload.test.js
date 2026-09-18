import { describe, it, expect } from 'vitest'
import { suggestOverload, isOverloadSet, isPotentialPR } from './overload.js'

const baseS = (over = {}) => ({ workouts: [], bodyweight: [], exWeights: {}, tests: [], use2JRoomEquipment: false, customIncrements: { barbell: 5, dumbbell: 2, machineOther: 5 }, ...over })

describe('suggestOverload', () => {
  it('is null with no prior session to compare against', () => {
    expect(suggestOverload(baseS(), 'barbell', null, 10)).toBeNull()
  })

  it('suggests more weight, same reps, once the rep target was hit last time', () => {
    const last = { sets: [{ w: 80, r: 10, done: true }] }
    const s = suggestOverload(baseS(), 'barbell', last, 10)
    expect(s).toEqual({ w: 85, r: 10, strategy: 'weight' })   // barbell steps flat 5kg in this app's stepWeight
  })

  it('holds the weight and suggests one more rep when the target wasn\'t reached', () => {
    const last = { sets: [{ w: 80, r: 8, done: true }] }
    const s = suggestOverload(baseS(), 'barbell', last, 10)
    expect(s).toEqual({ w: 80, r: 9, strategy: 'volume' })
  })

  it('uses the heaviest working set from last time as the reference, not the first one', () => {
    const last = { sets: [{ w: 60, r: 12, done: true }, { w: 80, r: 8, done: true }] }
    const s = suggestOverload(baseS(), 'barbell', last, 10)
    expect(s.w).toBe(80)   // the 80kg set is the real reference, not the 60kg warm-up-ish one
  })

  it('treats no configured rep target as "always hit it" — a plain +weight suggestion', () => {
    const last = { sets: [{ w: 80, r: 5, done: true }] }
    const s = suggestOverload(baseS(), 'barbell', last, null)
    expect(s.strategy).toBe('weight')
  })
})

describe('isOverloadSet', () => {
  it('is true for more weight at the same or better reps', () => {
    expect(isOverloadSet({ w: 80, r: 8 }, { w: 85, r: 8 })).toBe(true)
    expect(isOverloadSet({ w: 80, r: 8 }, { w: 85, r: 9 })).toBe(true)
  })
  it('is true for the same weight with more reps', () => {
    expect(isOverloadSet({ w: 80, r: 8 }, { w: 80, r: 9 })).toBe(true)
  })
  it('is false for less weight or fewer reps, or nothing to compare against', () => {
    expect(isOverloadSet({ w: 80, r: 8 }, { w: 75, r: 10 })).toBe(false)
    expect(isOverloadSet({ w: 80, r: 8 }, { w: 80, r: 7 })).toBe(false)
    expect(isOverloadSet(null, { w: 80, r: 8 })).toBe(false)
  })
})

describe('isPotentialPR', () => {
  it('is true when the set\'s estimated 1RM beats the best on record', () => {
    const S = baseS({ workouts: [{ id: 'w1', d: '2026-01-01', start: Date.now() - 86400000, end: 0, vol: 0, entries: [{ id: '0025', sets: [{ w: 80, r: 5, done: true }] }] }] })
    // 80x5 -> Epley ~93.3kg. A fresh 100x3 set (~106.7kg) beats it.
    expect(isPotentialPR(S, '0025', { w: 100, r: 3 })).toBe(true)
  })
  it('is false when it doesn\'t beat the record, or the set can\'t produce an estimate', () => {
    const S = baseS({ workouts: [{ id: 'w1', d: '2026-01-01', start: Date.now() - 86400000, end: 0, vol: 0, entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }] }] }] })
    expect(isPotentialPR(S, '0025', { w: 60, r: 10 })).toBe(false)
    expect(isPotentialPR(baseS(), '0025', { w: 0, r: 5 })).toBe(false)
  })
  it('is true (no prior record to beat) the first time this exercise ever produces an estimate', () => {
    expect(isPotentialPR(baseS(), '0025', { w: 60, r: 5 })).toBe(true)
  })
})
