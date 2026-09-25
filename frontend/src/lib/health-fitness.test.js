import { describe, expect, it } from 'vitest'
import { metricSummary, availableMetrics, compareMeasurements, scanDates, segmentSummary, hasSegments, bmiOf, weekActivity, RANGES } from './health.js'
import { fitnessOf, summarizeHr, hrAccumulator, maxHrFor, mapWhoopWorkout, mapAppleWorkout, mapHealthConnectSession, mapHealthKitWorkout, matchActivity, matchAll, attachFitness, detachFitness, fitnessSources } from './fitness.js'
import { parseAppleHealth, mergeImport } from './import-csv.js'

const at = (iso, hh = 18, mm = 0) => new Date(`${iso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`).getTime()
const S0 = over => ({ unit: 'kg', height: 180, bodyweight: [], measurements: {}, workouts: [], ...over })

describe('Health V2 — evolution', () => {
  const S = S0({
    bodyweight: [{ d: '2025-09-20', w: 86 }, { d: '2026-03-24', w: 84 }, { d: '2026-08-25', w: 82.6 }, { d: '2026-09-20', w: 82.4, src: 'scan' }],
    measurements: {
      muscleMass: [{ d: '2026-03-24', v: 34.9 }, { d: '2026-09-20', v: 36.8, src: 'scan' }],
      bodyFat: [{ d: '2026-09-20', v: 18.2 }],
      visceralFat: [{ d: '2026-03-24', v: 9 }, { d: '2026-09-20', v: 8 }],
      segMuscleArmL: [{ d: '2026-03-24', v: 3.6 }, { d: '2026-09-20', v: 3.8 }],
      segFatArmL: [{ d: '2026-03-24', v: 18.3 }, { d: '2026-09-20', v: 17.2 }],
    },
  })
  const today = '2026-09-20'
  it('only metrics that exist, weight first', () => {
    expect(availableMetrics(S)).toEqual(['weight', 'bodyFat', 'muscleMass', 'visceralFat'])
    expect(availableMetrics(S0())).toEqual([])
  })
  it('1m/3m/6m/1y/all: points in range, first vs last, delta and % only when meaningful', () => {
    expect(RANGES.map(r => r.key)).toEqual(['1m', '3m', '6m', '1y', 'all'])
    const m6 = metricSummary(S, 'muscleMass', '6m', today)
    expect(m6).toMatchObject({ delta: 1.9, start: { v: 34.9 }, end: { v: 36.8 } })
    expect(m6.pct).toBeCloseTo(5.4)
    expect(metricSummary(S, 'weight', '1m', today)).toMatchObject({ delta: -0.2 })
    expect(metricSummary(S, 'weight', '1y', today).points).toHaveLength(4)
    expect(metricSummary(S, 'weight', '1y', today)).toMatchObject({ delta: -3.6 })
    expect(metricSummary(S, 'bodyFat', '6m', today)).toMatchObject({ delta: null })          // one reading: no fake change
    expect(metricSummary(S, 'visceralFat', '6m', today).pct).toBeNull()                        // a rating, not a quantity
    expect(metricSummary(S, 'muscleMass', '1m', today)).toMatchObject({ delta: null, current: { v: 36.8, src: 'scan' } })
    expect(metricSummary(S, 'nope', '6m', today)).toBeNull()
  })
  it('compares two measurement days without calling anything better or worse', () => {
    expect(scanDates(S)).toEqual(['2026-03-24', '2026-09-20'])
    const rows = compareMeasurements(S, '2026-09-20', '2026-03-24')        // order-insensitive
    expect(rows.find(r => r.key === 'weight')).toMatchObject({ a: 84, b: 82.4, delta: -1.6 })
    expect(rows.find(r => r.key === 'muscleMass')).toMatchObject({ delta: 1.9 })
    expect(rows.find(r => r.key === 'bodyFat')).toBeUndefined()           // only on one of the days
    expect(Object.keys(rows[0])).not.toContain('verdict')
  })
  it('segments: latest and change per zone, neutral, only where data exists', () => {
    expect(hasSegments(S)).toBe(true)
    const armL = segmentSummary(S, '6m', today).find(s => s.key === 'armL')
    expect(armL).toMatchObject({ has: true, muscle: { delta: 0.2 }, fat: { delta: -1.1 } })
    expect(segmentSummary(S, '6m', today).find(s => s.key === 'legR').has).toBe(false)
    expect(hasSegments(S0())).toBe(false)
  })
  it('BMI is calculated and needs height + weight', () => {
    expect(bmiOf(S)).toBeCloseTo(25.4)
    expect(bmiOf(S0({ bodyweight: [{ d: '2026-01-01', w: 80 }], height: null }))).toBeNull()
  })
})

