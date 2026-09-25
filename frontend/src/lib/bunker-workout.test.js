import { describe, expect, it } from 'vitest'
import { nextAfterBunkerSet, bunkerRestSec, BUNKER_REST_FALLBACK } from './bunker-workout.js'

const entry = (id, sg, done = false) => ({ id, ...(sg ? { sg } : {}), sets: [{ w: 20, r: 10, done }] })

describe('Bunker superset progression', () => {
  it('starts rest after a normal exercise set', () => {
    expect(nextAfterBunkerSet([entry('a')], 0, 0)).toEqual({ rest: true, nextEntry: null })
  })

  it('moves from A1 to A2 without starting rest between partners', () => {
    expect(nextAfterBunkerSet([entry('a', 'g'), entry('b', 'g')], 0, 0))
      .toEqual({ rest: false, nextEntry: 1 })
  })

  it('starts rest only after the other superset partner is complete', () => {
    expect(nextAfterBunkerSet([entry('a', 'g', true), entry('b', 'g')], 1, 0))
      .toEqual({ rest: true, nextEntry: null })
  })
})

describe('Bunker prescribed rest (Constructor V2.1)', () => {
  const e = (id, rest, sg, blk) => ({ id, ...(sg ? { sg } : {}), target: { ...(rest != null ? { rest } : {}), ...(blk ? { blk } : {}) }, sets: [{ w: 20, r: 10, done: true }] })
  it('uses the rest the trainer prescribed, and 90 s when there is none (older routines, freestyle)', () => {
    expect(bunkerRestSec([e('a', 150)], 0)).toBe(150)
    expect(bunkerRestSec([e('a', 45)], 0)).toBe(45)
    expect(bunkerRestSec([e('a')], 0)).toBe(BUNKER_REST_FALLBACK)
    expect(BUNKER_REST_FALLBACK).toBe(90)
    expect(bunkerRestSec([{ id: 'x', sets: [] }], 0)).toBe(90)
    expect(bunkerRestSec([], 3)).toBe(90)
  })
  it('a superset rests once with the pair prescription (its last exercise, else the longest)', () => {
    expect(bunkerRestSec([e('a', null, 'g'), e('b', 120, 'g')], 0)).toBe(120)
    expect(bunkerRestSec([e('a', 75, 'g'), e('b', null, 'g')], 1)).toBe(75)
    expect(bunkerRestSec([e('a', null, 'g'), e('b', null, 'g')], 1)).toBe(90)
  })
  it('a guided block logged at the Bunker rests what its timing says between rounds', () => {
    const blocks = [{ iid: 'k1', type: 'circuit', timing: { rest: 20, roundRest: 60 } }, { iid: 'k2', type: 'hiit', timing: { rest: 10, roundRest: 0 } }]
    expect(bunkerRestSec([e('a', null, null, 'k1')], 0, blocks)).toBe(60)
    expect(bunkerRestSec([e('a', null, null, 'k2')], 0, blocks)).toBe(10)
    expect(bunkerRestSec([e('a', 150, null, 'k9')], 0, blocks)).toBe(150)
  })
  it('several athletes never share a rest: each is computed from that athlete own session only', () => {
    const ana = [e('a', 180)], ben = [e('b')]
    expect([bunkerRestSec(ana, 0), bunkerRestSec(ben, 0)]).toEqual([180, 90])
  })
})
