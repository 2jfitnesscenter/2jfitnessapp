import { describe, expect, it } from 'vitest'
import { nextAfterBunkerSet } from './bunker-workout.js'

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
