import { describe, it, expect } from 'vitest'
import { fmtClock } from './clock.js'

describe('fmtClock', () => {
  it('formats under an hour as m:ss', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(9)).toBe('0:09')
    expect(fmtClock(65)).toBe('1:05')
    expect(fmtClock(599)).toBe('9:59')
  })
  it('formats an hour or more as h:mm:ss', () => {
    expect(fmtClock(3600)).toBe('1:00:00')
    expect(fmtClock(3661)).toBe('1:01:01')
  })
  it('is defensive about junk input', () => {
    expect(fmtClock(-5)).toBe('0:00')
    expect(fmtClock(NaN)).toBe('0:00')
  })
})
