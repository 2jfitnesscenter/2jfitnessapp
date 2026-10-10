import { describe, expect, it } from 'vitest'
import { normalizeGoals, goalOf, withGoal, validTarget, goalStatus, referenceRange, GOAL_KEYS } from './composition-goals.js'

const TODAY = '2026-10-12'
const bw = pairs => pairs.map(([d, w]) => ({ d, w }))
const m = pairs => pairs.map(([d, v]) => ({ d, v, t: 1 }))
const S = (over = {}) => ({ unit: 'kg', height: 178, birthDate: '1990-05-04', body: 'male', bodyweight: bw([['2026-07-20', 84], ['2026-08-30', 82.5], ['2026-10-10', 81]]),
  measurements: { bodyFat: m([['2026-07-21', 21], ['2026-10-09', 18.6]]), muscleMass: m([['2026-07-21', 36], ['2026-10-09', 36.2]]) }, ...over })

describe('goals', () => {
  it('covers the three existing metrics; weight is the existing target weight, the others live in S.compGoals', () => {
    expect(GOAL_KEYS).toEqual(['weight', 'bodyFat', 'muscleMass'])
    expect(goalOf(S({ targetW: 78 }), 'weight')).toEqual({ target: 78, at: null })
    expect(goalOf(S(), 'weight')).toBeNull()
    expect(goalOf(S({ compGoals: { bodyFat: { target: 15, at: '2026-10-01' } } }), 'bodyFat')).toEqual({ target: 15, at: '2026-10-01' })
  })
  it('sets and removes a goal without touching the others; values outside the limits are refused', () => {
    let g = withGoal(S(), 'bodyFat', 15, TODAY)
    expect(g).toEqual({ bodyFat: { target: 15, at: TODAY } })
    g = withGoal(S({ compGoals: g }), 'muscleMass', 38, TODAY)
    expect(Object.keys(g).sort()).toEqual(['bodyFat', 'muscleMass'])
    expect(withGoal(S({ compGoals: g }), 'bodyFat', null)).toEqual({ muscleMass: { target: 38, at: TODAY } })
    expect(withGoal(S({ compGoals: g }), 'bodyFat', 1)).toEqual(g)
    expect(withGoal(S({ compGoals: g }), 'bodyFat', 'x')).toEqual(g)
    expect(validTarget('bodyFat', 15)).toBe(true); expect(validTarget('bodyFat', 80)).toBe(false); expect(validTarget('muscleMass', 5)).toBe(false); expect(validTarget('weight', 75)).toBe(true)
  })
  it('garbage in S.compGoals is ignored', () => {
    expect(normalizeGoals({ bodyFat: { target: 'abc' }, muscleMass: 5, other: { target: 3 }, x: null })).toEqual({})
    expect(normalizeGoals(undefined)).toEqual({}); expect(normalizeGoals('x')).toEqual({})
  })
})

describe('status and trend', () => {
  it('weight going down toward a lower target is "toward", with what remains and progress from the start of the goal', () => {
    const s = goalStatus(S({ targetW: 78 }), 'weight', TODAY)
    expect(s.state).toBe('toward'); expect(s.needed).toBe('down'); expect(s.remaining).toBe(-3); expect(s.current.v).toBe(81); expect(s.delta).toBeLessThan(0)
    expect(s.progressPct).toBeGreaterThan(0); expect(s.progressPct).toBeLessThan(100)
  })
  it('the same trend against a higher target is "away"; no movement is "flat"', () => {
    expect(goalStatus(S({ targetW: 90 }), 'weight', TODAY).state).toBe('away')
    const flat = S({ targetW: 78, bodyweight: bw([['2026-08-01', 81], ['2026-10-10', 81.1]]) })
    expect(goalStatus(flat, 'weight', TODAY).state).toBe('flat')
  })
  it('reaching the goal (within tolerance, from either side) is "reached"', () => {
    expect(goalStatus(S({ compGoals: { bodyFat: { target: 18.5, at: '2026-07-01' } } }), 'bodyFat', TODAY).state).toBe('reached')
    expect(goalStatus(S({ targetW: 81.3 }), 'weight', TODAY).state).toBe('reached')
  })
  it('muscle mass up toward a higher target; body fat down toward a lower one', () => {
    expect(goalStatus(S({ compGoals: { muscleMass: { target: 38, at: '2026-07-01' } } }), 'muscleMass', TODAY).needed).toBe('up')
    const bf = goalStatus(S({ compGoals: { bodyFat: { target: 15, at: '2026-07-01' } } }), 'bodyFat', TODAY)
    expect([bf.state, bf.needed]).toEqual(['toward', 'down'])
  })
  it('empty values: no readings → no-data (goal kept); one reading or readings days apart → few-data, no trend claimed; nothing at all → null', () => {
    expect(goalStatus({ unit: 'kg', compGoals: { bodyFat: { target: 15 } } }, 'bodyFat', TODAY)).toMatchObject({ state: 'no-data', target: 15, current: null })
    const one = goalStatus(S({ bodyweight: bw([['2026-10-10', 81]]), targetW: 78 }), 'weight', TODAY)
    expect(one.state).toBe('few-data'); expect(one.delta).toBeNull(); expect(one.remaining).toBe(-3)
    const close = goalStatus(S({ bodyweight: bw([['2026-10-05', 83], ['2026-10-10', 81]]), targetW: 78 }), 'weight', TODAY)
    expect(close.state).toBe('few-data'); expect(close.delta).toBeNull()
    expect(goalStatus({ unit: 'kg' }, 'muscleMass', TODAY)).toBeNull()
  })
  it('a metric with readings but no goal still reports its trend (no target, no verdict)', () => {
    const s = goalStatus(S(), 'bodyFat', TODAY)
    expect(s.target).toBeNull(); expect(s.remaining).toBeNull(); expect(s.delta).toBeLessThan(0); expect(['flat', 'toward', 'away']).not.toContain(undefined)
  })
})

