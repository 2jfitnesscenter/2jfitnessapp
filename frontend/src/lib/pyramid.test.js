import { describe, it, expect } from 'vitest'
import { buildSets, pyramidWeights } from './history.js'
import { readSession, nextPrescription, sessionsFor, applyPrescription } from './progression.js'
import { EXDB } from './exercises.js'

// Pyramid sets: optional, off by default, stored as one optional boolean on a routine entry
// (`pyramid: true`). Absent or false must read exactly as before everywhere.
const LIFT = EXDB.find(e => e.bp !== 'cardio' && !['upper legs', 'lower legs', 'back', 'hips', 'glutes'].includes(e.bp)).id
const FINE = { use2JRoomEquipment: false, customIncrements: { barbell: 0.5, dumbbell: 0.5, machineOther: 0.5 } }
const S_KG = { workouts: [], exWeights: {}, warmupEnabled: false, unit: 'kg', ...FINE }

const weightsOf = sets => sets.map(s => s.w)

describe('pyramidWeights (scheme)', () => {
  it('climbs to the peak in the middle and comes back down: 90 / 100 / 90 for three sets', () => {
    expect(pyramidWeights(100, 3, 'kg')).toEqual([90, 100, 90])
  })

  it('five sets step 10 % per set away from the peak: 80 / 90 / 100 / 90 / 80', () => {
    expect(pyramidWeights(100, 5, 'kg')).toEqual([80, 90, 100, 90, 80])
  })

  it('an even count peaks at floor(n/2): two sets 90 then 100, four sets 80 / 90 / 100 / 90', () => {
    expect(pyramidWeights(100, 2, 'kg')).toEqual([90, 100])
    expect(pyramidWeights(100, 4, 'kg')).toEqual([80, 90, 100, 90])
  })

  it('a single set is just the peak', () => {
    expect(pyramidWeights(61.3, 1, 'kg')).toEqual([61.3])
  })

  it('snaps to loadable steps: 2.5 kg for kilograms, 5 lb for pounds', () => {
    expect(pyramidWeights(80, 3, 'kg')).toEqual([72.5, 80, 72.5])
    expect(pyramidWeights(100, 3, 'lb')).toEqual([90, 100, 90])
  })

  it('never goes below one plate step, and a bodyweight peak stays at zero', () => {
    expect(pyramidWeights(5, 3, 'kg')).toEqual([5, 5, 5])
    expect(pyramidWeights(0, 3, 'kg')).toEqual([0, 0, 0])
  })
})

describe('buildSets pyramid option', () => {
  it('is off by default: targets are the same as a record with no field at all', () => {
    const plain = buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 100 })
    expect(plain).toEqual([{ w: 100, r: 8, done: false }, { w: 100, r: 8, done: false }, { w: 100, r: 8, done: false }])
    expect(buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 100, pyramid: false })).toEqual(plain)
  })

  it('when on, the working loads follow the scheme and the reps stay put', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 100, pyramid: true })).toEqual([
      { w: 90, r: 8, done: false }, { w: 100, r: 8, done: false }, { w: 90, r: 8, done: false },
    ])
  })

  it('replaces back-off when both are on, so the two never stack', () => {
    expect(weightsOf(buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 100, pyramid: true, backoff: true })))
      .toEqual([90, 100, 90])
  })

  it('a dropset still lands after the lighter last set', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 3, reps: 8, weight: 100, pyramid: true, dropset: true }).at(-1))
      .toEqual({ w: 72.5, r: 8, done: false, type: 'drop' })
  })

  it('a bodyweight exercise (no load) is left alone', () => {
    expect(weightsOf(buildSets(S_KG, { id: LIFT, sets: 3, reps: 10, weight: 0, pyramid: true }))).toEqual([0, 0, 0])
  })

  it('a single set is not changed', () => {
    expect(buildSets(S_KG, { id: LIFT, sets: 1, reps: 8, weight: 100, pyramid: true })).toEqual([{ w: 100, r: 8, done: false }])
  })
})

// A finished workout as the app stores it. Only the fields the readers use are needed.
const session = (date, target, rows) => ({
  d: date,
  entries: [{ id: LIFT, target, sets: rows.map(([w, r]) => ({ w, r, rpe: 7, done: true })) }],
})
const stateWith = workouts => ({ ...S_KG, workouts })

describe('backward compatibility of stored data', () => {
  const oldTarget = { sets: 3, reps: 5, weight: 60 }
  const oldRows = [[60, 5], [60, 5], [60, 6]]

  it('an old finished workout reads exactly as it did before the field existed', () => {
    const entry = { id: LIFT, target: oldTarget, sets: oldRows.map(([w, r]) => ({ w, r, rpe: 7, done: true })) }
    const withExplicitOff = { ...entry, target: { ...oldTarget, pyramid: false } }
    expect(readSession(entry, oldTarget)).toEqual(readSession(withExplicitOff, oldTarget))
    expect(readSession(entry, oldTarget).ok).toBe(true)
  })

  it('an old routine entry without the field prescribes the same sets as one with pyramid false', () => {
    const S = stateWith([session('2026-01-01', oldTarget, oldRows)])
    const cfg = { id: LIFT, sets: 3, reps: 5, prog: 'linear', inc: 2.5 }
    expect(nextPrescription(S, cfg, null)).toEqual(nextPrescription(S, { ...cfg, pyramid: false }, null))
  })
})

describe('progression is unaffected when the option is off', () => {
  const T = { sets: 3, reps: 5, weight: 60 }
  const history = stateWith([
    session('2026-01-01', T, [[60, 5], [60, 5], [60, 5]]),
    session('2026-01-02', T, [[60, 5], [60, 5], [60, 5]]),
    session('2026-01-03', T, [[60, 5], [60, 5], [60, 5]]),
  ])

  it('the same history gives the same next prescription with and without pyramid false', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5, prog: 'linear', inc: 2.5 }
    expect(nextPrescription(history, cfg, null)).toEqual(nextPrescription(history, { ...cfg, pyramid: false }, null))
    expect(nextPrescription(history, cfg, null).weight).toBeGreaterThan(60)
  })

  it('the same sessions are read the same way', () => {
    const cfg = { id: LIFT, sets: 3, reps: 5 }
    expect(sessionsFor(history, LIFT, cfg)).toEqual(sessionsFor(history, LIFT, { ...cfg, pyramid: false }))
  })

  it('when on, the next prescription moves the whole pyramid and keeps its shape', () => {
    const pyr = { ...T, pyramid: true }
    const prior = [[90, 5], [100, 5], [90, 5]]
    const S = stateWith([
      session('2026-01-01', pyr, prior),
      session('2026-01-02', pyr, prior),
      session('2026-01-03', pyr, prior),
    ])
    const p = nextPrescription(S, { id: LIFT, sets: 3, reps: 5, prog: 'linear', inc: 2.5, pyramid: true }, null)
    // Equipment may snap the load to its own steps, so assert the shape: the peak sits 10 kg above
    // the two outer sets, and the outer sets land on the new first-set load.
    const [a, b, c] = p.weights
    expect(a).toBe(p.weight)
    expect(b - a).toBe(10)
    expect(c).toBe(a)
    expect(a).toBeGreaterThan(90)
    const applied = applyPrescription(buildSets(S, { id: LIFT, sets: 3, reps: 5, pyramid: true }), p)
    expect(weightsOf(applied)).toEqual([a, b, c])
  })
})
