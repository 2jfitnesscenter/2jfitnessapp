import { describe, expect, it } from 'vitest'
import { fmtNum, fmtVol } from './format.js'

/* A missing or corrupt number is never printed as "NaN" (and never turned into a made-up 0). */
describe('numbers that are not numbers', () => {
  it('fmtNum shows a dash, not NaN', () => {
    for (const v of [NaN, undefined, Infinity, -Infinity, 'abc', {}]) expect(fmtNum(v)).toBe('—')
    expect(fmtNum(12.34)).not.toContain('NaN')
  })
  it('real values, including zero, are untouched', () => {
    expect(fmtNum(0)).toBe('0'); expect(fmtNum(7)).toBe('7'); expect(fmtNum('12')).toBe('12')
  })
  it('a volume without a number reads as a dash with no unit; a real one keeps its unit', () => {
    expect(fmtVol(NaN, 'kg')).toBe('—'); expect(fmtVol(undefined, 'kg')).toBe('—')
    expect(fmtVol(1200, 'kg')).toContain('kg')
  })
})
