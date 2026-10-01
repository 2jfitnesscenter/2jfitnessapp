import { describe, it, expect } from 'vitest'
import { buildSets, workingLoadEvidence } from './history.js'
import { buildRoutineEntries, nextPrescription } from './progression.js'
import { recommendProgression, acceptRecommendation } from './overload.js'
import { intelligenceSignals } from './intelligence.js'
import { EXDB } from './exercises.js'

const id = EXDB.find(e => e.eq === 'barbell' && e.bp === 'chest').id
const cfg = { id, sets: 4, reps: 10, repsMin: 8, weight: 40, prog: 'double' }
const sets = (weights, extra = {}) => weights.map(w => ({ w, r: 10, done: true, rpe: 7, feel: 'good', ...extra }))
const state = (rows, extra = {}) => ({ unit: 'kg', warmupEnabled: false, exWeights: { [id]: { w: 55 } },
  workouts: rows.map((row, i) => ({ d: `2026-10-0${i + 1}`, entries: [{ id, target: cfg, sets: row }] })), ...extra })
const entry = { id, target: { ...cfg, targetRepsMin: 8, targetRepsMax: 10 } }
const loads = S => buildRoutineEntries(S, { ex: [cfg] })[0].sets.map(s => s.w)

describe('next-session starting load safety', () => {
  it('A: a single ramp begins at 40, never its 55kg maximum', () => {
    expect(loads(state([sets([40, 45, 50, 55])]))).toEqual([40, 45, 50, 55])
  })
  it('B/G: two supported exposures progress from the first work set and preserve the ramp', () => {
    expect(loads(state([sets([40, 45, 50, 55]), sets([40, 45, 50, 55])]))).toEqual([45, 50, 55, 60])
  })
  it.each(['hard', 'fail'])('C/E: first-set feedback %s prevents any increase', feel => {
    const row = sets([40, 45, 50, 55]); row[0].feel = feel
    expect(loads(state([row, row]))[0]).toBe(40)
    expect(recommendProgression(state([row, row]), entry, 'barbell').kind).toBe('hold')
  })
  it('D: an isolated heavy top set at RPE 10 cannot become the next starting load', () => {
    const row = sets([40, 45, 50, 55]); row[3] = { ...row[3], r: 5, rpe: 10 }
    expect(loads(state([row]))).toEqual([40, 45, 50, 55])
  })
  it('F: straight sets retain ordinary double progression with supported evidence', () => {
    expect(loads(state([sets([50, 50, 50, 50]), sets([50, 50, 50, 50])]))).toEqual([55, 55, 55, 55])
  })
  it('H: top-set/backoff preserves its actual first set and lighter backoff positions', () => {
    expect(loads(state([sets([80, 60, 60, 60])]))).toEqual([80, 60, 60, 60])
    const S = state([sets([80, 60, 60, 60]), sets([80, 60, 60, 60])])
    expect(loads(S)).toEqual([85, 65, 65, 65])
  })
  it('I: warmup/drop/unchecked sets are not the first completed work set', () => {
    const row = [{ w: 20, r: 10, done: true, type: 'warmup' }, { w: 30, r: 10, done: false },
      ...sets([40, 45, 50, 55]), { w: 25, r: 10, done: true, type: 'drop' }]
    expect(workingLoadEvidence(row).weight).toBe(40)
    expect(buildSets(state([row]), cfg).map(s => s.w)).toEqual([40, 45, 50, 55])
  })
  it('J: uses actual equipment/custom increments rather than universal 5kg', () => {
    const S = state([sets([40, 45, 50, 55]), sets([40, 45, 50, 55])], {
      use2JRoomEquipment: false, customIncrements: { barbell: 2.5, dumbbell: 2, machineOther: 5 } })
    expect(loads(S)).toEqual([42.5, 47.5, 52.5, 57.5])
    const row = sets([12.5, 15, 17.5, 20])
    expect(recommendProgression(state([row, row]), entry, 'dumbbell').w).toBe(15)
  })
  it('K: missing RPE/feedback repeats the ramp despite an old topWeight', () => {
    const row = sets([40, 45, 50, 55], { rpe: undefined, feel: undefined })
    expect(loads(state([row, row]))).toEqual([40, 45, 50, 55])
    expect(recommendProgression(state([row, row]), entry, 'barbell').kind).toBe('hold')
  })
  it('L: no history preserves the configured prescription and does not invent a gain', () => {
    expect(nextPrescription(state([]), cfg).kind).toBe('first')
  })
  it('RPE 9 of the first work set overrides positive feedback', () => {
    const row = sets([40, 45, 50, 55]); row[0].rpe = 9
    expect(loads(state([row, row]))[0]).toBe(40)
  })
  it('applying an optional recommendation preserves its ramp and leaves completed/warmup sets intact', () => {
    const S = state([sets([40, 45, 50, 55]), sets([40, 45, 50, 55])])
    const rec = recommendProgression(S, entry, 'barbell')
    const live = { ...entry, sets: [{ w: 20, r: 5, type: 'warmup', done: true }, ...sets([40, 45, 50, 55], { done: false })] }
    acceptRecommendation(live, rec, 'kg')
    expect(live.sets.map(s => s.w)).toEqual([20, 45, 50, 55, 60])
  })
  it('Intelligence receives first-working-load progression; PR maximum stays unchanged', () => {
    const now = Date.parse('2026-10-02T18:00:00Z')
    const S = state([sets([40, 45, 50, 55]), sets([40, 45, 50, 55])], {
      routines: [], programs: [], dayPlan: {}, week: {}, tests: [], bodyweight: [], restrictions: [] })
    const before = JSON.stringify(S.workouts)
    const signal = intelligenceSignals(S, { now }).find(s => s.type === 'PROGRESSION_READY')
    expect(signal?.facts?.next).toBe(45)
    expect(JSON.stringify(S.workouts)).toBe(before)
    expect(S.exWeights[id].w).toBe(55)
  })
})
