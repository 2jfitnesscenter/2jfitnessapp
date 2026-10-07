import { describe, expect, it } from 'vitest'
import { countsForProgression, progressionWorkouts } from './workout-policy.js'

describe('workout progression policy', () => {
  it('keeps legacy workouts included and excludes only an explicit true flag', () => {
    const rows = [{ id: 'legacy' }, { id: 'included', excludeFromProgression: false }, { id: 'excluded', excludeFromProgression: true }]
    expect(rows.map(countsForProgression)).toEqual([true, true, false])
    expect(progressionWorkouts(rows).map(w => w.id)).toEqual(['legacy', 'included'])
  })
  it('rejects invalid nullish records without changing legacy flag behavior', () => {
    expect(countsForProgression(null)).toBe(false)
    expect(countsForProgression(undefined)).toBe(false)
    expect(countsForProgression({})).toBe(true)
  })
})
