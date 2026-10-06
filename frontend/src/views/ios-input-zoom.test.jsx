import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/* iOS Safari zooms into any focused field whose computed font-size is below 16px. Once the page is zoomed, the visual viewport no longer matches the layout viewport
   and position:fixed bars (#tabbar) slide to the middle of the screen while scrolling. The workout's set inputs (.stp .num — 14px in the effort layout, and
   below 16px at the smaller text scale) triggered it; the viewport meta no longer forbids zoom since Sprint 3 (accessibility), so the fields themselves must be >= 16px. */
const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
const rule = sel => css.split(/\r?\n/).find(l => l.trim().startsWith(sel) && l.includes('font-size')) || css.split(/\r?\n/).slice(css.split(/\r?\n/).findIndex(l => l.trim().startsWith(sel)), 12 + css.split(/\r?\n/).findIndex(l => l.trim().startsWith(sel))).join('\n')

describe('text fields never drop below 16px (no iOS focus zoom)', () => {
  it('the workout set inputs, the generic fields, the time field and the Train2J search are floored at 16px', () => {
    expect(rule('.stp .num{')).toMatch(/font-size:max\(16px,calc\(17px \* var\(--text-scale,1\)\)\)/)
    expect(css).toMatch(/\.setrow\.eff3 \.stp \.num\{font-size:max\(16px,calc\(14px \* var\(--text-scale,1\)\)\)\}/)
    expect(rule('.field,.input{')).toMatch(/font-size:max\(16px,calc\(17px \* var\(--text-scale,1\)\)\)/)
    expect(rule('.timef{')).toMatch(/font-size:max\(16px,calc\(16px \* var\(--text-scale,1\)\)\)/)
    expect(css).toMatch(/\.t2-search input\{[^}]*font-size:16px/)
  })
  it('the tab bar stays a plain fixed bar with no transform/filter ancestor to anchor it elsewhere, and the viewport keeps pinch zoom', () => {
    expect(css).toMatch(/#tabbar\{\s*position:fixed;left:0;right:0;bottom:0/)
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8')
    expect(html).toContain('<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">')
    expect(html).not.toMatch(/user-scalable=no|maximum-scale/)
  })
})
