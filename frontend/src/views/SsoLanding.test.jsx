import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { SsoFailure } from './SsoLanding.jsx'

/* The page a person lands on when the browser-bound sign-in could not complete. A link that was not started in this browser (a forwarded
 * or crafted link) must explain itself and offer to START the flow here — never sign anyone in. */
describe('SsoFailure', () => {
  const markup = kind => renderToStaticMarkup(<SsoFailure kind={kind} />)

  it('a link that was not started in this browser offers to start the flow here, plus the passkey', () => {
    const html = markup('binding')
    expect(html).toContain('href="/api/platform/v1/sso/start"')
    expect(html).toContain('href="/"')
    expect(html).toMatch(/not started in this browser|no se inició en este navegador/)
    expect(html).not.toMatch(/code=|ticket|verifier/i)
  })

  it('an expired or used code can start again from here', () => {
    expect(markup('invalid')).toContain('href="/api/platform/v1/sso/start"')
  })

  it('blocked, link-not-confirmed, disabled and unavailable never push the 2J sign-in again', () => {
    for (const kind of ['blocked', 'link', 'disabled', 'unavailable', 'busy', 'something-else']) {
      const html = markup(kind)
      expect(html, kind).not.toContain('/api/platform/v1/sso/start')
      expect(html, kind).toContain('href="/"')
    }
  })
})
