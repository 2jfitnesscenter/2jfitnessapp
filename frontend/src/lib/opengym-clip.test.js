// openGym animations: each imported exercise with a still also gets its clip at img/opengym-clip/<id>.mp4.
// Custom exercises never get one. The service worker must not cache clips (browsers range-request video).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { clipSrc } from './exercises.js'

describe('clipSrc', () => {
  it('points an imported exercise at its clip, next to its still', () => {
    expect(clipSrc({ id: '10742', img: 'opengym/10742.webp', ext: 1 })).toBe('img/opengym-clip/10742.mp4')
  })
  it('gives nothing to custom exercises or ones without an openGym still', () => {
    expect(clipSrc({ id: 'c1', img: null, ext: undefined })).toBeNull()
    expect(clipSrc({ id: 'c2', img: 'custom/c2.webp' })).toBeNull()
    expect(clipSrc(null)).toBeNull()
  })
})

describe('service worker keeps clips out of the cache', () => {
  it('lets .mp4 requests reach the network untouched', () => {
    const sw = readFileSync(fileURLToPath(new URL('../../public/sw.js', import.meta.url)), 'utf8')
    expect(sw).toContain("if (url.pathname.endsWith('.mp4')) return")
    expect(sw.indexOf("endsWith('.mp4')")).toBeLessThan(sw.indexOf("startsWith('/img/')"))
  })
})
