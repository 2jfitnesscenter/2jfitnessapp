// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Each consumer that follows the merge (lib/exercise-merge.js) resolves a merged-away exercise to its target,
// and undoing the merge brings the original back with its own data. Nothing stored is rewritten.
import { describe, expect, it } from 'vitest'
import { EXIDX } from './exercises.js'
import { allExercises } from './exercises.js'
import { mergeExercise, unmergeExercise } from './exercise-merge.js'
import { recentEntriesFor, bestWeightFor, trackedWeightFor } from './history.js'
import { sessionsFor } from './progression.js'

const real = Object.keys(EXIDX).filter(id => EXIDX[id] && EXIDX[id].tg && !EXIDX[id].custom)
const A = real[0]
const B = real.find(id => id !== A && EXIDX[id].tg !== EXIDX[A].tg)

const clone = x => JSON.parse(JSON.stringify(x))
const done = (w, r) => ({ w, r, done: true, type: 'normal' })
// B (merged away into A) is trained on day 1 with a heavier best; A on day 2. Both are real catalogue exercises.
function fixture() {
  return {
    workouts: [
      { id: 'w1', d: '2026-10-01', start: 1, end: 2, entries: [{ id: B, sets: [done(90, 8)] }] },
      { id: 'w2', d: '2026-10-05', start: 3, end: 4, entries: [{ id: A, sets: [done(100, 5)] }] },
    ],
    exWeights: { [A]: { w: 100, d: '2026-10-05' } },
  }
}

describe('pickers: allExercises hides the merged-away exercise', () => {
  it('lists the target, not the merged-away one; the merged-away id still resolves', () => {
    const s = fixture()
    expect(allExercises(s).some(e => e.id === B)).toBe(true)
    mergeExercise(s, B, A)
    expect(allExercises(s).some(e => e.id === B)).toBe(false)
    expect(allExercises(s).some(e => e.id === A)).toBe(true)
    expect(EXIDX[B]).toBeTruthy()
  })
  it('undo puts the merged-away exercise back into the list', () => {
    const s = fixture()
    mergeExercise(s, B, A)
    unmergeExercise(s, B)
    expect(allExercises(s).some(e => e.id === B)).toBe(true)
  })
})

describe('history: entries of a merged-away exercise count for the target', () => {
  it('recentEntriesFor, bestWeightFor and trackedWeightFor read the target history', () => {
    const s = fixture()
    expect(recentEntriesFor(s, B, 3).map(r => r.d)).toEqual(['2026-10-01'])
    mergeExercise(s, B, A)
    expect(recentEntriesFor(s, B, 3).map(r => r.d)).toEqual(['2026-10-05', '2026-10-01'])
    expect(recentEntriesFor(s, A, 3).map(r => r.d)).toEqual(['2026-10-05', '2026-10-01'])
    expect(bestWeightFor(s, B)).toBe(100)
    expect(trackedWeightFor(s, B)).toEqual({ w: 100, d: '2026-10-05' })
  })
  it('undo restores the merged-away exercise its own history and leaves the data untouched', () => {
    const s = fixture()
    const before = clone(s.workouts)
    mergeExercise(s, B, A)
    unmergeExercise(s, B)
    expect(recentEntriesFor(s, B, 3).map(r => r.d)).toEqual(['2026-10-01'])
    expect(bestWeightFor(s, B)).toBe(90)
    expect(s.workouts).toEqual(before)
  })
})

describe('progression: sessions of a merged-away exercise count for the target', () => {
  it('sessionsFor resolves the merged id to its target and undo restores its own sessions', () => {
    const s = fixture()
    expect(sessionsFor(s, B, { id: B }).map(x => x.d)).toEqual(['2026-10-01'])
    mergeExercise(s, B, A)
    expect(sessionsFor(s, B, { id: B }).map(x => x.d)).toEqual(['2026-10-01', '2026-10-05'])
    expect(sessionsFor(s, A, { id: A }).map(x => x.d)).toEqual(['2026-10-01', '2026-10-05'])
    unmergeExercise(s, B)
    expect(sessionsFor(s, B, { id: B }).map(x => x.d)).toEqual(['2026-10-01'])
  })
})
