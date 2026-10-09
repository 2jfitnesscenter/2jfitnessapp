import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import LineChart from './LineChart.jsx'

/* The chart never prints NaN: a point without a moment falls back to its day, and one with neither is left out (no invented value). */
describe('LineChart never draws NaN', () => {
  it('points without t use their day', () => {
    const h = renderToStaticMarkup(<LineChart points={[{ d: '2026-08-01', y: 80 }, { d: '2026-09-09', y: 85 }]} />)
    expect(h).not.toContain('NaN')
  })
  it('points with neither t nor a valid day, or a non-finite y, are skipped', () => {
    const h = renderToStaticMarkup(<LineChart points={[{ y: 80 }, { d: 'x', y: 81 }, { d: '2026-09-09', y: NaN }, { d: '2026-09-09', y: 85 }]} />)
    expect(h).not.toContain('NaN')
  })
  it('nothing drawable shows the empty state', () => {
    expect(renderToStaticMarkup(<LineChart points={[{ y: 1 }]} />)).toContain('No data yet')
  })
})
