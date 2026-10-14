import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../store/useStore.js', () => ({ useStore: () => ({ S: {}, update: () => {} }) }))
vi.mock('../store/useUI.js', () => ({ useUI: { openSheet: () => {} } }))

import { StretchCard, StretchDetail } from './Stretch.jsx'
import { STRETCHES } from '../lib/stretches.js'

describe('unverified stretch illustration fallbacks', () => {
  const stretch = STRETCHES[0]

  it('keeps the exercise card usable without rendering its image', () => {
    const html = renderToStaticMarkup(<StretchCard s={stretch} onClick={() => {}} />)
    expect(html).not.toContain('<img')
    expect(html).toContain(stretch.n)
    expect(html).toContain('<svg')
  })

  it('keeps exercise instructions available with an accessible placeholder', () => {
    const html = renderToStaticMarkup(<StretchDetail s={stretch} />)
    expect(html).not.toContain('<img')
    expect(html).toContain('No image available')
    expect(html).toContain(stretch.steps[0])
  })
})
