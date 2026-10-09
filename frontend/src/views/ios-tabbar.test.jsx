import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/* The bottom navigation must stay anchored to the viewport on iOS. WebKit's behaviour cannot be proved here (no jsdom/WebKit physics), so this pins the STRUCTURE the fix relies on:
   the bar is fixed to the viewport edges and sits outside the animated/scrolling content, the root elements carry no overflow (it would propagate to the viewport), nothing above
   the bar creates a containing block for fixed elements, safe areas are used once, and the content leaves room for the bar. Real-device check: docs/IOS_TABBAR_QA.md. */
const read = f => readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const css = read('../index.css').replace(/\/\*[\s\S]*?\*\//g, '')
const rule = sel => { const m = css.match(new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\#]/g, '\\$&') + '\\s*\\{([^}]*)\\}')); return m ? m[1] : null }

describe('bottom navigation stays fixed to the viewport', () => {
  it('is fixed to the left, right and bottom edges, above the content, with the safe area added once', () => {
    const r = rule('#tabbar')
    expect(r).toMatch(/position:fixed;left:0;right:0;bottom:0/)
    expect(r).toMatch(/z-index:50/)
    expect(r.match(/safe-area|--sab/g)).toHaveLength(1)                                    // padding-bottom only: never doubled
    expect(css).toMatch(/--sab:env\(safe-area-inset-bottom,0px\)/)
    expect(r).toMatch(/transform:translateZ\(0\)/)                                           // its own compositing layer (backdrop-filter bar)
  })
  it('the desktop floating pill still positions itself (its own transform wins at wide widths)', () => {
    expect(css).toMatch(/#tabbar\{\s*left:50%;right:auto;bottom:16px;transform:translateX\(-50%\)/)
  })
  it('lives outside the animated #app and outside any scroll container', () => {
    const app = read('../App.jsx')
    const appBlock = app.slice(app.indexOf('<div id="app" className="vfade"'), app.indexOf('</div>', app.indexOf('<div id="app" className="vfade"')))
    expect(appBlock).not.toContain('<TabBar')
    expect(app).toMatch(/<\/div>\s*\{\/\*[\s\S]*?\*\/\}\s*<HealthOnboardingGate[\s\S]*?<TabBar \/>/)   // sibling of #app inside the fragment under #root
    const tab = read('../components/TabBar.jsx')
    expect(tab).toContain('<nav id="tabbar">')
    expect(tab).not.toMatch(/overflow|transform|filter/)
  })
  it('no ancestor of the bar can become the containing block of a fixed element or the scroller', () => {
    for (const sel of ['html', 'body', '#root', '#app']) {
      const r = rule(sel) || ''
      expect(r, sel).not.toMatch(/(?:^|;)\s*(?:-webkit-)?(?:transform|filter|perspective|contain|will-change|backdrop-filter)\s*:/)
    }
    const html = rule('html'), body = rule('body')
    expect(html).not.toMatch(/overflow/)                                                      // root overflow propagates to the viewport (the iOS fixed-chrome drift)
    expect(body).not.toMatch(/overflow/)
    expect(rule('#root')).toMatch(/overflow-x:clip/)                                          // horizontal overflow is clipped one level down
    expect(rule('#app')).not.toMatch(/overflow|height/)                                       // #app flows in the document; the window is the single scroller
  })
  it('uses the dynamic viewport where it exists and keeps the 100vh fallback', () => {
    expect(rule('body')).toMatch(/min-height:100vh/)
    expect(css).toMatch(/@supports \(min-height:100dvh\)\{body\{min-height:100dvh\}\}/)
  })
  it('the viewport covers the notch area and the content leaves room for the bar plus the safe area', () => {
    expect(read('../../index.html')).toMatch(/<meta name="viewport" content="[^"]*viewport-fit=cover/)
    expect(rule('#app')).toMatch(/padding:calc\(var\(--sat\) \+ 8px\) var\(--pad\) calc\(128px \+ var\(--sab\)\)/)
  })
  it('text fields stay at 16px or more (no focus zoom shifting the visual viewport)', () => {
    expect(rule('.field,.input')).toMatch(/font-size:max\(16px/)
  })
})
