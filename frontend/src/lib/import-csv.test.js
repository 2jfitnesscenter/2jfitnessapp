import { describe, it, expect } from 'vitest'
import { parseAppleHealth, parseImport, mergeImport } from './import-csv.js'

// Health's real export.xml attribute order isn't fixed, so the fixture deliberately doesn't
// match parseAppleHealth's own AT_* regex order — that would hide an order-dependent bug.
const rec = (type, attrs) => `<Record type="${type}" sourceName="Health" ${Object.entries(attrs).map(([k, v]) => `${k}="${v}"`).join(' ')}/>`
const hk = (...records) => `<?xml version="1.0"?><HealthData>${records.join('')}</HealthData>`

const BODY_MASS = 'HKQuantityTypeIdentifierBodyMass'
const BODY_FAT = 'HKQuantityTypeIdentifierBodyFatPercentage'
const LEAN_MASS = 'HKQuantityTypeIdentifierLeanBodyMass'
const STEPS = 'HKQuantityTypeIdentifierStepCount'
const SLEEP = 'HKCategoryTypeIdentifierSleepAnalysis'
const RESTING_HR = 'HKQuantityTypeIdentifierRestingHeartRate'
const HEART_RATE = 'HKQuantityTypeIdentifierHeartRate'

describe('parseAppleHealth', () => {
  it('reads body weight, converting lb to a kg profile', () => {
    const xml = hk(rec(BODY_MASS, { unit: 'lb', startDate: '2026-01-10 08:00:00 +0000', value: '180' }))
    const p = parseAppleHealth(xml, { unit: 'kg' })
    expect(p.error).toBeUndefined()
    expect(p.bodyweight).toEqual([{ d: '2026-01-10', w: 81.6, t: expect.any(Number) }])
  })

  it('reads body fat written as a plain percentage or as a 0-1 fraction', () => {
    const xml = hk(
      rec(BODY_FAT, { unit: '%', startDate: '2026-01-10 08:00:00 +0000', value: '18.5' }),
      rec(BODY_FAT, { unit: '%', startDate: '2026-01-11 08:00:00 +0000', value: '0.20' }),
    )
    const p = parseAppleHealth(xml, { unit: 'kg' })
    expect(p.measurements.bodyFat).toEqual([
      { d: '2026-01-10', v: 18.5, t: expect.any(Number) },
      { d: '2026-01-11', v: 20, t: expect.any(Number) },
    ])
  })

  it('reads lean body mass as the muscleMass approximation, in kg', () => {
    const xml = hk(rec(LEAN_MASS, { unit: 'kg', startDate: '2026-01-10 08:00:00 +0000', value: '62.3' }))
    const p = parseAppleHealth(xml, { unit: 'kg' })
    expect(p.measurements.muscleMass).toEqual([{ d: '2026-01-10', v: 62.3, t: expect.any(Number) }])
  })

  it('sums step count records into one total per day', () => {
    const xml = hk(
      rec(STEPS, { unit: 'count', startDate: '2026-01-10 08:00:00 +0000', value: '400' }),
      rec(STEPS, { unit: 'count', startDate: '2026-01-10 12:00:00 +0000', value: '1200' }),
      rec(STEPS, { unit: 'count', startDate: '2026-01-11 08:00:00 +0000', value: '900' }),
    )
    const p = parseAppleHealth(xml, { unit: 'kg' })
    expect(p.steps).toEqual([
      { d: '2026-01-10', v: 1600, t: expect.any(Number) },
      { d: '2026-01-11', v: 900, t: expect.any(Number) },
    ])
  })

  it('sums only the Asleep segments of a night, attributed to the wake-up date', () => {
    const xml = hk(
      // in bed at 23:00, asleep from 23:15 to 07:05 (7h50m), excluding a 10-min awake blip
      rec(SLEEP, { startDate: '2026-01-10 23:00:00 +0000', endDate: '2026-01-10 23:15:00 +0000', value: 'HKCategoryValueSleepAnalysisInBed' }),
      rec(SLEEP, { startDate: '2026-01-10 23:15:00 +0000', endDate: '2026-01-11 03:00:00 +0000', value: 'HKCategoryValueSleepAnalysisAsleepCore' }),
      rec(SLEEP, { startDate: '2026-01-11 03:00:00 +0000', endDate: '2026-01-11 03:10:00 +0000', value: 'HKCategoryValueSleepAnalysisAwake' }),
      rec(SLEEP, { startDate: '2026-01-11 03:10:00 +0000', endDate: '2026-01-11 07:05:00 +0000', value: 'HKCategoryValueSleepAnalysisAsleepDeep' }),
    )
    const p = parseAppleHealth(xml, { unit: 'kg' })
    // 3h45m + 3h55m asleep = 460 minutes, filed under Jan 11 (the wake-up date), not Jan 10
    expect(p.sleep).toEqual([{ d: '2026-01-11', v: 460, t: expect.any(Number) }])
  })

  it('reads resting heart rate as one point a day', () => {
    const xml = hk(rec(RESTING_HR, { unit: 'count/min', startDate: '2026-01-10 08:00:00 +0000', value: '58' }))
    const p = parseAppleHealth(xml, { unit: 'kg' })
    expect(p.restingHR).toEqual([{ d: '2026-01-10', v: 58, t: expect.any(Number) }])
  })

  it('splits continuous heart rate into zones per matched workout, ignoring samples outside every window', () => {
    const w1 = { id: 'w1', start: Date.UTC(2026, 0, 12, 18, 0, 0), end: Date.UTC(2026, 0, 12, 18, 40, 0) }
    const w2 = { id: 'w2', start: Date.UTC(2026, 0, 13, 9, 0, 0), end: Date.UTC(2026, 0, 13, 9, 20, 0) }
    const t = (base, mins) => new Date(base + mins * 60000).toISOString().replace('T', ' ').replace('.000Z', ' +0000')
    const xml = hk(
      // outside any workout window — must be dropped, not attributed to w1
      rec(HEART_RATE, { unit: 'count/min', startDate: t(w1.start, -120), value: '65' }),
      // w1: 90 -> 130 -> 150 -> 170 bpm, 5 minutes apart
      rec(HEART_RATE, { unit: 'count/min', startDate: t(w1.start, 0), value: '90' }),
      rec(HEART_RATE, { unit: 'count/min', startDate: t(w1.start, 5), value: '130' }),
      rec(HEART_RATE, { unit: 'count/min', startDate: t(w1.start, 10), value: '150' }),
      rec(HEART_RATE, { unit: 'count/min', startDate: t(w1.start, 15), value: '170' }),
      // w2: a single higher reading
      rec(HEART_RATE, { unit: 'count/min', startDate: t(w2.start, 2), value: '175' }),
    )
    const p = parseAppleHealth(xml, { unit: 'kg', workouts: [w1, w2], maxHR: 190 })
    expect(p.hrZonesByWorkout.size).toBe(2)
    const z1 = p.hrZonesByWorkout.get('w1')
    expect(z1.avg).toBe(135)   // (90+130+150+170)/4
    expect(z1.max).toBe(170)
    // 3 x 5-minute gaps between 4 samples (under the 5-minute cap): 90->Z1, 130->Z2, 150->Z3,
    // the last sample (170) trails nothing
    expect(z1.z).toEqual([5, 5, 5, 0, 0])
    const z2 = p.hrZonesByWorkout.get('w2')
    expect(z2.avg).toBe(175)
    expect(z2.z).toEqual([0, 0, 0, 0, 0])   // one sample, no gap to attribute
  })

  it('still reports avg/max without a zone split when maxHR is unknown', () => {
    const w1 = { id: 'w1', start: Date.UTC(2026, 0, 12, 18, 0, 0), end: Date.UTC(2026, 0, 12, 18, 40, 0) }
    const xml = hk(rec(HEART_RATE, { unit: 'count/min', startDate: '2026-01-12 18:05:00 +0000', value: '140' }))
    const p = parseAppleHealth(xml, { unit: 'kg', workouts: [w1], maxHR: null })
    expect(p.hrZonesByWorkout.get('w1')).toEqual({ avg: 140, max: 140, z: null })
  })

  it('rejects a file with no Health markers', () => {
    expect(parseAppleHealth('<not-health><foo/></not-health>').error).toBe('unrecognised')
  })
})

