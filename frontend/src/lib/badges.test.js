import { describe, it, expect } from 'vitest'
import { evaluateBadges, totalWorkouts, totalVolumeKg, exerciseSessionCounts, distinctExerciseCount, maxExerciseRepeatCount, isFullBodyWorkout, strengthScore } from './badges.js'
import { BADGES, BADGE_BY_ID, BADGES_BY_CATEGORY, badgeAccent } from './badges-data.js'

// Real dataset ids, one per recovery.js movement-pattern group, so isFullBodyWorkout exercises
// the real muscle-alias pipeline instead of a hand-rolled muscle map.
const BENCH = '0025'      // chest → push
const PULLUP = '0652'     // lats + biceps/forearms → pull
const SQUAT = '0987'      // quads + glutes/hamstrings → legs
const SITUP = '0001'      // abs → core

const set = (over = {}) => ({ w: 40, r: 10, done: true, ...over })
const workout = (d, entries, over = {}) => ({ id: 'w' + d, d, start: new Date(d + 'T12:00:00').getTime(), end: 0, entries, vol: 0, ...over })
// evaluateBadges always computes strengthScore too (globalRank → allLiftRanks → liftRatio →
// lastBW reads S.bodyweight unconditionally) — every S fixture needs the same baseline shape
// a real profile always has via useStore's DEF, not just the fields one particular test cares about.
const baseS = (over = {}) => ({ workouts: [], bodyweight: [], exWeights: {}, body: 'male', badges: {}, ...over })

