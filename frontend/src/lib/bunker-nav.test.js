import { describe, expect, it } from 'vitest'
import { bunkerOutline, bunkerUnit, upNext, stepTargets, goToExercise } from './bunker-nav.js'
import { nextAfterBunkerSet } from './bunker-workout.js'

const set = (done, w = 40, r = 8) => ({ w, r, done })
const ex = (id, done, extra = {}) => ({ id, sets: done.map(d => set(d)), target: { sets: done.length }, ...extra })
// 7 exercises, A+B superset in the middle (3 and 4), the first one finished
const routine = () => [
  ex('0001', [true, true, true]), ex('0002', [false, false]), ex('0003', [false, false], { sg: 's1' }), ex('0004', [false, false], { sg: 's1' }),
  ex('0005', [false]), ex('0006', [false, false, false]), ex('0007', [false, false]),
]

describe('the whole routine, not one exercise', () => {
  it('lists every exercise with its set counts and where it stands: done, current, next', () => {
    const rows = bunkerOutline(routine(), 1)
    expect(rows).toHaveLength(7)
    expect(rows.map(r => r.state)).toEqual(['done', 'current', 'next', 'todo', 'todo', 'todo', 'todo'])
    expect(rows[0]).toMatchObject({ done: 3, total: 3 })
    expect(rows[2]).toMatchObject({ done: 0, total: 2 })
  })
  it('"up next" skips the rest of the current superset and finished exercises, then looks back, then says nothing is left', () => {
    const e = routine()
    expect(upNext(e, 2)).toBe(4)                       // on A of the superset: the next thing is after the pair
    expect(upNext(e, 6)).toBe(1)                       // at the end: the first unfinished one before
    const all = e.map(x => ({ ...x, sets: x.sets.map(s => ({ ...s, done: true })) }))
    expect(upNext(all, 3)).toBeNull()
  })
  it('previous / next are plain neighbours and stop at the ends', () => {
    expect(stepTargets(routine(), 0)).toEqual({ prev: null, next: 1 })
    expect(stepTargets(routine(), 3)).toEqual({ prev: 2, next: 4 })
    expect(stepTargets(routine(), 6)).toEqual({ prev: 5, next: null })
    expect(stepTargets([], 0)).toEqual({ prev: null, next: null })
  })
})

describe('navigating never loses a set', () => {
  it('only the cursor moves: the very same entries come back, going forward and back', () => {
    const active = { id: 'w1', cur: 1, entries: routine() }
    active.entries[1].sets[0] = { w: 62.5, r: 9, done: true, rpe: 8 }
    const snapshot = JSON.stringify(active.entries)
    const there = goToExercise(active, 5)
    expect(there.cur).toBe(5); expect(there.entries).toBe(active.entries)
    const back = goToExercise(there, 1)
    expect(back.cur).toBe(1); expect(JSON.stringify(back.entries)).toBe(snapshot)
    expect(back.entries[1].sets[0]).toEqual({ w: 62.5, r: 9, done: true, rpe: 8 })
  })
  it('out of range is clamped, the same index changes nothing, an empty session is returned as it is', () => {
    const active = { cur: 2, entries: routine() }
    expect(goToExercise(active, 99).cur).toBe(6); expect(goToExercise(active, -4).cur).toBe(0)
    expect(goToExercise(active, 2)).toBe(active)
    const free = { cur: 0, entries: [] }
    expect(goToExercise(free, 3)).toBe(free)
  })
})

describe('supersets stay together', () => {
  it('the pair is one unit; a lone exercise is its own', () => {
    expect(bunkerUnit(routine(), 2)).toEqual([2, 3]); expect(bunkerUnit(routine(), 3)).toEqual([2, 3]); expect(bunkerUnit(routine(), 4)).toEqual([4])
  })
  it('switching A/B changes the cursor only: each partner keeps its own sets, and logging on one never writes to the other', () => {
    const active = { cur: 2, entries: routine() }
    const onB = goToExercise(active, 3)
    expect(onB.entries[2].sets).toBe(active.entries[2].sets); expect(onB.entries[3].sets).toBe(active.entries[3].sets)
    // log set 1 on A, then B: alternation is the existing rule (A1 -> B1 -> rest), and the data stays in its own entry
    const afterA = { ...active, entries: active.entries.map((e, i) => i !== 2 ? e : { ...e, sets: e.sets.map((s, j) => j === 0 ? { ...s, w: 50, done: true } : s) }) }
    expect(nextAfterBunkerSet(afterA.entries, 2, 0)).toEqual({ rest: false, nextEntry: 3 })
    expect(afterA.entries[3].sets.every(s => !s.done && s.w === 40)).toBe(true)
  })
})