describe('Fitness — sources, zones and honest totals', () => {
  it('reads legacy w.hrZones as a 2J-derived Apple Health summary', () => {
    expect(fitnessOf({ hrZones: { avg: 130, max: 170, z: [1, 2, 3, 4, 5] } })).toMatchObject({ source: 'apple', avgHr: 130, zones: { derived: true } })
    expect(fitnessOf({})).toBeNull()
  })
  it('HR samples → avg/max/zones against max HR, gaps capped', () => {
    const t0 = at('2026-09-20')
    const r = summarizeHr([{ t: t0, v: 100 }, { t: t0 + 60e3, v: 150 }, { t: t0 + 120e3, v: 180 }, { t: t0 + 60 * 60e3, v: 120 }], 190)
    expect(r).toMatchObject({ avgHr: 138, maxHr: 180, zones: { derived: true, scheme: 'hrmax' } })
    expect(r.zones.mins.reduce((a, b) => a + b, 0)).toBe(7)             // 1 + 1 + capped 5
    expect(summarizeHr([], 190)).toBeNull()
    expect(summarizeHr([{ t: t0, v: 120 }], null).zones).toBeNull()
    const acc = hrAccumulator(190); acc.add(120, t0); acc.add(160, t0 + 60e3); acc.add(0, t0 + 70e3)
    expect(acc.result()).toMatchObject({ avgHr: 140, maxHr: 160, samples: 2 })
    expect(maxHrFor({ hrMax: 185 })).toEqual({ value: 185, kind: 'declared' })
    expect(maxHrFor({ birthDate: 'x' }, () => 40)).toEqual({ value: 180, kind: 'calculated' })
    expect(maxHrFor({}, () => null)).toBeNull()
  })
  it('WHOOP: kJ → kcal, its own zones kept as source zones; unscored ignored', () => {
    const rec = mapWhoopWorkout({ id: 'abc', start: '2026-09-20T16:01:00Z', end: '2026-09-20T17:10:00Z', sport_name: 'weightlifting', score_state: 'SCORED',
      score: { kilojoule: 2033.4, average_heart_rate: 142, max_heart_rate: 181, strain: 12.3, zone_durations: { zone_zero_milli: 60000, zone_one_milli: 240000, zone_two_milli: 960000, zone_three_milli: 1500000, zone_four_milli: 1080000, zone_five_milli: 240000 } } })
    expect(rec).toMatchObject({ source: 'whoop', externalId: 'abc', calories: 486, avgHr: 142, maxHr: 181, zones: { mins: [1, 4, 16, 25, 18, 4], scheme: 'source', derived: false } })
    expect(mapWhoopWorkout({ id: 'x', score_state: 'PENDING_SCORE', start: 'a', end: 'b' })).toBeNull()
  })
  it('native-bridge contracts: Health Connect origin (Zepp) and HealthKit source', () => {
    const hc = mapHealthConnectSession({ metadata: { id: 'hc1', dataOrigin: { packageName: 'com.huami.watch.hmwatchmanager' } }, startTime: '2026-09-20T16:03:00Z', endTime: '2026-09-20T17:08:00Z', aggregates: { activeCaloriesKcal: 486.4, hrAvg: 142.2, hrMax: 181 } })
    expect(hc).toMatchObject({ source: 'healthconnect', origin: 'Zepp', calories: 486, caloriesKind: 'active', avgHr: 142 })
    expect(mapHealthConnectSession({ metadata: { dataOrigin: { packageName: 'com.unknown.app' } }, startTime: 1, endTime: 2 }).origin).toBe('com.unknown.app')
    const hk = mapHealthKitWorkout({ uuid: 'u1', startDate: '2026-09-20T16:03:00Z', endDate: '2026-09-20T17:08:00Z', activeEnergyKcal: 500, hrAvg: 140, hrMax: 178, sourceRevision: { source: { name: 'Apple Watch', bundleIdentifier: 'com.apple.health' } } })
    expect(hk).toMatchObject({ source: 'healthkit', origin: 'Apple Watch', calories: 500 })
  })
  describe('matching activity ↔ 2J workout', () => {
    const w1 = { id: 'w1', d: '2026-09-20', start: at('2026-09-20', 18, 3), end: at('2026-09-20', 19, 8), entries: [] }
    const w2 = { id: 'w2', d: '2026-09-21', start: at('2026-09-21', 18, 0), end: at('2026-09-21', 19, 0), entries: [] }
    const rec = (s, e, id = 'a1') => ({ source: 'whoop', externalId: id, start: s, end: e, calories: 400 })
    it('exact/near-exact overlap → match', () => {
      expect(matchActivity([w1, w2], rec(at('2026-09-20', 18, 1), at('2026-09-20', 19, 10)))).toMatchObject({ status: 'match', workoutId: 'w1' })
    })
    it('two plausible workouts → ambiguous; weak overlap → ambiguous; nothing → none', () => {
      const a = { ...w1, id: 'a', start: at('2026-09-20', 18, 0), end: at('2026-09-20', 18, 40) }
      const b = { ...w1, id: 'b', start: at('2026-09-20', 18, 30), end: at('2026-09-20', 19, 10) }
      expect(matchActivity([a, b], rec(at('2026-09-20', 18, 10), at('2026-09-20', 19, 0))).status).toBe('ambiguous')
      expect(matchActivity([w1], rec(at('2026-09-20', 17, 0), at('2026-09-20', 18, 40))).status).toBe('ambiguous')
      expect(matchActivity([w1, w2], rec(at('2026-09-22', 8), at('2026-09-22', 9))).status).toBe('none')
    })
    it('attach is idempotent, never duplicates, never sums, and can be undone', () => {
      const w = { ...w1 }
      const r = rec(at('2026-09-20', 18, 1), at('2026-09-20', 19, 10))
      attachFitness(w, r); attachFitness(w, { ...r, calories: 410 })
      expect(fitnessSources(w)).toHaveLength(1)
      expect(fitnessOf(w).calories).toBe(410)
      expect(matchActivity([w], r)).toMatchObject({ status: 'linked', workoutId: 'w1' })
      attachFitness(w, { source: 'apple', externalId: 'x', start: r.start, end: r.end, calories: 480 })
      expect(fitnessOf(w)).toMatchObject({ source: 'apple', calories: 480 })             // hub leads
      expect(w.fitness.others.map(o => o.source)).toEqual(['whoop'])
      detachFitness(w, 'apple', 'x')
      expect(fitnessOf(w).source).toBe('whoop')
      detachFitness(w, 'whoop', 'a1')
      expect(w.fitness).toBeUndefined()
      const all = matchAll([w1, w2], [r, rec(at('2026-09-23', 8), at('2026-09-23', 9), 'a2'), null])
      expect([all.match.length, all.none.length]).toEqual([1, 1])
    })
  })
  it('weekly activity: calories only as recorded — never extrapolated', () => {
    const w = (id, d, kcal) => ({ id, d, start: at(d), end: at(d) + 3600e3, entries: [], ...(kcal ? { fitness: { primary: { source: 'whoop', calories: kcal } } } : {}) })
    const S = S0({ workouts: [w('a', '2026-09-21', 500), w('b', '2026-09-22', 432), w('c', '2026-09-23'), w('d', '2026-09-24')] })
    expect(weekActivity(S, '2026-09-24')).toEqual({ workouts: 4, durationMs: 4 * 3600e3, kcal: 932, kcalSessions: 2 })
    expect(weekActivity(S0(), '2026-09-24')).toMatchObject({ workouts: 0, kcal: null, kcalSessions: 0 })
  })
})

