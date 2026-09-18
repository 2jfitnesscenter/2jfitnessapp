import { describe, it, expect } from 'vitest'
import { plateBreakdown, BARBELL_TYPES } from './BarbellPlates.jsx'

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
