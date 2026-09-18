import { describe, it, expect } from 'vitest'
import { ZONES, zoneForPct, zoneForRir, zoneOfSet, suggestedWeightForZone } from './training-zones.js'

const BENCH = '0025'   // real dataset id, chest — same one badges.test.js/recovery.test.js use
const workout = (d, w, entries) => ({ id: 'w' + d, d, start: w, end: 0, entries, vol: 0 })
const set = (over = {}) => ({ w: 40, r: 10, done: true, ...over })
const baseS = (over = {}) => ({ workouts: [], bodyweight: [], exWeights: {}, tests: [], ...over })

describe('zoneForPct', () => {
  it('places the five bands exactly on the brief\'s own boundaries', () => {
    expect(zoneForPct(59).id).toBe(1)
    expect(zoneForPct(60).id).toBe(2)
    expect(zoneForPct(69).id).toBe(2)
    expect(zoneForPct(70).id).toBe(3)
    expect(zoneForPct(79).id).toBe(3)
    expect(zoneForPct(80).id).toBe(4)
    expect(zoneForPct(89).id).toBe(4)
    expect(zoneForPct(90).id).toBe(5)
    expect(zoneForPct(105).id).toBe(5)   // above 100% still reads as Z5, not "off the chart"
  })
  it('is null for no input', () => {
    expect(zoneForPct(null)).toBeNull()
  })
})

describe('zoneForRir', () => {
  it('reads hardest-first, resolving the Z3/Z4 overlap at RIR 2 in favour of Z4', () => {
    expect(zoneForRir(0).id).toBe(5)
    expect(zoneForRir(1).id).toBe(4)
    expect(zoneForRir(2).id).toBe(4)
    expect(zoneForRir(3).id).toBe(3)
    expect(zoneForRir(4).id).toBe(2)
    expect(zoneForRir(5).id).toBe(2)
    expect(zoneForRir(6).id).toBe(1)
    expect(zoneForRir(10).id).toBe(1)
  })
})

describe('zoneOfSet', () => {
  it('prefers %1RM once a 1RM estimate exists for the exercise', () => {
    // A 100kg×5 set gives an Epley estimate of 100*(1+5/30) ≈ 116.7kg.
    const S = baseS({ workouts: [workout('2026-01-01', Date.now() - 86400000, [{ id: BENCH, sets: [set({ w: 100, r: 5 })] }])] })
    // 110kg against ~116.7 1RM is ~94% -> Z5, regardless of this set's own (unlogged) RIR.
    expect(zoneOfSet(S, BENCH, { w: 110, r: 3, done: true }).id).toBe(5)
  })

  it('falls back to logged RIR when there is no 1RM estimate yet for this exercise', () => {
    const S = baseS()
    expect(zoneOfSet(S, BENCH, { w: 40, r: 10, done: true, rir: 0 }).id).toBe(5)
    expect(zoneOfSet(S, BENCH, { w: 40, r: 10, done: true, rir: 5 }).id).toBe(2)
  })

  it('is null with neither a 1RM estimate nor a logged RIR/RPE', () => {
    const S = baseS()
    expect(zoneOfSet(S, BENCH, { w: 40, r: 10, done: true })).toBeNull()
  })
})

describe('suggestedWeightForZone', () => {
  it('suggests a plate-loadable weight near the middle of the requested zone', () => {
    // Best known 1RM here is a flat 100kg (a 1-rep set, which onerm.js returns unchanged).
    const S = baseS({ workouts: [workout('2026-01-01', Date.now(), [{ id: BENCH, sets: [set({ w: 100, r: 1 })] }])] })
    // Z3 (70-80%) midpoint is 75% of 100kg = 75kg, already on a 2.5kg step.
    expect(suggestedWeightForZone(S, BENCH, 3, 'kg')).toBe(75)
  })
  it('is null with no 1RM estimate to work from', () => {
    expect(suggestedWeightForZone(baseS(), BENCH, 3, 'kg')).toBeNull()
  })
})

describe('ZONES catalogue', () => {
  it('has exactly 5 zones with unique ids 1-5', () => {
    expect(ZONES.map(z => z.id)).toEqual([1, 2, 3, 4, 5])
  })
})
