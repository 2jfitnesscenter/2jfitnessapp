import { describe, expect, it } from 'vitest'
import { isVisible, newsStatus, parseLine, parseNewsText, safeAccent, toLocalInput, fromLocalInput, visibleNews } from './news.js'

const N = (over = {}) => ({ id: 'n', active: true, order: 1, createdAt: 1, publishAt: null, expiresAt: null, ...over })

describe('news visibility', () => {
  it('needs active, published and not expired', () => {
    const now = 100
    expect(isVisible(N(), now)).toBe(true)
    expect(isVisible(N({ active: false }), now)).toBe(false)
    expect(isVisible(N({ publishAt: 101 }), now)).toBe(false)
    expect(isVisible(N({ publishAt: 100 }), now)).toBe(true)
    expect(isVisible(N({ expiresAt: 100 }), now)).toBe(false)
    expect(isVisible(N({ expiresAt: 101 }), now)).toBe(true)
    expect(isVisible(null, now)).toBe(false)
  })
  it('orders by `order` then creation and tolerates junk', () => {
    const list = [N({ id: 'b', order: 2 }), N({ id: 'c', order: 1, createdAt: 9 }), N({ id: 'a', order: 1, createdAt: 2 })]
    expect(visibleNews(list, 100).map(n => n.id)).toEqual(['a', 'c', 'b'])
    expect(visibleNews('x')).toEqual([])
  })
  it('explains the status for the admin list', () => {
    expect([N({ active: false }), N({ publishAt: 200 }), N({ expiresAt: 50 }), N()].map(n => newsStatus(n, 100))).toEqual(['inactive', 'scheduled', 'expired', 'live'])
  })
})

describe('news text', () => {
  it('parses bold, links and plain text per line', () => {
    expect(parseLine('a **b** [c](https://d.example) e')).toEqual([
      { type: 'text', text: 'a ' }, { type: 'bold', text: 'b' }, { type: 'text', text: ' ' }, { type: 'link', text: 'c', href: 'https://d.example' }, { type: 'text', text: ' e' }])
    expect(parseNewsText('uno\n\ndos')).toHaveLength(3)
    expect(parseNewsText('uno\n\ndos')[1]).toEqual([])
  })
  it('only turns http(s) links into links', () => {
    for (const bad of ['[x](javascript:alert(1))', '[x](data:text/html,hi)', '[x](//evil.example)', '[x](ftp://a)']) {
      expect(parseLine(bad).some(s => s.type === 'link')).toBe(false)
    }
  })
  it('keeps markup as literal text', () => {
    expect(parseLine('<b>x</b>')).toEqual([{ type: 'text', text: '<b>x</b>' }])
  })
  it('validates the accent and converts local date inputs', () => {
    expect(safeAccent('#ABCDEF')).toBe('#abcdef'); expect(safeAccent('blue')).toBe('#7bd34a'); expect(safeAccent(undefined)).toBe('#7bd34a')
    const ms = new Date(2026, 9, 2, 14, 30).getTime()
    expect(toLocalInput(ms)).toBe('2026-10-02T14:30'); expect(fromLocalInput('2026-10-02T14:30')).toBe(ms)
    expect(toLocalInput(null)).toBe(''); expect(fromLocalInput('')).toBe(null)
  })
})
