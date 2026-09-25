import { describe, expect, it, vi } from 'vitest'
import { summarizeHr, hrAccumulator, fitnessOf, maxHrFor, mapWhoopWorkout } from './fitness.js'

vi.mock('../sheets.jsx', () => ({ confirmSheet: vi.fn() }))
vi.mock('../store/useStore.js', () => ({ useStore: vi.fn() }))
const { zoneOrigin } = await import('../components/FitnessSummary.jsx')

/* Three zone origins that must never be confused: (A) the source's own zones, (B) 2J's split
 * against a max HR the member declared, (C) 2J's split against the 220 − age estimate. */
const samples = [{ t: 0, v: 120 }, { t: 300000, v: 150 }, { t: 600000, v: 160 }]
const age = () => 30

describe('zone provenance in the model', () => {
  it('B: declared max HR is recorded as declared', () => {
    const ref = maxHrFor({ hrMax: 185 }, age)
    expect(ref).toEqual({ value: 185, kind: 'declared' })
    expect(summarizeHr(samples, ref).zones).toMatchObject({ derived: true, hrMax: 185, hrMaxKind: 'declared' })
  })
  it('C: 220 − age is recorded as calculated (an estimate), live sensor included', () => {
    const ref = maxHrFor({ birthDate: '1996-01-01' }, age)
    expect(ref).toEqual({ value: 190, kind: 'calculated' })
    const acc = hrAccumulator(ref); acc.add(120, 0); acc.add(150, 300000)
    expect(acc.result().zones).toMatchObject({ derived: true, hrMax: 190, hrMaxKind: 'calculated' })
  })
  it('a bare number keeps working but claims no basis', () => {
    expect(summarizeHr(samples, 190).zones.hrMaxKind).toBeNull()
  })
  it('A: source zones stay source zones', () => {
    const r = mapWhoopWorkout({ id: 'x', score_state: 'SCORED', start: '2026-09-20T10:00:00Z', end: '2026-09-20T11:00:00Z',
      score: { zone_durations: { zone_one_milli: 600000 } } })
    expect(r.zones).toMatchObject({ scheme: 'source', derived: false })
    expect(r.zones.hrMaxKind).toBeUndefined()
  })
  it('legacy Apple imports (always 220 − age before Health V2) read as estimated', () => {
    expect(fitnessOf({ hrZones: { avg: 130, max: 170, z: [1, 2, 3, 4, 5] } }).zones.hrMaxKind).toBe('calculated')
  })
})

describe('zone provenance in words', () => {
  it('says which of the three it is, and an estimate is never a measured max HR', () => {
    expect(zoneOrigin({ source: 'whoop', zones: { scheme: 'source', derived: false } })).toBe('Zones provided by WHOOP, as it calculated them.')
    const declared = zoneOrigin({ source: 'ble', zones: { scheme: 'hrmax', derived: true, hrMax: 185, hrMaxKind: 'declared' } })
    expect(declared).toContain('max HR you declared (185 bpm)')
    const est = zoneOrigin({ source: 'ble', zones: { scheme: 'hrmax', derived: true, hrMax: 190, hrMaxKind: 'calculated' } })
    expect(est).toContain('estimated max HR of 190 bpm (220 − age)')
    expect(est).toContain('not a measured value')
    expect(zoneOrigin({ source: 'ble', zones: { scheme: 'hrmax', derived: true, hrMax: 190, hrMaxKind: null } })).toContain('was not recorded')
    expect(zoneOrigin({ source: 'ble', zones: null })).toBeNull()
  })
})
