import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBase } from '../../vite.base.js'
import { makeApiUrl, apiUrl } from './base-path.js'

describe('resolveBase (vite base)', () => {
  it('defaults to "/" when VITE_BASE is unset (current build unchanged)', () => {
    expect(resolveBase({})).toBe('/')
  })
  it('keeps relative base for mobile/demo builds', () => {
    expect(resolveBase({ VITE_MOBILE: '1' })).toBe('./')
    expect(resolveBase({ VITE_DEMO: '1' })).toBe('./')
  })
  it('uses VITE_BASE and normalises slashes', () => {
    expect(resolveBase({ VITE_BASE: '/bunker/' })).toBe('/bunker/')
    expect(resolveBase({ VITE_BASE: 'bunker' })).toBe('/bunker/')
    expect(resolveBase({ VITE_BASE: '' })).toBe('/')
  })
  it('mobile wins over VITE_BASE', () => {
    expect(resolveBase({ VITE_MOBILE: '1', VITE_BASE: '/bunker/' })).toBe('./')
  })
})

describe('apiUrl', () => {
  it('prefixes the base', () => {
    expect(makeApiUrl('/bunker/')('bunker/board')).toBe('/bunker/api/bunker/board')
  })
  it('accepts paths already starting with /api/ without doubling', () => {
    expect(makeApiUrl('/bunker/')('/api/bunker/board')).toBe('/bunker/api/bunker/board')
    expect(makeApiUrl('/bunker/')('/api/x?a=1')).toBe('/bunker/api/x?a=1')
  })
  it('is identical to today with base "/"', () => {
    expect(makeApiUrl('/')('bunker/board')).toBe('/api/bunker/board')
    expect(makeApiUrl('/')('/api/bunker/board')).toBe('/api/bunker/board')
  })
  it('keeps absolute /api for relative (mobile) base', () => {
    expect(makeApiUrl('./')('/api/x')).toBe('/api/x')
  })
  it('default apiUrl uses the build base ("/" under test)', () => {
    expect(apiUrl('/api/x')).toBe('/api/x')
  })
})

describe('no absolute /api fetch left in src', () => {
  const root = fileURLToPath(new URL('..', import.meta.url))
  const files = []
  const walk = d => { for (const n of readdirSync(d)) { const p = join(d, n); statSync(p).isDirectory() ? walk(p) : /\.(jsx?)$/.test(n) && !/\.test\./.test(n) && files.push(p) } }
  walk(root)
  it('raw fetch/sendBeacon never take a literal /api path', () => {
    const bad = []
    for (const f of files) {
      if (/base-path\.js$/.test(f)) continue
      const src = readFileSync(f, 'utf8')
      if (/(fetch|sendBeacon)\(\s*['"`]\/api/.test(src)) bad.push(relative(root, f))
    }
    expect(bad).toEqual([])
  })
})
