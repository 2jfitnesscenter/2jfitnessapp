import { describe, expect, it } from 'vitest'
import { bestSetOf, compareBest, lastTimeComparison } from './last-time-compare.js'

const set = (w, r, extra = {}) => ({ w, r, done: true, type: 'normal', ...extra })
const ex = (id, sets) => ({ id, sets })
const workout = (id, end, entries, extra = {}) => ({ id, d: '2026-10-01', start: end - 100, end, entries, ...extra })

describe('bestSetOf', () => {
  it('takes the heaviest done working set, then the most reps at that load', () => {
    expect(bestSetOf([set(80, 8), set(90, 5), set(90, 6), set(70, 12)])).toEqual({ w: 90, r: 6 })
  })
  it('ignores warmups, drops and undone sets', () => {
    expect(bestSetOf([set(100, 10, { type: 'warmup' }), set(60, 8, { type: 'drop' }), set(80, 8, { done: false }), set(70, 8)])).toEqual({ w: 70, r: 8 })
  })
  it('is null when nothing working was done', () => {
    expect(bestSetOf([])).toBeNull()
    expect(bestSetOf([set(100, 10, { type: 'warmup' })])).toBeNull()
  })
  it('compares reps-only exercises (no load) by reps', () => {
    expect(bestSetOf([set(0, 12), set(0, 15)])).toEqual({ w: 0, r: 15 })
  })
})

describe('compareBest', () => {
  it('up when load goes up, even with fewer reps', () => {
    expect(compareBest({ w: 85, r: 5 }, { w: 80, r: 10 })).toBe('up')
  })
  it('down when load goes down, even with more reps', () => {
    expect(compareBest({ w: 75, r: 12 }, { w: 80, r: 8 })).toBe('down')
  })
  it('at the same load, reps decide: up, down or same', () => {
    expect(compareBest({ w: 80, r: 11 }, { w: 80, r: 10 })).toBe('up')
    expect(compareBest({ w: 80, r: 9 }, { w: 80, r: 10 })).toBe('down')
    expect(compareBest({ w: 80, r: 10 }, { w: 80, r: 10 })).toBe('same')
  })
  it('no label when either side is missing', () => {
    expect(compareBest({ w: 80, r: 10 }, null)).toBeNull()
    expect(compareBest(null, { w: 80, r: 10 })).toBeNull()
  })
})

describe('lastTimeComparison', () => {
  const past = workout('p1', 1000, [ex('A', [set(80, 10), set(80, 9)]), ex('B', [set(20, 12)])])
  const older = workout('p0', 500, [ex('A', [set(200, 1)])])

  it('compares each exercise with its most recent earlier session', () => {
    const now = workout('now', 5000, [ex('A', [set(85, 8)]), ex('B', [set(20, 12)])])
    const S = { workouts: [older, past] }
    expect(lastTimeComparison(S, now)).toEqual([{ id: 'A', trend: 'up' }, { id: 'B', trend: 'same' }])
  })

  it('an exercise with no previous session gets no label', () => {
    const now = workout('now', 5000, [ex('NEW', [set(50, 5)]), ex('B', [set(18, 12)])])
    expect(lastTimeComparison({ workouts: [past] }, now)).toEqual([{ id: 'B', trend: 'down' }])
  })

  it('ignores the workout itself and anything that ended after it started', () => {
    const now = workout('now', 5000, [ex('A', [set(80, 10)])])
    const later = workout('later', 9000, [ex('A', [set(999, 1)])])
    const S = { workouts: [past, now, later] }
    expect(lastTimeComparison(S, now)).toEqual([{ id: 'A', trend: 'same' }])
  })

  it('skips sessions excluded from progression', () => {
    const excluded = workout('p2', 2000, [ex('A', [set(300, 1)])], { excludeFromProgression: true })
    const now = workout('now', 5000, [ex('A', [set(79, 10)])])
    expect(lastTimeComparison({ workouts: [past, excluded] }, now)).toEqual([{ id: 'A', trend: 'down' }])
  })

  it('is empty for a first-ever session and tolerates a missing workout list', () => {
    const now = workout('now', 5000, [ex('A', [set(80, 10)])])
    expect(lastTimeComparison({ workouts: [] }, now)).toEqual([])
    expect(lastTimeComparison({}, now)).toEqual([])
  })
})
