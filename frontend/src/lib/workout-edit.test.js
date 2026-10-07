import { describe, expect, it } from 'vitest'
import { editWorkoutEntries, recalculateWorkoutPRFlags, replaceWorkoutEntries, setWorkoutExcluded, reconcileExerciseWeightCache } from './workout-edit.js'

const workout = (id, w, excluded = false) => ({ id, d: id, start: 1, end: 2, entries: [{ id: 'bench', target: { reps: 5 }, sets: [{ w, r: 5, done: true }] }], prs: [], vol: w * 5, ...(excluded ? { excludeFromProgression: true } : {}) })

describe('historical workout edits', () => {
  it('keeps the stable workout/exercise identity, stores set changes, and recalculates volume', () => {
    const original = workout('w1', 60)
    const edited = editWorkoutEntries(original, [{ id: 'bench', sets: [{ w: '62.5', r: '6', done: true }] }])
    expect(edited).toMatchObject({ id: 'w1', d: 'w1', start: 1, end: 2, vol: 375 })
    expect(edited.entries[0]).toMatchObject({ id: 'bench', target: { reps: 5 }, sets: [{ w: 62.5, r: 6, done: true }] })
    expect(original.entries[0].sets[0]).toMatchObject({ w: 60, r: 5 })
  })

  it('rejects exercise replacement and unsafe numeric values', () => {
    expect(() => editWorkoutEntries(workout('w1', 60), [{ id: 'squat', sets: [{ w: 60, r: 5, done: true }] }])).toThrow(/cannot be replaced/)
    expect(() => editWorkoutEntries(workout('w1', 60), [{ id: 'bench', sets: [{ w: 'NaN', r: 5, done: true }] }])).toThrow(/Invalid w/)
  })

  it('a newly added historical set must explicitly be completed', () => {
    expect(() => editWorkoutEntries(workout('w1', 60), [{ id: 'bench', sets: [{ w: 60, r: 5, done: true }, { w: 60, r: 4, done: false }] }])).toThrow(/marked as completed/)
  })

  it('recalculates PR flags using only included history when editing/excluding a session', () => {
    const rows = [workout('w1', 60), workout('w2', 70), workout('w3', 65)]
    expect(recalculateWorkoutPRFlags(rows).map(w => w.prs)).toEqual([['bench'], ['bench'], []])
    const excluded = setWorkoutExcluded(rows, 'w2', true)
    expect(excluded.map(w => w.prs)).toEqual([['bench'], [], ['bench']])
    expect(excluded.find(w => w.id === 'w2')).toMatchObject({ excludeFromProgression: true })
    const includedAgain = setWorkoutExcluded(excluded, 'w2', false)
    expect(includedAgain.map(w => w.prs)).toEqual([['bench'], ['bench'], []])
    const edited = replaceWorkoutEntries(rows, 'w2', [{ id: 'bench', sets: [{ w: 55, r: 5, done: true }] }])
    expect(edited.map(w => w.prs)).toEqual([['bench'], [], ['bench']])
  })

  it('removes a cached starting load sourced from an excluded workout without changing manual caches', () => {
    const rows = [workout('w1', 60), workout('w2', 70)]
    const caches = { bench: { w: 70, d: 'w2', sourceWorkoutId: 'w2' }, squat: { w: 100, d: 'manual' } }
    const excluded = setWorkoutExcluded(rows, 'w2', true)
    expect(reconcileExerciseWeightCache(caches, excluded, rows[1])).toEqual({ bench: { w: 60, d: 'w1', sourceWorkoutId: 'w1' }, squat: { w: 100, d: 'manual' } })
  })
})
