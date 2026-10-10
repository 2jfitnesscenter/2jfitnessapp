import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { orderedBodyWeightSeries, latestBodyWeight, previousBodyWeight } from './bodyweight.js'
import { lastBW } from './history.js'
import { seriesOf, bmiOf } from './health.js'
import { bodyweightNear } from './measurements.js'
import { compositionBlock } from './health-v2.js'

/* One reader of body weight: S.bodyweight stays the only store; ordering, latest and previous are decided here and nowhere else. */
const e = (d, w, extra = {}) => ({ d, w, ...extra })

describe('orderedBodyWeightSeries / latest / previous', () => {
  const messy = { bodyweight: [e('2026-09-10', 81), e('2026-09-01', 83, { src: 'scan' }), e('2026-09-05', 82, { t: 5 }), e('2026-09-05', 82.4, { t: 9 }), null, e('bad', 70), e('2026-09-20', -3), e('2026-09-21', NaN), e('2026-09-22', 'x'), { w: 80 }] }
  it('orders by day, then by the moment it was logged, and ignores anything invalid', () => {
    expect(orderedBodyWeightSeries(messy).map(x => x.w)).toEqual([83, 82, 82.4, 81])
    expect(orderedBodyWeightSeries(messy)[0].src).toBe('scan')                       // the stored entry itself: origin intact
  })
  it('the latest reading wins even when it was appended out of order', () => {
    expect(latestBodyWeight(messy).w).toBe(81)
    expect(latestBodyWeight({ bodyweight: [e('2026-09-10', 81), e('2026-09-01', 83)] }).w).toBe(81)
    expect(latestBodyWeight({ bodyweight: [e('2026-09-10', 81, { t: 1 }), e('2026-09-10', 80.5, { t: 2 })] }).w).toBe(80.5)   // same day: the later log
  })
  it('previous is the latest reading from an EARLIER day', () => {
    expect(previousBodyWeight(messy).w).toBe(82.4)
    expect(previousBodyWeight({ bodyweight: [e('2026-09-10', 81, { t: 1 }), e('2026-09-10', 80.5, { t: 2 })] })).toBeNull()   // one day only: nothing to compare with
    expect(previousBodyWeight({ bodyweight: [e('2026-09-10', 81)] })).toBeNull()
  })
  it('legacy and empty profiles never throw', () => {
    for (const S of [undefined, null, {}, { bodyweight: null }, { bodyweight: [] }, { bodyweight: 'x' }]) {
      expect(orderedBodyWeightSeries(S)).toEqual([]); expect(latestBodyWeight(S)).toBeNull(); expect(previousBodyWeight(S)).toBeNull()
    }
  })
  it('does not touch or copy the stored series (no second store)', () => {
    const S = { bodyweight: [e('2026-09-10', 81), e('2026-09-01', 83)] }
    const before = JSON.stringify(S)
    orderedBodyWeightSeries(S); latestBodyWeight(S); previousBodyWeight(S)
    expect(JSON.stringify(S)).toBe(before)
  })
})

describe('every reader agrees on the same weight (disordered legacy data)', () => {
  const S = { unit: 'kg', height: 180, bodyweight: [e('2026-09-10', 81), e('2026-08-01', 85), e('2026-09-01', 83)], measurements: {}, targetW: 78 }
  it('history.lastBW, the Health series, BMI, the composition tile and the nearest-weight lookup', () => {
    expect(lastBW(S).w).toBe(81)
    expect(seriesOf(S, 'weight').map(p => p.v)).toEqual([85, 83, 81])
    expect(bmiOf(S)).toBe(Math.round(81 / 1.8 ** 2 * 10) / 10)
    expect(compositionBlock(S).weight).toEqual({ v: 81, d: '2026-09-10' })
    expect(bodyweightNear(S, '2026-09-05')).toBe(83)
    expect(bodyweightNear(S, '2026-07-01')).toBe(85)                                  // older than the first reading → the earliest
  })
})

describe('nobody reads the weight by array position any more', () => {
  const walk = d => readdirSync(d).flatMap(n => { const p = d + '/' + n; return statSync(p).isDirectory() ? (n === 'locales' ? [] : walk(p)) : /\.(js|jsx)$/.test(n) && !/\.test\./.test(n) ? [p] : [] })
  const files = walk(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
  it('no [length - 1] / [length - 2] / slice(-1) over S.bodyweight outside the helper', () => {
    const byPosition = /\b(?:S|st|s)\.bodyweight\??\.slice\(-1\)|\b(?:S|st|s)\.bodyweight\[\s*(?:S|st|s)\.bodyweight\??\.length\s*-\s*[12]\s*\]/
    const bad = files.filter(f => !f.endsWith('lib/bodyweight.js')).filter(f => byPosition.test(readFileSync(f, 'utf8')))
    expect(bad).toEqual([])
  })
  it('BodyWeightCard (no consumer) is gone', () => {
    expect(files.some(f => f.endsWith('components/BodyWeightCard.jsx'))).toBe(false)
  })
})
