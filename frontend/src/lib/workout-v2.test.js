import { describe, it, expect } from 'vitest'
import { workoutPrefs, applyNewProfileDefaults, NEW_PROFILE_DEFAULTS, shouldShowWorkoutGuide } from './workout-prefs.js'
import { fieldsFor, stepField, parseField, keypadInput, canComplete, currentSetIdx, nextInUnit, platesApply, barFor } from './set-entry.js'
import { recommendProgression, recommendationFor, acceptRecommendation, keepPlan } from './overload.js'

const S0 = (over = {}) => ({ unit: 'kg', workouts: [], exWeights: {}, tests: [], use2JRoomEquipment: true, effort: 'rpe', ...over })
const bench = (sets, target = { sets: 3, reps: 10, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps' }) =>
  ({ id: 'bench', target, sets })
const logged = (d, sets, target) => ({ d, entries: [{ id: 'bench', target, sets: sets.map(([w, r, rpe]) => ({ w, r, done: true, ...(rpe != null ? { rpe } : {}) })) }] })
const fresh = (w = 80, r = 8) => [{ w, r, done: false }, { w, r, done: false }, { w, r, done: false }]

describe('workout preferences', () => {
  it('a profile saved before these existed keeps today\'s behaviour', () => {
    expect(workoutPrefs({ sound: true })).toEqual({
      view: 'detailed', images: true, tips: true, autoComplete: false,
      restAlert: true, sound: true, vibrate: true, progression: true,
    })
  })
  it('new-profile defaults are only written onto a profile with no workouts', () => {
    const fresh = applyNewProfileDefaults({ workouts: [], warmupEnabled: true, glass: false })
    expect(fresh).toMatchObject(NEW_PROFILE_DEFAULTS)
    expect(fresh).toMatchObject({ warmupEnabled: false, enableBioimpedanceReminder: false, enableTrainingZones: false, enableProgressiveOverloadCoach: false, glass: true })
    const existing = { workouts: [{ d: '2026-01-01', entries: [] }], warmupEnabled: true, glass: false }
    expect(applyNewProfileDefaults(existing)).toEqual({ workouts: existing.workouts, warmupEnabled: true, glass: false })
  })
  it('the guide appears only for a flagged new profile, before its first real workout', () => {
    expect(shouldShowWorkoutGuide({ workouts: [] })).toBe(false)                                   // existing profile: no flag
    expect(shouldShowWorkoutGuide({ workouts: [], workoutGuidePending: true })).toBe(true)
    expect(shouldShowWorkoutGuide({ workouts: [], workoutGuidePending: true }, { past: true })).toBe(false)
    expect(shouldShowWorkoutGuide({ workouts: [{}], workoutGuidePending: true })).toBe(false)
  })
})

describe('set entry pad rules', () => {
  it('walks weight → reps → effort for reps work, never requiring effort', () => {
    const f = fieldsFor(bench(fresh()), S0())
    expect(f.map(x => x.f)).toEqual(['w', 'r', 'rpe'])
    expect(f[2].opt).toBe(true)
    expect(fieldsFor(bench(fresh()), S0({ effort: 'none' })).map(x => x.f)).toEqual(['w', 'r'])
    expect(fieldsFor({ id: 'x', target: { mode: 'time' }, sets: [] }, S0()).map(x => x.f)).toEqual(['sec', 'w'])
    expect(fieldsFor({ id: 'x', target: { mode: 'cardio' }, sets: [] }, S0()).map(x => x.f)).toEqual(['min', 'speed'])
  })
  it('steps weight by the real equipment and effort by its own scale', () => {
    const [w, , rpe] = fieldsFor(bench(fresh()), S0())
    expect(stepField(S0(), 'barbell', w, 80, 1)).toBe(85)
    expect(stepField(S0(), 'dumbbell', w, 22.5, 1)).toBe(25)
    expect(stepField(S0({ use2JRoomEquipment: false, customIncrements: { barbell: 2.5 } }), 'barbell', w, 80, 1)).toBe(82.5)
    expect(stepField(S0(), 'barbell', rpe, null, -1)).toBeNull()
    expect(stepField(S0(), 'barbell', rpe, null, 1)).toBe(6)
  })
  it('keypad replaces on first key, handles decimals, back and limits', () => {
    expect(keypadInput('80', '7', { fresh: true })).toBe('7')
    expect(keypadInput('82', '.', {})).toBe('82.')
    expect(keypadInput('82.5', '.', {})).toBe('82.5')
    expect(keypadInput('10', '.', { dec: false })).toBe('10')
    expect(keypadInput('82.5', 'back', {})).toBe('82.')
    expect(keypadInput('0', '5', {})).toBe('5')
    expect(keypadInput('1.25', '5', {})).toBe('1.25')
    expect(parseField({ f: 'rpe', opt: true, effort: 'rpe' }, '')).toBeNull()
    expect(parseField({ f: 'rpe', opt: true, effort: 'rpe' }, '12')).toBe(10)
    expect(parseField({ f: 'w' }, '82,5')).toBe(82.5)
  })
  it('auto-complete needs reps and load (bodyweight needs only reps)', () => {
    const e = bench([])
    expect(canComplete(e, { w: 80, r: 10 }, 'barbell')).toBe(true)
    expect(canComplete(e, { w: 0, r: 10 }, 'barbell')).toBe(false)
    expect(canComplete(e, { w: 80, r: 0 }, 'barbell')).toBe(false)
    expect(canComplete(e, { w: 0, r: 12 }, 'body weight')).toBe(true)
    expect(canComplete({ id: 'x', target: { mode: 'time' } }, { sec: 0 }, 'body weight')).toBe(false)
  })
  it('the current set is the first not done; supersets alternate by fewest sets done', () => {
    expect(currentSetIdx(bench([{ done: true }, { done: false }, { done: false }]))).toBe(1)
    expect(currentSetIdx(bench([{ done: true }, { done: true }]))).toBe(1)
    const a = bench([{ done: true }, { done: false }]), b = bench([{ done: false }, { done: false }])
    expect(nextInUnit([a, b], [0, 1])).toBe(1)
    expect(nextInUnit([a, { ...b, sets: [{ done: true }, { done: false }] }], [0, 1])).toBe(0)
    expect(nextInUnit([bench([{ done: true }]), bench([{ done: true }])], [0, 1])).toBe(0)
  })
  it('the plate shortcut only appears for a loaded bar, never warmups, and follows the setting', () => {
    const e = bench(fresh())
    expect(platesApply(S0(), 'barbell', e, { w: 80 })).toBe(true)
    expect(platesApply(S0(), 'dumbbell', e, { w: 20 })).toBe(false)
    expect(platesApply(S0(), 'barbell', e, { w: 40, type: 'warmup' })).toBe(false)
    expect(platesApply(S0({ enablePlateCalculator: false }), 'barbell', e, { w: 80 })).toBe(false)
    expect(barFor(S0(), { id: 'curl', eq: 'ez barbell' })).toBe('zBar')
    expect(barFor(S0({ barByExercise: { curl: 'technique' } }), { id: 'curl', eq: 'ez barbell' })).toBe('technique')
    expect(barFor(S0(), { id: 'dl', eq: 'trap bar' })).toBeUndefined()
  })
})

describe('intelligent progression V1', () => {
  const T = { sets: 3, reps: 10, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps' }
  const rec = (workouts, over = {}) => recommendProgression(S0({ workouts, ...over }), bench(fresh(), T), 'barbell')

  it('says nothing without history', () => {
    expect(rec([])).toBeNull()
  })
  it('top of the range twice at the same weight → step up, high confidence, explains why', () => {
    const r = rec([logged('2026-09-01', [[80, 10, 7], [80, 10, 7], [80, 11, 7]], T), logged('2026-09-04', [[80, 10, 7], [80, 10, 7], [80, 11, 7]], T)])
    expect(r).toMatchObject({ kind: 'up', w: 85, r: 8, confidence: 'high' })
    expect(r.why[0]).toMatch(/last two sessions/)
  })
  it('a single session with no RPE is low confidence; RPE ≤ 8 makes it high', () => {
    expect(rec([logged('2026-09-04', [[80, 10], [80, 10], [80, 10]], T)])).toMatchObject({ kind: 'hold', w: 80, confidence: 'low' })
    expect(rec([logged('2026-09-04', [[80, 10, 7], [80, 10, 8], [80, 10, 8]], T)])).toMatchObject({ kind: 'up', confidence: 'high' })
  })
  it('high RPE at the top of the range → keep the weight', () => {
    const r = rec([logged('2026-09-04', [[80, 10, 9], [80, 10, 9.5], [80, 10, 10]], T)])
    expect(r).toMatchObject({ kind: 'hold', w: 80 })
    expect(r.why[0]).toMatch(/RPE/)
  })
  it('inside the range → one more rep at the same weight', () => {
    expect(rec([logged('2026-09-04', [[80, 9], [80, 8], [80, 8]], T)])).toMatchObject({ kind: 'reps', w: 80, r: 9 })
  })
  it('short of the range → hold; twice in a row → step down; RIR is read as RPE', () => {
    expect(rec([logged('2026-09-04', [[80, 8], [80, 7], [80, 6]], T)])).toMatchObject({ kind: 'hold', w: 80, r: 8 })
    expect(rec([logged('2026-09-01', [[80, 7], [80, 7], [80, 6]], T), logged('2026-09-04', [[80, 8], [80, 7], [80, 6]], T)]))
      .toMatchObject({ kind: 'down', w: 75, r: 8 })
    const failed = { d: '2026-09-04', entries: [{ id: 'bench', target: T, sets: [{ w: 80, r: 6, rir: 0, done: true }, { w: 80, r: 5, done: true }, { w: 80, r: 5, done: true }] }] }
    expect(rec([failed])).toMatchObject({ kind: 'down', w: 75 })
  })
  it('bodyweight progresses in reps; timed and cardio work is left alone', () => {
    const bwT = { sets: 2, reps: 12, mode: 'reps' }
    const S = S0({ workouts: [{ d: '2026-09-04', entries: [{ id: 'pushup', target: bwT, sets: [{ w: 0, r: 12, done: true }, { w: 0, r: 12, done: true }] }] }] })
    expect(recommendProgression(S, { id: 'pushup', target: bwT, sets: [] }, 'body weight')).toMatchObject({ kind: 'reps', w: 0, r: 13 })
    expect(recommendProgression(S, { id: 'plank', target: { mode: 'time', sec: 45 }, sets: [] }, 'body weight')).toBeNull()
  })
  it('is only offered before the first working set, when enabled, and when it changes something', () => {
    const W = [logged('2026-09-04', [[80, 10, 7], [80, 10, 7], [80, 10, 7]], T)]
    expect(recommendationFor(S0({ workouts: W }), bench(fresh(80, 8), T), 'barbell')).toMatchObject({ w: 85 })
    expect(recommendationFor(S0({ workouts: W }), bench(fresh(85, 8), T), 'barbell')).toBeNull()             // plan already says it
    expect(recommendationFor(S0({ workouts: W, enableProgressiveOverloadCoach: false }), bench(fresh(), T), 'barbell')).toBeNull()
    expect(recommendationFor(S0({ workouts: W }), bench(fresh(), T), 'barbell', { past: true })).toBeNull()
    const started = bench([{ w: 80, r: 8, done: true }, ...fresh().slice(1)], T)
    expect(recommendationFor(S0({ workouts: W }), started, 'barbell')).toBeNull()
    expect(recommendationFor(S0({ workouts: W }), { ...bench(fresh(), T), rec: { status: 'kept' } }, 'barbell')).toBeNull()
  })
  it('accepting changes only unfinished working sets of the session; keeping changes nothing', () => {
    const routine = { id: 'r1', ex: [{ id: 'bench', ...T, weight: 80 }] }
    const before = JSON.stringify(routine)
    const entry = bench([{ w: 40, r: 8, done: false, type: 'warmup' }, { w: 60, r: 5, done: false, type: 'warmup' }, ...fresh(80, 8), { w: 64, r: 8, done: false, type: 'drop' }], { ...T })
    const targetBefore = JSON.stringify(entry.target)
    acceptRecommendation(entry, { kind: 'up', w: 85, r: 8 }, 'kg')
    expect(entry.sets.filter(s => !s.type).map(s => s.w)).toEqual([85, 85, 85])
    expect(entry.sets.filter(s => s.type === 'warmup').map(s => s.w)).toEqual([42.5, 65])
    expect(entry.sets.find(s => s.type === 'drop').w).toBe(64)
    expect(JSON.stringify(entry.target)).toBe(targetBefore)
    expect(JSON.stringify(routine)).toBe(before)
    expect(entry.rec.status).toBe('accepted')
    const other = bench(fresh(), T)
    keepPlan(other, { kind: 'up', w: 85, r: 8 })
    expect(other.sets.map(s => s.w)).toEqual([80, 80, 80])
    expect(other.rec.status).toBe('kept')
  })
})

describe('plan and recommendation agree on realizable loads', () => {
  it('on 2J barbell steps the session plan and the recommendation both say 85, so no card is shown', async () => {
    const { buildRoutineEntries } = await import('./progression.js')
    const T = { sets: 3, reps: 10, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps', weight: 80 }
    const w = logged('2026-09-04', [[80, 10, 7], [80, 10, 7], [80, 10, 7]], T)
    w.entries[0].id = '0025'                    // the real barbell bench press
    const S = S0({ workouts: [w], customEx: [], warmupEnabled: false })
    const [entry] = buildRoutineEntries(S, { id: 'r1', ex: [{ id: '0025', ...T }] })
    expect(entry.sets.map(s => s.w)).toEqual([85, 85, 85])
    expect(recommendProgression(S, entry, 'barbell')).toMatchObject({ kind: 'up', w: 85 })
  })
})
