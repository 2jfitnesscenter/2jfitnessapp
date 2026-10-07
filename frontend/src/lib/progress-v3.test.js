import { describe, expect, it } from 'vitest'
import { periodSummary } from './progress-v3.js'

const BENCH = '0025'
const set = { w: 50, r: 8, done: true }
const workout = (id, excluded, count) => ({
  id, d: '2026-10-07', start: 1000, end: 1000 + count * 60000,
  vol: count * 400, entries: [{ id: BENCH, sets: Array.from({ length: count }, () => ({ ...set })) }],
  ...(excluded ? { excludeFromProgression: true } : {})
})

describe('Progress V3 progression exclusion', () => {
  it('retains workout count and duration but excludes performance totals and muscle load', () => {
    const result = periodSummary({
      workouts: [workout('included', false, 2), workout('excluded', true, 5)],
      bodyweight: [], badges: {}, routines: [], week: {}, activeProgramId: null
    }, 'week', new Date(2026, 9, 7, 12))
    expect(result.workouts).toBe(2)
    expect(result.minutes).toBe(7)
    expect(result.sets).toBe(2)
    expect(result.volume).toBe(800)
    expect(result.muscles).toContainEqual(expect.objectContaining({ slug: 'chest', sets: 2 }))
  })

  it('does not report performance load when the period contains only excluded workouts', () => {
    const result = periodSummary({
      workouts: [workout('excluded', true, 5)], bodyweight: [], badges: {},
      routines: [], week: {}, activeProgramId: null
    }, 'week', new Date(2026, 9, 7, 12))
    expect(result.workouts).toBe(1)
    expect(result.sets).toBe(0)
    expect(result.volume).toBeNull()
    expect(result.muscles).toEqual([])
  })
})
