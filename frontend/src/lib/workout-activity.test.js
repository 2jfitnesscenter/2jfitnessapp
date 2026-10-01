import { describe, it, expect, vi } from 'vitest'
import { stampWorkoutActivity, workoutInactive, inactivityFinishMetadata, WORKOUT_INACTIVITY_MS, buildFinishedWorkout } from './workout-activity.js'

const start = 1700000000000
const active = () => ({ id: 'w', d: '2026-10-01', start, lastActivityAt: start, cur: 0, entries: [{ id: '0025', sets: [{ w: 40, r: 8, done: true }] }] })
describe('workout inactivity', () => {
  it('59:59 remains active; exactly 60 minutes expires with the real clock mocked', () => {
    vi.useFakeTimers(); vi.setSystemTime(start + WORKOUT_INACTIVITY_MS - 1000)
    expect(workoutInactive(active())).toBe(false)
    vi.advanceTimersByTime(1000); expect(workoutInactive(active())).toBe(true)
    vi.useRealTimers()
  })
  it('real activity at minute 50 starts a new window', () => {
    const next = stampWorkoutActivity(active(), { ...active(), cur: 1 }, start + 50 * 60000)
    expect(workoutInactive(next, start + 60 * 60000)).toBe(false)
    expect(workoutInactive(next, start + 110 * 60000)).toBe(true)
  })
  for (const [kind, edit] of [
    ['set edit', a => { a.entries[0].sets[0].w = 45 }],
    ['reps', a => { a.entries[0].sets[0].r = 10 }],
    ['completed set', a => { a.entries[0].sets[0].done = false }],
    ['swap', a => { a.entries[0].id = '0001' }],
    ['cardio', a => { a.entries[0].sets[0].min = 20 }],
  ]) it(`${kind} updates activity`, () => {
    const before = active(), after = structuredClone(before); edit(after)
    expect(stampWorkoutActivity(before, after, start + 1000).lastActivityAt).toBe(start + 1000)
  })
  it('passive copies and render/revalidation do not move the timestamp', () => {
    expect(stampWorkoutActivity(active(), structuredClone(active()), start + 300000).lastActivityAt).toBe(start)
  })
  it('persisted reload is already expired, with independent A/B/C deadlines', () => {
    const sessions = [active(), { ...active(), id: 'B', lastActivityAt: start + 50 * 60000 }, { ...active(), id: 'C', lastActivityAt: start + 59 * 60000 }]
    expect(JSON.parse(JSON.stringify(sessions)).map(a => workoutInactive(a, start + 60 * 60000))).toEqual([true, false, false])
  })
  it('effective duration excludes idle tail; finishedAt records actual closure', () => {
    const a = { ...active(), lastActivityAt: start + 50 * 60000 }
    const meta = inactivityFinishMetadata(a, start + 110 * 60000)
    expect(meta.end - a.start).toBe(50 * 60000)
    expect(meta.finishedAt).toBe(start + 110 * 60000)
    expect(meta.finishReason).toBe('inactivity_timeout')
  })
  it('legacy duration is not invented; past logs never expire', () => {
    const legacy = active(); delete legacy.lastActivityAt
    expect(inactivityFinishMetadata(legacy, start + 3600000).end).toBe(start + 3600000)
    expect(workoutInactive({ ...legacy, past: true }, start + 99999999)).toBe(false)
  })
  it('normal finish builder preserves program, RPE/feedback and excludes warmup volume', () => {
    const a = active(); a.src2j = { program: { programId: 'p', sessionId: '1:1:0' } }
    Object.assign(a.entries[0].sets[0], { rpe: 7, feel: 'good' })
    const w = buildFinishedWorkout(a)
    expect(w.src2j).toEqual(a.src2j); expect(w.entries[0].sets[0].feel).toBe('good'); expect(w.vol).toBe(320)
  })
})
