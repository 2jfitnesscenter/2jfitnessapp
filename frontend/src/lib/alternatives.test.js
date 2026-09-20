import { describe, it, expect } from 'vitest'
import { getExerciseAlternatives, QUICK_FILTERS } from './alternatives.js'
import { setHiddenExercises } from './exercises.js'

const BENCH = '0025'          // barbell bench press — tg: pectorals, eq: barbell
const DECLINE_BENCH = '0033'   // barbell decline bench press — tg: pectorals, eq: barbell (exact match)
const DUMBBELL_PUSHUP = '1274' // deep push up — tg: pectorals, eq: dumbbell
const CABLE_BENCH = '0151'     // cable bench press — tg: pectorals, eq: cable
const TRICEP_DIP = '0019'      // assisted triceps dip — tg: triceps, sm includes chest/shoulders

const baseS = (over = {}) => ({ customEx: [], ...over })

describe('getExerciseAlternatives', () => {
  it('never includes the exercise itself', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    expect(alts.some(a => a.ex.id === BENCH)).toBe(false)
  })

  it('labels the same muscle + same equipment as an exact match', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const decline = alts.find(a => a.ex.id === DECLINE_BENCH)
    expect(decline).toBeTruthy()
    expect(decline.matchKey).toBe('exact')
    expect(decline.sameEquipment).toBe(true)
  })

  it('labels same muscle + different equipment as sameMuscle, not exact', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const cable = alts.find(a => a.ex.id === CABLE_BENCH)
    expect(cable).toBeTruthy()
    expect(cable.matchKey).toBe('sameMuscle')
    expect(cable.sameEquipment).toBe(false)
  })

  it('same primary muscle, different equipment -> sameMuscle', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const pushup = alts.find(a => a.ex.id === DUMBBELL_PUSHUP)
    expect(pushup).toBeTruthy()
    expect(pushup.matchKey).toBe('sameMuscle')
    expect(pushup.sameEquipment).toBe(false)
  })

  it('no shared primary muscle but real secondary overlap -> related', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const dip = alts.find(a => a.ex.id === TRICEP_DIP)
    expect(dip).toBeTruthy()
    expect(dip.matchKey).toBe('related')
  })

  it('ranks same-muscle matches above merely-related ones', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const pushupIdx = alts.findIndex(a => a.ex.id === DUMBBELL_PUSHUP)
    const dipIdx = alts.findIndex(a => a.ex.id === TRICEP_DIP)
    expect(pushupIdx).toBeGreaterThanOrEqual(0)
    expect(dipIdx).toBeGreaterThan(pushupIdx)
  })

  it('is empty for an unknown exercise id', () => {
    expect(getExerciseAlternatives(baseS(), 'nope-not-real')).toEqual([])
  })

  // V1.2 — the "Replace exercise" picker must never offer a candidate the gym itself has
  // hidden (out of equipment, retired from the floor), same rule allExercises() already
  // enforces for every other picker in the app.
  it('never offers a candidate the gym has hidden', () => {
    setHiddenExercises([DECLINE_BENCH])
    const alts = getExerciseAlternatives(baseS(), BENCH)
    setHiddenExercises([])
    expect(alts.some(a => a.ex.id === DECLINE_BENCH)).toBe(false)
  })
})

describe('QUICK_FILTERS', () => {
  it('covers the four pills the brief asks for', () => {
    expect(QUICK_FILTERS.map(f => f.key)).toEqual(['same', 'dumbbell', 'cable', 'machine'])
  })
})
