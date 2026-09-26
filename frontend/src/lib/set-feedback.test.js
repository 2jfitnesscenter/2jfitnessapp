import { describe, expect, it } from 'vitest'
import { nextSetSuggestion, feedbackIndex, setFeeling, acceptSuggestion, keepPlannedLoad, repTarget } from './set-feedback.js'

const S2J = { use2JRoomEquipment: true }
const SCustom = { use2JRoomEquipment: false, customIncrements: { barbell: 5, dumbbell: 2, machineOther: 5 } }
const target = { sets: 3, reps: 10, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps' }
// Set 1 finished with `first`, sets 2 and 3 still planned at `w`.
const entry = (first, w = first.w) => ({ id: 'x', target: { ...target }, sets: [
  { done: true, ...first }, { w, r: 10, done: false }, { w, r: 10, done: false }] })
const sug = (S, e, eq = 'barbell') => nextSetSuggestion(S, e, 0, eq)

describe('Series Feedback V1 — deterministic next-set suggestion', () => {
  it('very easy with every rep done: one real step up, for the next set only', () => {
    const e = entry({ w: 80, r: 10, feel: 'easy' })
    expect(sug(S2J, e)).toMatchObject({ nextIdx: 1, from: 80, to: 85, kind: 'up' })
  })
  it('very easy but short of the top of the range: keep the load (no suggestion)', () => {
    expect(sug(S2J, entry({ w: 80, r: 9, feel: 'easy' }))).toBeNull()
  })
  it('a logged RPE ≥ 9 or RIR ≤ 1 brakes "very easy": RPE is read, never rewritten', () => {
    const e = entry({ w: 80, r: 10, feel: 'easy', rpe: 9.5 })
    expect(sug(S2J, e)).toBeNull()
    expect(e.sets[0].rpe).toBe(9.5)
    expect(sug(S2J, entry({ w: 80, r: 10, feel: 'easy', rir: 1 }))).toBeNull()
  })
  it('good: keep the load', () => {
    expect(sug(S2J, entry({ w: 80, r: 10, feel: 'good' }))).toBeNull()
  })
  it('hard: keep within the range, one step down only below it', () => {
    expect(sug(S2J, entry({ w: 80, r: 8, feel: 'hard' }))).toBeNull()
    expect(sug(S2J, entry({ w: 80, r: 6, feel: 'hard' }))).toMatchObject({ from: 80, to: 75, kind: 'down' })
  })
  it('couldn’t: about 10 % lighter on a load the equipment can make', () => {
    expect(sug(S2J, entry({ w: 100, r: 4, feel: 'fail' }))).toMatchObject({ to: 90, kind: 'down' })
    // small load: at least one real step down
    expect(sug(S2J, entry({ w: 20, r: 3, feel: 'fail' }))).toMatchObject({ to: 15 })
  })
  it('real equipment increments: 2J dumbbell rack, 2J machine stack, custom increments', () => {
    expect(sug(S2J, entry({ w: 40, r: 10, feel: 'easy' }), 'dumbbell')).toBeNull()          // top of the rack
    expect(sug(S2J, entry({ w: 20, r: 10, feel: 'easy' }), 'dumbbell')).toMatchObject({ to: 22.5 })
    expect(sug(S2J, entry({ w: 12.5, r: 10, feel: 'easy' }), 'dumbbell')).toMatchObject({ to: 15 })
    expect(sug(S2J, entry({ w: 40, r: 10, feel: 'easy' }), 'machine')).toMatchObject({ to: 45 })
    expect(sug(SCustom, entry({ w: 20, r: 10, feel: 'easy' }), 'dumbbell')).toMatchObject({ to: 22 })
  })
  it('compares against the next set’s planned load, not the set just done', () => {
    // already planned heavier than the suggestion's base: suggestion is relative to it
    const e = entry({ w: 80, r: 10, feel: 'easy' }, 85)
    expect(sug(S2J, e)).toBeNull()
  })
  it('no feeling, no next working set, no load, or a warmup ⇒ nothing', () => {
    expect(sug(S2J, entry({ w: 80, r: 10 }))).toBeNull()
    const last = { target, sets: [{ w: 80, r: 10, done: true }, { w: 80, r: 10, done: true, feel: 'easy' }] }
    expect(nextSetSuggestion(S2J, last, 1, 'barbell')).toBeNull()
    expect(sug(S2J, entry({ w: 0, r: 10, feel: 'easy' }))).toBeNull()
    const warm = { target, sets: [{ w: 40, r: 10, done: true, type: 'warmup' }, { w: 80, r: 10, done: false }] }
    expect(feedbackIndex(warm, 'reps')).toBe(-1)
  })
  it('accept changes only the next working set; keep/ignore changes nothing', () => {
    const e = entry({ w: 80, r: 10, feel: 'easy' })
    const before = JSON.parse(JSON.stringify(e))
    const s = sug(S2J, e)
    keepPlannedLoad(e, 0)
    expect(e.sets.map(x => x.w)).toEqual([80, 80, 80])
    expect(e.target).toEqual(before.target)
    acceptSuggestion(e, 0, s)
    expect(e.sets.map(x => x.w)).toEqual([80, 85, 80])
    expect(e.target).toEqual(before.target)
    expect(e.sets[0].fbDone).toBe('accepted')
    expect(feedbackIndex(e, 'reps')).toBe(-1)
  })
  it('the row asks after the latest finished working set, and only in reps mode', () => {
    const e = entry({ w: 80, r: 10 })
    expect(feedbackIndex(e, 'reps')).toBe(0)
    expect(feedbackIndex(e, 'time')).toBe(-1)
    setFeeling(e, 0, 'good')
    expect(e.sets[0].feel).toBe('good')
    setFeeling(e, 0, 'nonsense')
    expect(e.sets[0].feel).toBe('good')
  })
  it('legacy sets and targets without the new fields keep working', () => {
    expect(repTarget({ target: { reps: 12 } })).toEqual([12, 12])
    expect(repTarget({})).toBeNull()
    const legacy = { id: 'x', sets: [{ w: 50, r: 8, done: true }, { w: 50, r: 8, done: false }] }
    expect(feedbackIndex(legacy, 'reps')).toBe(0)
    expect(nextSetSuggestion(S2J, legacy, 0, 'barbell')).toBeNull()
    legacy.sets[0].feel = 'easy'
    expect(nextSetSuggestion(S2J, legacy, 0, 'barbell')).toMatchObject({ to: 55 })
  })
})