describe('parseImport routing', () => {
  it('sends an Apple Health export to parseAppleHealth', () => {
    const xml = hk(rec(BODY_MASS, { unit: 'kg', startDate: '2026-01-10 08:00:00 +0000', value: '80' }))
    expect(parseImport(xml, { unit: 'kg' }).kind).toBe('health')
  })

  it('treats unrecognised XML as an error rather than falling through to CSV parsing', () => {
    expect(parseImport('<xml><nonsense/></xml>', { unit: 'kg' }).error).toBe('unrecognised')
  })
})

describe('mergeImport for a health import', () => {
  const freshState = () => ({
    bodyweight: [], measurements: {}, steps: [], sleep: [], restingHR: [],
    workouts: [{ id: 'w1', d: '2026-01-12', start: Date.UTC(2026, 0, 12, 18, 0, 0), end: Date.UTC(2026, 0, 12, 18, 40, 0), entries: [] }],
  })
  const parsed = () => parseAppleHealth(hk(
    rec(BODY_MASS, { unit: 'kg', startDate: '2026-01-10 08:00:00 +0000', value: '80' }),
    rec(BODY_FAT, { unit: '%', startDate: '2026-01-10 08:00:00 +0000', value: '18' }),
    rec(STEPS, { unit: 'count', startDate: '2026-01-10 08:00:00 +0000', value: '500' }),
    rec(HEART_RATE, { unit: 'count/min', startDate: '2026-01-12 18:05:00 +0000', value: '140' }),
  ), { unit: 'kg', workouts: freshState().workouts, maxHR: 190 })

  it('merges every series and attaches heart-rate zones to the matching workout', () => {
    const S = freshState()
    const res = mergeImport(S, parsed())
    expect(res).toEqual({ bodyweight: 1, bodyFat: 1, muscleMass: 0, steps: 1, sleep: 0, restingHR: 0, hrMatched: 1 })
    expect(S.bodyweight).toHaveLength(1)
    expect(S.measurements.bodyFat).toHaveLength(1)
    expect(S.workouts[0].hrZones).toBeTruthy()
  })

  it('re-importing the same file adds nothing new and never recomputes an existing zone match', () => {
    const S = freshState()
    mergeImport(S, parsed())
    const zonesAfterFirst = S.workouts[0].hrZones
    const res = mergeImport(S, parsed())
    expect(res).toEqual({ bodyweight: 0, bodyFat: 0, muscleMass: 0, steps: 0, sleep: 0, restingHR: 0, hrMatched: 0 })
    expect(S.bodyweight).toHaveLength(1)
    expect(S.workouts[0].hrZones).toBe(zonesAfterFirst)   // same object — never overwritten
  })
})