describe('badges-data catalogue', () => {
  it('every badge id is unique', () => {
    const ids = BADGES.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
  it('every badge resolves back through BADGE_BY_ID', () => {
    BADGES.forEach(b => expect(BADGE_BY_ID[b.id]).toBe(b))
  })
})

describe('badgeAccent — the celebration modal\'s gold/cyan/emerald', () => {
  it('is always one of the three colors the brief asked for', () => {
    BADGES.forEach(b => expect(['gold', 'cyan', 'emerald']).toContain(badgeAccent(b)))
  })
  it('the highest threshold in a numbered ladder reads as gold', () => {
    const list = BADGES_BY_CATEGORY.workouts
    expect(badgeAccent(list[list.length - 1])).toBe('gold')   // workouts_200
    expect(badgeAccent(list[0])).not.toBe('gold')              // workouts_1
  })
  it('is deterministic — same badge, same color, every call', () => {
    const b = BADGES_BY_CATEGORY.streaks[2]
    expect(badgeAccent(b)).toBe(badgeAccent(b))
  })
})

describe('totalWorkouts / totalVolumeKg', () => {
  it('counts sessions and sums vol', () => {
    const S = { workouts: [workout('2026-01-01', [], { vol: 500 }), workout('2026-01-08', [], { vol: 700 })] }
    expect(totalWorkouts(S)).toBe(2)
    expect(totalVolumeKg(S)).toBe(1200)
  })
})

describe('exerciseSessionCounts / distinctExerciseCount / maxExerciseRepeatCount', () => {
  const S = {
    workouts: [
      workout('2026-01-01', [{ id: BENCH, sets: [set()] }]),
      workout('2026-01-08', [{ id: BENCH, sets: [set()] }, { id: SQUAT, sets: [set()] }]),
      // An entry with no done set (e.g. skipped mid-session) doesn't count as "logged".
      workout('2026-01-15', [{ id: SITUP, sets: [set({ done: false })] }]),
    ],
  }
  it('counts each exercise by how many distinct sessions actually logged a done set of it', () => {
    expect(exerciseSessionCounts(S)).toEqual({ [BENCH]: 2, [SQUAT]: 1 })
  })
  it('distinctExerciseCount is the number of exercises with at least one session', () => {
    expect(distinctExerciseCount(S)).toBe(2)
  })
  it('maxExerciseRepeatCount is the highest per-exercise session count', () => {
    expect(maxExerciseRepeatCount(S)).toBe(2)
  })
})

describe('isFullBodyWorkout', () => {
  it('is true once a session has a done set in each of push/pull/legs/core', () => {
    const S = { countSecondaryMuscles: true, secondaryMuscleFactor: 0.5 }
    const w = workout('2026-01-01', [
      { id: BENCH, sets: [set()] }, { id: PULLUP, sets: [set()] },
      { id: SQUAT, sets: [set()] }, { id: SITUP, sets: [set()] },
    ])
    expect(isFullBodyWorkout(S, w)).toBe(true)
  })
  it('is false when a group never got a set (chest/back/legs, no core here)', () => {
    const S = {}
    const w = workout('2026-01-01', [{ id: BENCH, sets: [set()] }, { id: PULLUP, sets: [set()] }, { id: SQUAT, sets: [set()] }])
    expect(isFullBodyWorkout(S, w)).toBe(false)
  })
})

describe('strengthScore', () => {
  it('is 0 while globalRank is still locked (not enough ranked lifts)', () => {
    expect(strengthScore({ workouts: [], exWeights: {}, bodyweight: [], body: 'male' })).toBe(0)
  })
})

describe('evaluateBadges', () => {
  it('unlocks total_workouts badges once the count is reached, with unlockedAt set and progress 1', () => {
    const S = baseS({ workouts: [workout('2026-01-01', [])] })
    const { badges, newlyUnlocked } = evaluateBadges(S)
    expect(badges.workouts_1.unlockedAt).toBeTruthy()
    expect(badges.workouts_1.progress).toBe(1)
    expect(newlyUnlocked.map(b => b.id)).toContain('workouts_1')
    // Not reached yet — tracked with partial progress, not unlocked.
    expect(badges.workouts_5.unlockedAt).toBeNull()
    expect(badges.workouts_5.progress).toBeCloseTo(0.2)
  })

  it('never re-locks or re-fires an already-unlocked badge on a later call', () => {
    const S = baseS({ workouts: [workout('2026-01-01', [])], badges: { workouts_1: { badgeId: 'workouts_1', unlockedAt: '2020-01-01T00:00:00.000Z', progress: 1 } } })
    const { badges, newlyUnlocked } = evaluateBadges(S)
    expect(badges.workouts_1.unlockedAt).toBe('2020-01-01T00:00:00.000Z')   // untouched
    expect(newlyUnlocked.map(b => b.id)).not.toContain('workouts_1')
  })

  it('unlocks a volume badge from accumulated vol across workouts', () => {
    const S = baseS({ workouts: [workout('2026-01-01', [], { vol: 3000 }), workout('2026-01-08', [], { vol: 2500 })] })
    const { badges } = evaluateBadges(S)
    expect(badges.volume_5000.unlockedAt).toBeTruthy()
    expect(badges.volume_10000.unlockedAt).toBeNull()
  })

  it('unlocks a streak badge from streakWeeks(S)', () => {
    const iso = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
    const S = baseS({ workouts: [workout(iso(new Date()), [])] })
    const { badges } = evaluateBadges(S)
    expect(badges.streak_1.unlockedAt).toBeTruthy()
  })

  it('unlocks the dropset/cardio/failure-set milestones purely by scanning S.workouts (retroactive-safe)', () => {
    const S = baseS({
      workouts: [workout('2026-01-01', [
        { id: BENCH, sets: [set({ type: 'drop' }), set({ rir: 0 })] },
        { id: 'cardio1', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 8, done: true }] },
      ])],
    })
    const { badges, newlyUnlocked } = evaluateBadges(S)
    expect(badges.milestone_dropset.unlockedAt).toBeTruthy()
    expect(badges.milestone_failure.unlockedAt).toBeTruthy()
    expect(badges.milestone_cardio.unlockedAt).toBeTruthy()
    const ids = newlyUnlocked.map(b => b.id)
    expect(ids).toEqual(expect.arrayContaining(['milestone_dropset', 'milestone_failure', 'milestone_cardio']))
  })

  it('only unlocks the superset milestone from justFinishedLiveEntries, never retroactively from S.workouts', () => {
    // A saved workout never carries `sg` (doFinishWorkout strips it) — re-evaluating an old
    // history with no live context must not spuriously unlock this one.
    const S = baseS({ workouts: [workout('2026-01-01', [{ id: BENCH, sets: [set()] }])] })
    expect(evaluateBadges(S).badges.milestone_superset?.unlockedAt).toBeFalsy()
    const { badges } = evaluateBadges(S, { justFinishedLiveEntries: [{ id: BENCH, sg: 'a' }, { id: PULLUP, sg: 'a' }] })
    expect(badges.milestone_superset.unlockedAt).toBeTruthy()
  })

  it('unlocks an exercise-breadth/repeat badge from exerciseSessionCounts', () => {
    const workouts = []
    for (let i = 0; i < 10; i++) workouts.push(workout('2026-01-' + String(i + 1).padStart(2, '0'), [{ id: BENCH, sets: [set()] }]))
    const S = baseS({ workouts })
    const { badges } = evaluateBadges(S)
    expect(badges.exercises_repeat_10.unlockedAt).toBeTruthy()
    expect(badges.exercises_distinct_10.unlockedAt).toBeFalsy()   // only one distinct exercise here
  })
})
