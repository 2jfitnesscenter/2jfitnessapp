import { describe, it, expect } from 'vitest'
import { plateBreakdown, plateBreakdownMinChange, groupPlates, BARBELL_TYPES, DEFAULT_AVAILABLE_KG } from './BarbellPlates.jsx'

describe('plateBreakdown', () => {
  it('splits an exactly-reachable weight into the biggest plates first, per side', () => {
    const { barW, perSide, plates, leftover } = plateBreakdown(60, 'kg')
    expect(barW).toBe(20)
    expect(perSide).toBe(20)
    expect(plates.map(p => p.w)).toEqual([20])
    expect(leftover).toBe(0)
  })

  it('uses an explicit bar weight (the bar-type picker) instead of the plain 20kg default', () => {
    const { barW, plates } = plateBreakdown(45, 'kg', 15)   // a Smith/multipower bar
    expect(barW).toBe(15)
    expect(plates.map(p => p.w)).toEqual([15])
  })

  it('needs only the bar when the target is at or below the bar weight', () => {
    expect(plateBreakdown(20, 'kg').plates).toEqual([])
    expect(plateBreakdown(15, 'kg').plates).toEqual([])
    expect(plateBreakdown(15, 'kg').achieved).toBe(20)   // can't go lighter than an empty bar
  })

  it('reports the shortfall when the target isn\'t exactly reachable with these plates', () => {
    // 20kg bar + 0.5kg/side wanted — no plate is that small, so nothing gets added.
    const { plates, leftover, achieved } = plateBreakdown(21, 'kg')
    expect(plates).toEqual([])
    expect(achieved).toBe(20)
    expect(leftover).toBe(1)
  })

  it('is exact (leftover 0) whenever the target lands on a real combination', () => {
    // 20kg bar + 25+10 a side (35kg/side) = 90kg total.
    const { plates, leftover } = plateBreakdown(90, 'kg')
    expect(plates.map(p => p.w)).toEqual([25, 10])
    expect(leftover).toBe(0)
  })

  it('falls back to the plain 45lb bar when no explicit barW is given', () => {
    expect(plateBreakdown(135, 'lb').barW).toBe(45)
  })
})

describe('plateBreakdown with an `available` filter', () => {
  it('skips a disabled denomination, falling back to smaller plates instead', () => {
    // 90kg is normally 25+10/side; with 10kg switched off it's made up of smaller plates instead
    // (2.5kg is still on, so 35kg/side stays exactly reachable — just with more discs).
    const { plates, leftover } = plateBreakdown(90, 'kg', 20, DEFAULT_AVAILABLE_KG.filter(w => w !== 10))
    expect(plates.map(p => p.w)).toEqual([25, 5, 5])
    expect(leftover).toBe(0)
  })
  it('1.25kg is excluded from the default available set', () => {
    // 21.25kg/side isn't reachable with only 1.25kg missing from an otherwise-exact combo.
    const withDefault = plateBreakdown(20 + 2 * 21.25, 'kg', 20, DEFAULT_AVAILABLE_KG)
    expect(withDefault.leftover).toBeGreaterThan(0)
    const withMicroPlate = plateBreakdown(20 + 2 * 21.25, 'kg', 20, [...DEFAULT_AVAILABLE_KG, 1.25])
    expect(withMicroPlate.leftover).toBe(0)
  })
})

describe('groupPlates', () => {
  it('collapses repeated plates into one row per denomination, heaviest first', () => {
    const { plates } = plateBreakdown(85, 'kg')   // 20kg bar, 32.5kg/side = 25+5+2.5
    const groups = groupPlates(plates)
    expect(groups).toEqual([
      { w: 25, color: expect.any(String), count: 1, outline: undefined },
      { w: 5, color: expect.any(String), count: 1, outline: true },
      { w: 2.5, color: expect.any(String), count: 1, outline: undefined },
    ])
  })
  it('counts multiple discs of the same size as one grouped row', () => {
    const { plates } = plateBreakdown(20 + 2 * 20, 'kg', 20, [10])   // only 10kg plates available, 20kg/side
    const groups = groupPlates(plates)
    expect(groups).toEqual([{ w: 10, color: expect.any(String), count: 2, outline: undefined }])
  })
})

describe('plateBreakdownMinChange', () => {
  it('matches plain greedy when nothing needs to be removed, only added', () => {
    // 40kg (10/side) -> 45kg (12.5/side): the existing 10kg plate is kept, a 2.5kg is added.
    const r = plateBreakdownMinChange(40, 45, 'kg', 20, DEFAULT_AVAILABLE_KG)
    expect(r.plates.map(p => p.w)).toEqual([10, 2.5])
    expect(r.leftover).toBe(0)
  })
  it('sheds the fewest plates needed when the new target is lighter', () => {
    // 90kg (35/side = 25+10) -> 70kg (25/side): the 10kg has to go, the 25kg stays untouched.
    const r = plateBreakdownMinChange(90, 70, 'kg', 20, DEFAULT_AVAILABLE_KG)
    expect(r.plates.map(p => p.w)).toEqual([25])
    expect(r.leftover).toBe(0)
  })
  it('is a no-op when the target is unchanged', () => {
    const r = plateBreakdownMinChange(80, 80, 'kg', 20, DEFAULT_AVAILABLE_KG)
    expect(r.plates.map(p => p.w)).toEqual([25, 5])
  })
})

describe('BARBELL_TYPES', () => {
  it('has a unique id for every bar type, even the two both worth 15kg', () => {
    const ids = BARBELL_TYPES.map(b => b.id)
    expect(new Set(ids).size).toBe(ids.length)
    const fifteens = BARBELL_TYPES.filter(b => b.kg === 15)
    expect(fifteens.length).toBe(2)
  })
  it('includes the "no bar" option at 0kg, for machines', () => {
    expect(BARBELL_TYPES.find(b => b.id === 'none')?.kg).toBe(0)
  })
})
