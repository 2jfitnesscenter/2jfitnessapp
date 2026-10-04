import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

/* Sprint 3 — web hardening that must not regress: security headers in the web tier, zoomable viewport, bounded service-worker
 * caches, and a live region for the "rest over" toast. */
const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const nginx = read('../../../web/nginx.conf')
const header = name => (nginx.match(new RegExp('add_header ' + name + ' "([^"]+)"')) || [])[1]

describe('security headers (web/nginx.conf)', () => {
  const csp = header('Content-Security-Policy') || ''
  const dir = name => (csp.split(';').map(s => s.trim()).find(s => s.startsWith(name + ' ')) || '')
  it('CSP is enforced and keeps script execution to the app origin', () => {
    expect(csp).not.toBe('')
    expect(dir('script-src')).toBe("script-src 'self'")
    expect(csp).not.toMatch(/unsafe-eval|script-src[^;]*unsafe-inline|\*/)
    expect(dir('default-src')).toBe("default-src 'self'")
    for (const d of ["object-src 'none'", "base-uri 'self'", "frame-ancestors 'self'", "form-action 'self'"]) expect(csp).toContain(d)
  })
  it('only Google Fonts is allowed off-origin (the headline face), nothing else', () => {
    const hosts = [...csp.matchAll(/https:\/\/[a-z.]+/g)].map(m => m[0])
    expect([...new Set(hosts)].sort()).toEqual(['https://fonts.googleapis.com', 'https://fonts.gstatic.com'])
  })
  it('keeps HSTS, nosniff, referrer policy, framing and a Permissions-Policy that keeps what 2J uses', () => {
    expect(header('Strict-Transport-Security')).toMatch(/max-age=31536000/)
    expect(header('X-Content-Type-Options')).toBe('nosniff')
    expect(header('Referrer-Policy')).toBe('strict-origin-when-cross-origin')
    expect(header('X-Frame-Options')).toBe('SAMEORIGIN')
    const pp = header('Permissions-Policy') || ''
    expect(pp).toContain('geolocation=(self)'); expect(pp).toContain('bluetooth=(self)'); expect(pp).toContain('microphone=()')
  })
})

describe('accessibility and PWA quick wins', () => {
  it('the viewport allows pinch-zoom', () => {
    expect(read('../../index.html')).not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/)
  })
  it('service-worker media and asset caches are bounded and still never touch /api', () => {
    const sw = read('../../public/sw.js')
    expect(sw).toMatch(/LIMITS\s*=\s*\{[^}]*ASSETS[^}]*MEDIA/)
    expect(sw).toMatch(/pathname\.startsWith\('\/api\/'\)\) return/)
  })
  it('toasts (including "Rest over") are announced politely to screen readers', () => {
    const toast = read('../components/Toast.jsx')
    expect(toast).toContain('role="status"'); expect(toast).toContain('aria-live="polite"')
  })
})
