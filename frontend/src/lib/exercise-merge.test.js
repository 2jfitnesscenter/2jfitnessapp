// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { EXIDX } from './exercises.js'
import { resolveExId, exResolverOf, mergedAwayIds, mergeProblem, mergeExercise, unmergeExercise, activeMerges, mergeMapOf, MERGES_KEY } from './exercise-merge.js'
import { e1rmSeries, best1RM, oneRMTests } from './onerm.js'
import { loadOfWorkouts, muscleOptsOf } from './muscles.js'
import { recentIdsOf, favSetOf } from './library/index.js'

// Two real catalogue exercises that train different muscles, so a merge is visible in the volume map.
const real = Object.keys(EXIDX).filter(id => EXIDX[id] && EXIDX[id].tg && !EXIDX[id].custom)
const A = real[0]
const B = real.find(id => EXIDX[id].tg !== EXIDX[A].tg)
const C = real.find(id => ![A, B].includes(id) && EXIDX[id].tg !== EXIDX[B].tg)

const clone = x => JSON.parse(JSON.stringify(x))
const done = (w, r) => ({ w, r, done: true, type: 'normal' })
// A small history: A is trained on two days, B on one, and an unrelated exercise on one.
function fixture() {
  return {
    workouts: [
      { id: 'w1', d: '2026-10-01', start: 1, end: 2, entries: [{ id: A, sets: [done(100, 5), done(80, 8), { w: 60, r: 10, done: false, type: 'normal' }] }] },
      { id: 'w2', d: '2026-10-05', start: 3, end: 4, entries: [{ id: B, sets: [done(50, 10)] }, { id: A, sets: [done(105, 4)] }] },
      { id: 'w3', d: '2026-10-09', start: 5, end: 6, entries: [{ id: C, sets: [done(20, 12)] }] },
    ],
    routines: [{ id: 'r1', name: 'Day', ex: [{ id: A, sets: 3 }, { id: B, sets: 2 }] }],
    tests: [{ id: 't1', type: '1rm', exId: A, w: 120, r: 1, est1RM: 120, d: '2026-10-02' }],
    body: { h: 180 },
    favEx: [A],
    exWeights: { [A]: 100 },
  }
}

describe('resolveExId: the one resolution rule', () => {
  it('a direct mapping resolves to its target; an unmapped id is itself', () => {
    expect(resolveExId({ a: 'b' }, 'a')).toBe('b')
    expect(resolveExId({ a: 'b' }, 'x')).toBe('x')
  })
  it('chains resolve to the end: A→B and B→C gives C', () => {
    expect(resolveExId({ a: 'b', b: 'c' }, 'a')).toBe('c')
    expect(resolveExId({ a: 'b', b: 'c' }, 'b')).toBe('c')
  })
  it('a mapping to a missing or deleted target is ignored, so the original id is shown', () => {
    const exists = id => id !== 'gone'
    expect(resolveExId({ a: 'gone' }, 'a', exists)).toBe('a')
    expect(resolveExId({ a: 'b', b: 'gone' }, 'a', exists)).toBe('b', 'the link to the missing target is skipped, the last existing id stays')
  })
  it('a stored loop never hangs the resolver', () => {
    const r = resolveExId({ a: 'b', b: 'a' }, 'a')
    expect(['a', 'b']).toContain(r)
  })
})

