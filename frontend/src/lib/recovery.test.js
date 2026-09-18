import { describe, it, expect } from 'vitest'
import { recoveryOf, overallRecovery, recoveryColor, hoursToReady, MUSCLE_NAME } from './recovery.js'

// Real dataset ids (same ones badges.test.js uses) so this exercises the real muscle-alias
// pipeline instead of a hand-rolled muscle map.
const BENCH = '0025'   // pectorals -> chest (a "small/medium" muscle, 48h window)
const SQUAT = '0987'   // quads -> quadriceps (a "big" muscle, 72h window)

const hourMs = 60 * 60 * 1000
// `start` (a real timestamp) rather than just a date string, since the whole point of these
// tests is controlling *exactly* how many hours ago a set landed.
const workoutAgo = (hoursAgo, exId, sets) => ({
  id: 'w' + hoursAgo, d: '2020-01-01', start: Date.now() - hoursAgo * hourMs, end: 0,
  entries: [{ id: exId, sets }], vol: 0,
})
const set = (over = {}) => ({ w: 40, r: 10, done: true, ...over })

describe('recoveryOf', () => {
  it('is 100% for every muscle with no training history', () => {
    const recovery = recoveryOf({ workouts: [] })
    expect(Object.values(recovery).every(v => v === 100)).toBe(true)
    expect(overallRecovery(recovery)).toBe(100)
  })

  it('fatigues the muscle a set targets and leaves unrelated ones alone', () => {
    const recovery = recoveryOf({ workouts: [workoutAgo(0, SQUAT, [set(), set(), set(), set()])] })
    expect(recovery.quadriceps).toBeLessThan(100)
    expect(recovery.chest).toBe(100)
  })

  it('excludes warmup sets and undone sets, same as before', () => {
    const recovery = recoveryOf({ workouts: [workoutAgo(0, SQUAT, [
      set({ type: 'warmup' }), set({ done: false }),
    ])] })
    expect(recovery.quadriceps).toBe(100)
  })

  it('excludes cardio/time-mode entries — only reps-mode sets fatigue a muscle', () => {
    const recovery = recoveryOf({
      workouts: [{
        id: 'w1', d: '2020-01-01', start: Date.now(), end: 0, vol: 0,
        entries: [{ id: SQUAT, target: { mode: 'cardio' }, sets: [{ min: 20, speed: 8, done: true }] }],
      }],
    })
    expect(recovery.quadriceps).toBe(100)
  })

  it('a big muscle (quadriceps) stays more fatigued than a small one (chest) the same hours '
    + 'after an equally-sized session — the whole point of the size-dependent window', () => {
    const hoursAgo = 24
    const rQuad = recoveryOf({ workouts: [workoutAgo(hoursAgo, SQUAT, [set(), set(), set(), set()])] })
    const rChest = recoveryOf({ workouts: [workoutAgo(hoursAgo, BENCH, [set(), set(), set(), set()])] })
    expect(rQuad.quadriceps).toBeLessThan(rChest.chest)
  })

  it('a set taken closer to failure (low RIR) fatigues more than an easy one, same reps', () => {
    const hard = recoveryOf({ workouts: [workoutAgo(1, BENCH, [set({ rir: 0 }), set({ rir: 0 })])] })
    const easy = recoveryOf({ workouts: [workoutAgo(1, BENCH, [set({ rir: 5 }), set({ rir: 5 })])] })
    expect(hard.chest).toBeLessThan(easy.chest)
  })

  it('an unrated set (no rir/rpe logged) sits at neutral intensity — between a hard and an easy one', () => {
    const unrated = recoveryOf({ workouts: [workoutAgo(1, BENCH, [set(), set()])] })
    const hard = recoveryOf({ workouts: [workoutAgo(1, BENCH, [set({ rir: 0 }), set({ rir: 0 })])] })
    const easy = recoveryOf({ workouts: [workoutAgo(1, BENCH, [set({ rir: 5 }), set({ rir: 5 })])] })
    expect(unrated.chest).toBeLessThan(easy.chest)
    expect(unrated.chest).toBeGreaterThan(hard.chest)
  })

  it('recovers smoothly toward 100% the longer ago the session was (continuous, no cliff)', () => {
    const soon = recoveryOf({ workouts: [workoutAgo(2, SQUAT, [set(), set(), set(), set()])] }).quadriceps
    const later = recoveryOf({ workouts: [workoutAgo(30, SQUAT, [set(), set(), set(), set()])] }).quadriceps
    const muchLater = recoveryOf({ workouts: [workoutAgo(90, SQUAT, [set(), set(), set(), set()])] }).quadriceps
    expect(soon).toBeLessThan(later)
    expect(later).toBeLessThan(muchLater)
    expect(muchLater).toBeGreaterThanOrEqual(99)
  })
})

describe('recoveryColor', () => {
  it('follows the brief\'s 0-39 / 40-79 / 80-100 bands exactly at the boundaries', () => {
    expect(recoveryColor(0)).toBe('var(--red)')
    expect(recoveryColor(39)).toBe('var(--red)')
    expect(recoveryColor(40)).toBe('var(--yellow)')
    expect(recoveryColor(79)).toBe('var(--yellow)')
    expect(recoveryColor(80)).toBe('var(--green)')
    expect(recoveryColor(100)).toBe('var(--green)')
  })
})

describe('hoursToReady', () => {
  it('is 0 once a muscle is already in the ready (80%+) band', () => {
    expect(hoursToReady({ chest: 80 }, 'chest')).toBe(0)
    expect(hoursToReady({ chest: 100 }, 'chest')).toBe(0)
  })
  it('is positive below the ready band, and larger the more fatigued the muscle is', () => {
    const soon = hoursToReady({ quadriceps: 70 }, 'quadriceps')
    const later = hoursToReady({ quadriceps: 20 }, 'quadriceps')
    expect(soon).toBeGreaterThan(0)
    expect(later).toBeGreaterThan(soon)
  })
  it('takes longer for a big muscle than a small one to clear the same fatigue level', () => {
    const big = hoursToReady({ quadriceps: 40 }, 'quadriceps')
    const small = hoursToReady({ chest: 40 }, 'chest')
    expect(big).toBeGreaterThan(small)
  })
})

describe('MUSCLE_NAME re-export', () => {
  it('still resolves every real muscle slug used above', () => {
    expect(MUSCLE_NAME.quadriceps).toBeTruthy()
    expect(MUSCLE_NAME.chest).toBeTruthy()
  })
})