describe('reference ranges only where a documented basis exists', () => {
  it('weight → BMI with the WHO band, for adults with height and birth date', () => {
    const r = referenceRange(S({ bodyweight: bw([['2026-10-10', 78]]) }), 'weight', TODAY)
    expect(r).toMatchObject({ kind: 'band', basis: 'WHO (adults)', unit: 'BMI' }); expect(r.band.id).toBe('normal'); expect(r.value).toBeCloseTo(24.6, 1)
    expect(referenceRange(S(), 'weight', TODAY).band.id).toBe('over')           // 81 kg at 178 cm = BMI 25.6
    const over = referenceRange(S({ bodyweight: bw([['2026-10-10', 92]]) }), 'weight', TODAY)
    expect(over.band.id).toBe('over')
    expect(referenceRange(S({ bodyweight: bw([['2026-10-10', 50]]) }), 'weight', TODAY).band.id).toBe('under')
    expect(referenceRange(S({ bodyweight: bw([['2026-10-10', 100]]) }), 'weight', TODAY).band.id).toBe('high')
  })
  it('body fat → the ACE band for the person\'s sex; no reading → no range', () => {
    expect(referenceRange(S(), 'bodyFat', TODAY).band.id).toBe('average')           // 18.6 %, male
    expect(referenceRange(S({ body: 'female' }), 'bodyFat', TODAY).band.id).toBe('athletes')  // 18.6 %: the female athletes band is 14–20 %
    expect(referenceRange(S({ measurements: {} }), 'bodyFat', TODAY)).toEqual({ kind: 'none', why: 'no-reading' })
  })
  it('muscle mass has no accepted range: none is shown', () => {
    expect(referenceRange(S(), 'muscleMass', TODAY)).toEqual({ kind: 'none', why: 'muscle' })
  })
  it('without a birth date it asks instead of guessing; minors get nothing; no height → asks for it', () => {
    expect(referenceRange(S({ birthDate: null }), 'weight', TODAY)).toEqual({ kind: 'needs', need: 'birthDate' })
    expect(referenceRange(S({ birthDate: null }), 'bodyFat', TODAY)).toEqual({ kind: 'needs', need: 'birthDate' })
    expect(referenceRange(S({ birthDate: '2012-01-01' }), 'weight', TODAY)).toEqual({ kind: 'none', why: 'adult-only' })
    expect(referenceRange(S({ height: null }), 'weight', TODAY)).toEqual({ kind: 'needs', need: 'height' })
  })
  it('every band has a text label and a numeric text, so colour is never the only signal', () => {
    for (const body of ['male', 'female']) for (const v of [3, 9, 16, 22, 40]) {
      const r = referenceRange(S({ body, measurements: { bodyFat: m([['2026-10-09', v]]) } }), 'bodyFat', TODAY)
      expect(r.band.label.length).toBeGreaterThan(3); expect(r.band.text).toMatch(/\d/)
    }
  })
})
