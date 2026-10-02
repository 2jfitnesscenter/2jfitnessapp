import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))) }))
vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ user: { id: 'u1' } }) }))

const { NewsCarousel, NewsCard } = await import('./NewsBlock.jsx')
const N = (id, over = {}) => ({ id, title: 'Aviso ' + id, body: 'Texto **importante** con [enlace](https://2jfitnesscenter.com)', accentColor: '#ff8800', active: true, order: 1, publishAt: null, expiresAt: null, createdAt: 1, ...over })
const now = 1_000_000

describe('Home news block', () => {
  it('renders nothing when there are no active, current notices', () => {
    expect(renderToStaticMarkup(<NewsCarousel items={[]} now={now} />)).toBe('')
    const hidden = [N('a', { active: false }), N('b', { publishAt: now + 1 }), N('c', { expiresAt: now - 1 })]
    expect(renderToStaticMarkup(<NewsCarousel items={hidden} now={now} />)).toBe('')
    expect(renderToStaticMarkup(<NewsCarousel items={null} now={now} />)).toBe('')
  })

  it('shows one compact card, with no carousel indicator', () => {
    const html = renderToStaticMarkup(<NewsCarousel items={[N('a')]} now={now} />)
    expect(html).toContain('news-block')
    expect(html).not.toContain('news-block multi')
    expect(html).not.toContain('news-dots')
    expect(html).toContain('Aviso a')
  })

  it('shows a snap carousel with an indicator when there are several, in order, honouring the windows', () => {
    const items = [N('b', { order: 2 }), N('a', { order: 1 }), N('x', { active: false, order: 0 }), N('f', { publishAt: now + 5, order: 0 }), N('c', { order: 3 })]
    const html = renderToStaticMarkup(<NewsCarousel items={items} now={now} />)
    expect(html).toContain('news-block multi')
    expect(html).toContain('news-dots')
    expect(html.match(/<article/g)).toHaveLength(3)
    expect(html.indexOf('Aviso a')).toBeLessThan(html.indexOf('Aviso b'))
    expect(html.indexOf('Aviso b')).toBeLessThan(html.indexOf('Aviso c'))
    expect(html).not.toContain('Aviso x')
    expect(html).not.toContain('Aviso f')
    expect(html.match(/role="tab"/g)).toHaveLength(3)
  })

  it('renders bold, line breaks and https links as nodes and never as HTML', () => {
    const html = renderToStaticMarkup(<NewsCard item={N('a', { title: '<img src=x onerror=alert(1)>', body: '<script>alert(1)</script>\n**negrita**\n[ok](https://a.example/p?q=1) [mal](javascript:alert(1))' })} />)
    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<strong>negrita</strong>')
    expect(html).toContain('href="https://a.example/p?q=1"')
    expect(html).toContain('rel="noopener noreferrer"')
    expect(html).not.toContain('href="javascript')
  })

  it('applies a safe accent and falls back for an invalid one', () => {
    expect(renderToStaticMarkup(<NewsCard item={N('a', { accentColor: '#112233' })} />)).toContain('--news-accent:#112233')
    expect(renderToStaticMarkup(<NewsCard item={N('a', { accentColor: 'red;background:url(x)' })} />)).toContain('--news-accent:#7bd34a')
  })

  it('shows the optional image', () => {
    expect(renderToStaticMarkup(<NewsCard item={N('a', { image: 'abc123.jpg' })} />)).toContain('/api/social/media?id=abc123.jpg')
    expect(renderToStaticMarkup(<NewsCard item={N('a')} />)).not.toContain('<img')
  })
})
