import { describe, it, expect } from 'vitest'
import { MEASUREMENT, altValueOf, canonicalFromAlt, bodyweightNear, UNIT_TOGGLE_METRIC, bodyFatBand, visceralFatBand } from './measurements.js'

describe('altValueOf / canonicalFromAlt — the %/kg toggle\'s conversion, against total bodyweight', () => {
  it('converts bodyFat (% canonical) to its kg equivalent', () => {
    // 80 kg bodyweight, 20% fat -> 16 kg of fat
    expect(altValueOf(MEASUREMENT.bodyFat, 20, 80)).toBe(16)
  })
  it('converts muscleMass (kg canonical) to its % equivalent', () => {
    // 80 kg bodyweight, 32 kg of muscle -> 40%
    expect(altValueOf(MEASUREMENT.muscleMass, 32, 80)).toBe(40)
  })
  it('is the exact inverse of canonicalFromAlt', () => {
    const alt = altValueOf(MEASUREMENT.bodyFat, 18.5, 75)
    expect(canonicalFromAlt(MEASUREMENT.bodyFat, alt, 75)).toBeCloseTo(18.5, 1)
  })
  it('converts a segmental muscle reading against TOTAL bodyweight, not an estimated segment weight', () => {
    // 80 kg bodyweight, 4 kg of arm muscle -> 5% of total bodyweight
    expect(altValueOf(MEASUREMENT.segMuscleArmL, 4, 80)).toBe(5)
  })
  it('returns null with no bodyweight to convert against', () => {
    expect(altValueOf(MEASUREMENT.bodyFat, 20, null)).toBeNull()
    expect(altValueOf(MEASUREMENT.bodyFat, 20, 0)).toBeNull()
  })
  it('returns null for a measurement with no altUnit at all (segmental fat)', () => {
    expect(altValueOf(MEASUREMENT.segFatArmL, 105, 80)).toBeNull()
    expect(canonicalFromAlt(MEASUREMENT.segFatArmL, 4, 80)).toBeNull()
  })
})

describe('UNIT_TOGGLE_METRIC', () => {
  it('routes every fat-toggleable key to "fat" and every muscle-toggleable key to "muscle"', () => {
    expect(UNIT_TOGGLE_METRIC.bodyFat).toBe('fat')
    expect(UNIT_TOGGLE_METRIC.segFatTrunk).toBe('fat')
    expect(UNIT_TOGGLE_METRIC.muscleMass).toBe('muscle')
    expect(UNIT_TOGGLE_METRIC.segMuscleLegR).toBe('muscle')
  })
  it('has no entry for keys that were never part of a %/kg toggle', () => {
    expect(UNIT_TOGGLE_METRIC.waterPct).toBeUndefined()
    expect(UNIT_TOGGLE_METRIC.skinTriceps).toBeUndefined()
  })
})

describe('bodyweightNear', () => {
  const S = { bodyweight: [{ d: '2026-01-01', w: 80 }, { d: '2026-03-01', w: 78 }, { d: '2026-06-01', w: 76 }] }
  it('uses the entry on or before the given date, not always the latest', () => {
    expect(bodyweightNear(S, '2026-02-15')).toBe(80)
    expect(bodyweightNear(S, '2026-03-01')).toBe(78)
  })
  it('falls back to the earliest entry for a date before any weigh-in on file', () => {
    expect(bodyweightNear(S, '2025-01-01')).toBe(80)
  })
  it('is null with no weigh-ins at all', () => {
    expect(bodyweightNear({ bodyweight: [] }, '2026-01-01')).toBeNull()
  })
})

// Pre-existing behavior, not touched by this change — kept here as a regression guard since
// both now live in the same "compare against a reference range" family as the new conversions.
describe('bodyFatBand / visceralFatBand (unchanged)', () => {
  it('still classify a normal reading as good', () => {
    expect(bodyFatBand(15, 'male', 30)).toBe('good')
    expect(visceralFatBand(8)).toBe('good')
  })
})