describe('Apple Health export — watch workouts', () => {
  const xml = `<?xml version="1.0"?><HealthData>
<Record type="HKQuantityTypeIdentifierStepCount" sourceName="iPhone" unit="count" startDate="2026-09-20 08:00:00 +0200" endDate="2026-09-20 08:10:00 +0200" value="500"/>
<Workout workoutActivityType="HKWorkoutActivityTypeTraditionalStrengthTraining" duration="66" durationUnit="min" sourceName="Apple Watch de Ana" startDate="2026-09-20 18:01:00 +0200" endDate="2026-09-20 19:10:00 +0200">
 <WorkoutStatistics type="HKQuantityTypeIdentifierActiveEnergyBurned" startDate="2026-09-20 18:01:00 +0200" endDate="2026-09-20 19:10:00 +0200" sum="486.2" unit="Cal"/>
 <WorkoutStatistics type="HKQuantityTypeIdentifierHeartRate" startDate="2026-09-20 18:01:00 +0200" endDate="2026-09-20 19:10:00 +0200" average="142.4" minimum="88" maximum="181" unit="count/min"/>
</Workout>
<Workout workoutActivityType="HKWorkoutActivityTypeWalking" sourceName="Zepp" totalEnergyBurned="120" totalEnergyBurnedUnit="kcal" startDate="2026-09-21 09:00:00 +0200" endDate="2026-09-21 09:40:00 +0200"/>
</HealthData>`
  it('reads calories/HR/source, then attaches only the clear match, idempotently', () => {
    const p = parseAppleHealth(xml, {})
    expect(p.appleWorkouts).toHaveLength(2)
    expect(p.appleWorkouts[0]).toMatchObject({ kcal: 486.2, avgHr: 142.4, maxHr: 181, sourceName: 'Apple Watch de Ana' })
    expect(p.appleWorkouts[1]).toMatchObject({ kcal: 120, sourceName: 'Zepp' })
    const w = { id: 'w1', d: '2026-09-20', start: Date.parse('2026-09-20T18:03:00+02:00'), end: Date.parse('2026-09-20T19:08:00+02:00'), entries: [] }
    const S = S0({ workouts: [w], steps: [], sleep: [], restingHR: [] })
    const res = mergeImport(S, p)
    expect(res).toMatchObject({ fitnessLinked: 1 })
    expect(fitnessOf(S.workouts[0])).toMatchObject({ source: 'apple', origin: 'Apple Watch de Ana', calories: 486, avgHr: 142, maxHr: 181 })
    mergeImport(S, parseAppleHealth(xml, {}))
    expect(fitnessSources(S.workouts[0])).toHaveLength(1)
    expect(mapAppleWorkout({ start: 5, end: 1 })).toBeNull()
  })
})
