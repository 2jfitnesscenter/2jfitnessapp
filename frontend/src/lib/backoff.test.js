import { describe, it, expect } from 'vitest'
import { buildSets, backOffWeights } from './history.js'
import { EXDB } from './exercises.js'

const LIFT = EXDB.find(e => e.bp !== 'cardio').id
const S_KG = { workouts: [], exWeights: {}, warmupEnabled: false, unit: 'kg' }

describe('backOffWeights', () => {
  it('steps each set about 10 % lighter, snapped to a 2.5 kg plate', () => {
    expect(backOffWeights(80, 3, 'kg')).toEqual([80, 72.5, 65])
  })

  it('steps in 5 lb increments for pounds', () => {
    expect(backOffWeights(100, 3, 'lb')).toEqual([100, 90, 80])
  })

  it('keeps the first set exactly as given, and a single set is just that set', () => {
    expect(backOffWeights(61.3, 1, 'kg')).toEqual([61.3])
  })

  it('is always strictly lighter when rounding would otherwise stall', () => {
    // 5 kg * 0.9 = 4.5 rounds back up to 5; it must drop one plate step instead.
    expect(backOffWeights(5, 2, 'kg')).toEqual([5, 2.5])
  })

  it('holds at the lightest loadable step instead of going to zero', () => {
    expect(backOffWeights(2.5, 3, 'kg')).toEqual([2.5, 2.5, 2.5])
  })
})

describe('buildSets back-off option', () => {
  it('is off by default: targets are unchanged', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 80 })).toEqual([
      { w: 80, r: 8, done: false }, { w: 80, r: 8, done: false }, { w: 80, r: 8, done: false },
    ])
  })

  it('explicitly false behaves exactly like the default', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 80, backoff: false })).toEqual(
      buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 80 })
    )
  })

  it('when on, each working set after the first is one step lighter, keeping reps', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 80, backoff: true })).toEqual([
      { w: 80, r: 8, done: false }, { w: 72.5, r: 8, done: false }, { w: 65, r: 8, done: false },
    ])
  })

  it('works with a single set without changing it', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 1, reps: 8, weight: 80, backoff: true })).toEqual([
      { w: 80, r: 8, done: false },
    ])
  })

  it('leaves a bodyweight set (no load) alone', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 3, reps: 10, weight: 0, backoff: true })).toEqual([
      { w: 0, r: 10, done: false }, { w: 0, r: 10, done: false }, { w: 0, r: 10, done: false },
    ])
  })

  it('a dropset still lands after the lightened last set', () => {
    expect(buildSets({ ...S_KG, unit: 'kg' }, { id: LIFT, sets: 3, reps: 8, weight: 80, backoff: true, dropset: true }).at(-1)).toEqual(
      { w: 52.5, r: 8, done: false, type: 'drop' }
    )
  })
})
