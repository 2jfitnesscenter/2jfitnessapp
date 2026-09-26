import { describe, it, expect } from 'vitest'
import { evaluateBadges, evaluateBadgesIn, totalWorkouts, totalVolumeKg, exerciseSessionCounts, distinctExerciseCount, maxExerciseRepeatCount, isFullBodyWorkout, strengthScore, maxWeeklyWorkoutDays, maxMonthlyWorkoutDays } from './badges.js'
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
    expect(badgeAccent(list[list.length - 1])).toBe('gold')   // workouts_100
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
    expect(newlyUnlocked.find(b => b.id === 'workouts_1').unlockedAt).toBe(badges.workouts_1.unlockedAt)
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
    expect(badges.volume_20000.unlockedAt).toBeNull()
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

describe('Calendar frequency — maxWeeklyWorkoutDays/maxMonthlyWorkoutDays (Mon-Sun weeks, calendar months)', () => {
  it('dedupes two workouts logged the same day into a single day for both buckets', () => {
    const S = baseS({ workouts: [
      workout('2026-01-05', []),
      { ...workout('2026-01-05', []), id: 'w2026-01-05b' },   // a second session, same calendar day
      workout('2026-01-06', []),
      workout('2026-01-07', []),
    ] })
    expect(maxWeeklyWorkoutDays(S)).toBe(3)    // 3 distinct days, not 4 workouts
    expect(maxMonthlyWorkoutDays(S)).toBe(3)
  })

  it('unlocks a weekly-frequency badge once a single Mon-Sun week reaches its distinct-day threshold', () => {
    const S = baseS({ workouts: ['2026-01-05', '2026-01-06', '2026-01-07'].map(d => workout(d, [])) })
    const { badges } = evaluateBadges(S)
    expect(badges.calendar_3w.unlockedAt).toBeTruthy()
    expect(badges.calendar_4w?.unlockedAt).toBeFalsy()
  })

  it('unlocks a monthly-frequency badge once a single calendar month reaches its distinct-day threshold', () => {
    const days = []
    for (let i = 1; i <= 16; i++) days.push('2026-01-' + String(i).padStart(2, '0'))
    const S = baseS({ workouts: days.map(d => workout(d, [])) })
    const { badges } = evaluateBadges(S)
    expect(badges.calendar_15m.unlockedAt).toBeTruthy()
    expect(badges.calendar_20m?.unlockedAt).toBeFalsy()
  })

  it('a week spanning two calendar months counts each bucket independently', () => {
    // Jan 29 (Thu) .. Feb 1 (Sun) 2026 — one Mon-Sun week, split across two months.
    const S = baseS({ workouts: ['2026-01-29', '2026-01-30', '2026-01-31', '2026-02-01'].map(d => workout(d, [])) })
    expect(maxWeeklyWorkoutDays(S)).toBe(4)     // all 4 fall in the same ISO week
    expect(maxMonthlyWorkoutDays(S)).toBe(3)    // 3 in January, 1 in February — 3 is the best bucket
  })
})

describe('App-category badge triggers', () => {
  it('app_measurement unlocks from either S.bodyweight or S.measurements ("peso, contornos o grasa")', () => {
    expect(evaluateBadges(baseS({ bodyweight: [{ d: '2026-01-01', w: 80 }] })).badges.app_measurement.unlockedAt).toBeTruthy()
    expect(evaluateBadges(baseS({ measurements: { bodyFat: [{ d: '2026-01-01', v: 20 }] } })).badges.app_measurement.unlockedAt).toBeTruthy()
    expect(evaluateBadges(baseS()).badges.app_measurement).toBeUndefined()
  })

  it('app_favorite unlocks once any routine carries fav:true — retroactive, like the other first_action checks', () => {
    expect(evaluateBadges(baseS({ routines: [{ id: 'r1', fav: true }] })).badges.app_favorite.unlockedAt).toBeTruthy()
    expect(evaluateBadges(baseS({ routines: [{ id: 'r1' }] })).badges.app_favorite).toBeUndefined()
  })

  it('app_share only unlocks via the one-way badgeFlags.sharedRoutine flag — an action, not a fact left behind in S', () => {
    expect(evaluateBadges(baseS({ badgeFlags: { sharedRoutine: true } })).badges.app_share.unlockedAt).toBeTruthy()
    expect(evaluateBadges(baseS()).badges.app_share).toBeUndefined()
  })

  it('app_gym_location stays locked — deferred pending real gym coordinates', () => {
    expect(evaluateBadges(baseS()).badges.app_gym_location).toBeUndefined()
  })
})

describe('evaluateBadgesIn — the shared update()+evaluate dance for triggers outside sheets.jsx', () => {
  it('runs the mutator inside the same update, then evaluates against the mutated state', () => {
    const S = baseS({ routines: [{ id: 'r1', fav: false }] })
    const fakeUpdate = fn => fn(S)   // mirrors useStore's update(mut) signature closely enough here
    const newlyUnlocked = evaluateBadgesIn(fakeUpdate, s => { s.routines[0].fav = true })
    expect(S.routines[0].fav).toBe(true)
    expect(S.badges.app_favorite.unlockedAt).toBeTruthy()
    expect(newlyUnlocked.map(b => b.id)).toContain('app_favorite')
  })
})
