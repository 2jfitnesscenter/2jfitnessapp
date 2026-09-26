import { describe, expect, it } from 'vitest'
import { dateSortValue, fmtDate } from './format.js'

describe('fmtDate mixed persisted formats', () => {
  it('formats the current millisecond timestamp shape', () => {
    const value = Date.UTC(2026, 8, 22, 10, 30)
    expect(fmtDate(value, true)).not.toBe('Invalid Date')
    expect(dateSortValue(value)).toBe(value)
  })

  it.each([
    '2026-09-22',
    '2026-09-22T10:30:00.000Z',
    String(Date.UTC(2026, 8, 22, 10, 30)),
  ])('formats the legacy value %s', value => {
    expect(fmtDate(value, true)).not.toBe('Invalid Date')
    expect(fmtDate(value, true)).not.toBe('—')
  })

  it.each([undefined, null, '', 'not-a-date'])('uses a safe fallback for %s', value => {
    expect(fmtDate(value, true)).toBe('—')
    expect(dateSortValue(value)).toBe(0)
  })
})
