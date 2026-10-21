import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

/* The trainer panel must say WHY "Generate with AI" cannot run for a member who has not allowed staff AI tools (the server answers 403 / code consent): a visible
 * notice on the page and a disabled button, not only a toast that disappears. */
const status = { job: null, pending: null, errorClass: null, consent: true, refresh: vi.fn() }
vi.mock('../../lib/trainer-ai-api.js', async () => {
  const real = await vi.importActual('../../lib/trainer-ai-api.js')
  return { ...real, useTrainerAIStatus: () => status, requestMemberPlan: vi.fn(), discardMemberPlan: vi.fn() }
})
vi.mock('../../lib/trainer-api.js', () => ({ fetchMemberPlan: vi.fn(async () => ({ routines: [] })), saveMemberRoutine: vi.fn(), saveMemberProgram: vi.fn() }))

let Page, i18n
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  i18n = await import('../../lib/i18n.js')
  Page = (await import('./TrainerAIGenerate.jsx')).default
})
const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/trainer/m1/ai']}><Routes><Route path="/trainer/:memberId/ai" element={<Page />} /></Routes></MemoryRouter>)

describe('trainer AI: member without staff-AI consent', () => {
  it('shows a persistent alert that says how to fix it, and the Generate button is disabled', () => {
    status.consent = false
    const html = render()
    expect(html).toContain('role="alert"')
    expect(html).toContain('This member has not allowed staff AI tools. They can turn it on in their own app')
    expect(html).toMatch(/<button[^>]*disabled[^>]*>[^<]*(<[^>]+>)*[^<]*Generate routines/)
  })

  it('with consent there is no alert', () => {
    status.consent = true
    expect(render()).not.toContain('role="alert"')
  })

  it('the Spanish catalogue has the notice and the how-to', () => {
    return import('../../locales/es.js').then(m => {
      const es = m.default || m.es || m
      expect(es['This member has not allowed staff AI tools. They can turn it on in their own app: Settings → Data → Staff AI tools.']).toMatch(/Herramientas de IA del personal/)
    })
  })

  it('a finished job that failed shows its reason on the page', () => {
    status.consent = true; status.errorClass = 'unusable'
    const html = render()
    expect(html).toContain('role="alert"'); expect(html).toContain('The AI answered with something the app couldn’t use.')
    status.errorClass = null
  })
})
