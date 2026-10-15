import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../store/useStore.js', () => ({ useStore: () => ({ S: {}, update: () => {} }) }))
vi.mock('../store/useUI.js', () => ({ useUI: { openSheet: () => {} } }))

import { StretchCard, StretchDetail } from './Stretch.jsx'
import { STRETCHES } from '../lib/stretches.js'

describe('stretch illustrations', () => {
  const stretch = STRETCHES[0]

  it('renders the illustration in the exercise card', () => {
    const html = renderToStaticMarkup(<StretchCard s={stretch} onClick={() => {}} />)
    expect(html).toContain(`<img src="${stretch.img}"`)
    expect(html).toContain(stretch.n)
  })

  it('renders the illustration alongside exercise instructions', () => {
    const html = renderToStaticMarkup(<StretchDetail s={stretch} />)
    expect(html).toContain(`<img src="${stretch.img}"`)
    expect(html).toContain(stretch.steps[0])
  })

  it('keeps a visible placeholder when a stretch illustration fails to load', async () => {
    const { renderToStaticMarkup } = await import('react-dom/server')
    const html = renderToStaticMarkup(<StretchCard s={{ ...stretch, img: '' }} onClick={() => {}} />)
    expect(html).toContain('No image available')
    expect(html).toContain(stretch.n)
  })
})
