# iOS bottom navigation — what was verified and what still needs a device

Hotfix on production `75abb50`. The bar is `#tabbar` (`components/TabBar.jsx`, styles in `index.css` and `v2-screens.css`).

## Measured (Chromium, iPhone-sized viewports, synthetic account)
* The scroller is the window (`document.scrollingElement` = `html`). `#tabbar` is `position:fixed; left/right/bottom:0`, a sibling of the animated `#app`.
* No ancestor of the bar (`#root`, `body`, `html`) has `transform`, `filter`, `perspective`, `contain`, `will-change` or `backdrop-filter`.
* Only suspect left in the ancestor chain: `overflow-x:clip` on **both** `html` and `body`. Root overflow is propagated to the viewport, and a clipped/hidden viewport is the known way iOS Safari lets fixed chrome drift with the document.

## Fix
* No `overflow` on `html`/`body`; horizontal overflow is clipped on `#root` instead (no horizontal scroll at 390 px on 7 routes).
* `body{min-height:100dvh}` where supported (100vh fallback).
* The bar gets its own compositing layer (`translateZ(0)`), because a fixed bar with `backdrop-filter` is repainted late while iOS scrolls. The wide-screen pill keeps its own `translateX(-50%)`.
* Safe area is added once (`padding-bottom: 6px + env(safe-area-inset-bottom)`); `viewport-fit=cover` was already present; `#app` keeps `128px + safe-area` of bottom padding.

## Not provable without WebKit — check on a real iPhone (Safari and installed PWA)
1. Scroll a long page (Stats, Settings) up and down, to the very top and bottom: the bar must not move.
2. Pull down at the top / push past the bottom (rubber band): the bar stays.
3. Safari toolbar collapsing and expanding: no jump, no gap under the bar.
4. Rotate portrait ↔ landscape.
5. Focus a text field (keyboard opens/closes): no jump; the bar stays behind the keyboard.
6. 390×844, 393×852 and 430×932.
If it still moves, the next step is moving the scroll into an app-shell container (the bar outside it); that is a larger layout change and was not done here.
