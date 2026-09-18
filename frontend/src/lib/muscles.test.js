import { describe, it, expect } from 'vitest'
import { musclesOf, loadOf, muscleOptsOf, DEFAULT_SECONDARY_FACTOR } from './muscles.js'

// A synthetic bench-press-shaped exercise — primary chest, secondary triceps + deltoids —
// so these tests exercise musclesOf's own weighting logic rather than depending on exactly
// how the shipped dataset spells a given exercise's tg/sm fields.
const BENCH = { id: 'bench', tg: 'pectorals', sm: ['triceps', 'shoulders'], bp: 'chest' }

describe('musclesOf — secondary-muscle weighting (Settings → Statistics)', () => {
  it('defaults to the primary at 1 and secondaries at 0.4, same as before this setting existed', () => {
    expect(musclesOf(BENCH)).toEqual({ chest: 1, triceps: 0.4, deltoids: 0.4 })
  })
  it('applies a custom secondary factor when one is given', () => {
    expect(musclesOf(BENCH, { secondaryFactor: 0.5 })).toEqual({ chest: 1, triceps: 0.5, deltoids: 0.5 })
  })
  it('drops secondaries entirely when countSecondary is off, primary untouched', () => {
    expect(musclesOf(BENCH, { countSecondary: false })).toEqual({ chest: 1 })
  })
  it('countSecondary: false wins even if a secondaryFactor is also given', () => {
    expect(musclesOf(BENCH, { countSecondary: false, secondaryFactor: 0.75 })).toEqual({ chest: 1 })
  })
})

describe('loadOf — the same weighting carried through to set counts', () => {
  // Real dataset id "0025" (barbell bench press): tg pectorals, sm [triceps, shoulders] —
  // the same primary/secondary shape as the synthetic BENCH above, this time run through
  // loadOf's own EXIDX lookup instead of a hand-built exercise object.
  const BENCH_ID = '0025'
  it('credits a secondary muscle its factor times the sets, per the spec’s own example', () => {
    // "4 series de banca suman 4 series a pecho y 4 * 0.5 = 2 series a tríceps"
    const load = loadOf([{ id: BENCH_ID, sets: 4 }], { secondaryFactor: 0.5 })
    expect(load.chest).toBe(4)
    expect(load.triceps).toBe(2)
  })
  it('ignoring secondaries leaves only the primary muscle credited', () => {
    const load = loadOf([{ id: BENCH_ID, sets: 4 }], { countSecondary: false })
    expect(load).toEqual({ chest: 4 })
  })
})

describe('muscleOptsOf', () => {
  it('reads the two profile settings, defaulting a missing countSecondaryMuscles to on', () => {
    expect(muscleOptsOf({})).toEqual({ countSecondary: true, secondaryFactor: undefined })
    expect(muscleOptsOf({ countSecondaryMuscles: false, secondaryMuscleFactor: 0.25 }))
      .toEqual({ countSecondary: false, secondaryFactor: 0.25 })
  })
  it('a real profile (DEF’s own default of 0.5) feeds straight into musclesOf', () => {
    const opts = muscleOptsOf({ secondaryMuscleFactor: DEFAULT_SECONDARY_FACTOR })
    expect(musclesOf(BENCH, opts).triceps).toBe(DEFAULT_SECONDARY_FACTOR)
  })
})