describe('creating and undoing a merge', () => {
  it('refuses self-merges, unknown ids, a second merge of the same exercise and any cycle', () => {
    const s = fixture()
    expect(mergeProblem(s, A, A)).toBe('self')
    expect(mergeProblem(s, A, 'does-not-exist')).toBe('missing')
    expect(mergeProblem(s, 'does-not-exist', B)).toBe('missing')
    expect(mergeExercise(s, A, B)).toBeNull()
    expect(mergeProblem(s, A, C)).toBe('already')
    expect(mergeProblem(s, B, A)).toBe('cycle', 'B→A would close the loop A→B→A')
  })
  it('refuses a cycle through a chain as well', () => {
    const s = fixture()
    mergeExercise(s, A, B)
    mergeExercise(s, B, C)
    expect(mergeProblem(s, C, A)).toBe('cycle')
    expect(mergeProblem(s, C, B)).toBe('cycle')
  })
  it('undo removes the mapping and the original exercise is visible again with its old data', () => {
    const s = fixture()
    const before = clone(s)
    expect(mergeExercise(s, A, B)).toBeNull()
    expect(mergedAwayIds(s)).toEqual([A])
    expect(exResolverOf(s)(A)).toBe(B)
    expect(unmergeExercise(s, A)).toBe(true)
    expect(s[MERGES_KEY]).toBeUndefined()
    expect(mergedAwayIds(s)).toEqual([])
    expect(exResolverOf(s)(A)).toBe(A)
    expect(recentIdsOf(s)).toContain(A)
    expect(clone(s)).toEqual(before)
    expect(unmergeExercise(s, A)).toBe(false, 'undoing twice changes nothing')
  })
  it('a mapping whose target was deleted is ignored and is not listed as merged', () => {
    const s = fixture()
    s[MERGES_KEY] = { [A]: 'c-deleted-custom' }
    expect(mergedAwayIds(s)).toEqual([])
    expect(exResolverOf(s)(A)).toBe(A)
    expect(activeMerges(s)).toEqual([])
    expect(mergeMapOf(s)).toEqual({ [A]: 'c-deleted-custom' }, 'the stored mapping itself is not rewritten')
  })
  it('a merge re-points only the mapping: stored workout records are byte-identical before and after', () => {
    const s = fixture()
    const recordsBefore = JSON.stringify({ workouts: s.workouts, routines: s.routines, tests: s.tests, body: s.body, favEx: s.favEx, exWeights: s.exWeights })
    mergeExercise(s, A, B)
    const recordsAfter = JSON.stringify({ workouts: s.workouts, routines: s.routines, tests: s.tests, body: s.body, favEx: s.favEx, exWeights: s.exWeights })
    expect(recordsAfter).toBe(recordsBefore)
  })
})

describe('the target is what the app shows and aggregates', () => {
  it('history / PR: the 1RM series and the best of the merged exercise include its sets under the target', () => {
    const s = fixture()
    expect(e1rmSeries(s, A).map(p => p.d)).toEqual(['2026-10-01', '2026-10-05'])
    expect(e1rmSeries(s, B).map(p => p.d)).toEqual(['2026-10-05'], 'before the merge B only has its own set in w2')
    mergeExercise(s, A, B)
    // after the merge B counts w1 (A's entry) and w2 (both its own entry and A's entry: the best of them)
    const series = e1rmSeries(s, B)
    expect(series.map(p => p.d)).toEqual(['2026-10-01', '2026-10-05'])
    expect(series[1].y).toBeCloseTo(105 * (1 + 4 / 30), 5, 'the best of w2 is the 105×4 set, from A')
    expect(e1rmSeries(s, A)).toEqual(series, 'asking for the merged id gives the target')
    expect(best1RM(s, A)?.est).toBeCloseTo(best1RM(s, B).est)
  })
  it('tested 1RMs recorded on the merged exercise belong to the target', () => {
    const s = fixture()
    mergeExercise(s, A, B)
    expect(oneRMTests(s, B).map(t => t.id)).toEqual(['t1'])
  })
  it('volume per muscle counts the merged sets under the target muscles', () => {
    const s = fixture()
    const opts = muscleOptsOf(s)
    const before = loadOfWorkouts(s.workouts, null, opts)
    mergeExercise(s, A, B)
    const after = loadOfWorkouts(s.workouts, null, muscleOptsOf(s))
    // the same load as if the stored records said B where they say A (the expected answer, computed by hand)
    const rewritten = clone(s.workouts).map(w => ({ ...w, entries: w.entries.map(e => ({ ...e, id: e.id === A ? B : e.id })) }))
    expect(after).toEqual(loadOfWorkouts(rewritten, null, opts))
    expect(after).not.toEqual(before)
  })
  it('favourites and recents show the target, and the merged exercise no longer appears in recents', () => {
    const s = fixture()
    mergeExercise(s, A, B)
    expect(favSetOf(s).has(B)).toBe(true)
    expect(favSetOf(s).has(A)).toBe(false)
    const recent = recentIdsOf(s)
    expect(recent).toContain(B)
    expect(recent).not.toContain(A)
    expect(new Set(recent).size).toBe(recent.length)
  })
  it('the stored favourite list and exercise weights keep the original id', () => {
    const s = fixture()
    mergeExercise(s, A, B)
    expect(s.favEx).toEqual([A])
    expect(s.exWeights).toEqual({ [A]: 100 })
  })
})
