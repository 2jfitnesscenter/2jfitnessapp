import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Trainer / admin "Generate with AI": no member-side consent switch is involved any more — no notice, no blocked button — and a real failure stays visible on the page. */
const status = { job: null, pending: null, errorClass: null, refresh: vi.fn() }
vi.mock('../../lib/trainer-ai-api.js', async () => {
  const real = await vi.importActual('../../lib/trainer-ai-api.js')
  return { ...real, useTrainerAIStatus: () => status, requestMemberPlan: vi.fn(), discardMemberPlan: vi.fn() }
})
vi.mock('../../lib/trainer-api.js', () => ({ fetchMemberPlan: vi.fn(async () => ({ routines: [] })), saveMemberRoutine: vi.fn(), saveMemberProgram: vi.fn() }))

let Page
beforeEach(async () => {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  await import('../../lib/i18n.js')
  Page = (await import('./TrainerAIGenerate.jsx')).default
  Object.assign(status, { job: null, pending: null, errorClass: null })
  delete status.consent
})
const render = () => renderToStaticMarkup(<MemoryRouter initialEntries={['/trainer/m1/ai']}><Routes><Route path="/trainer/:memberId/ai" element={<Page />} /></Routes></MemoryRouter>)

describe('trainer AI panel', () => {
  it('shows no consent notice, even if a stale answer still carries consent:false, and offers the Generate button', () => {
    status.consent = false
    const html = render()
    expect(html).not.toContain('role="alert"')
    expect(html).not.toMatch(/not allowed staff AI|Staff AI tools|Herramientas de IA del personal/)
    expect(html).toContain('Generate routines')
  })

  it('a finished job that failed shows its reason on the page', () => {
    status.errorClass = 'unusable'
    const html = render()
    expect(html).toContain('role="alert"'); expect(html).toContain('The AI answered with something the app couldn’t use.')
  })

  it('the source has no member-consent logic left (screen, API wrapper, Settings, store)', () => {
    const src = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8')
    expect(src('views/trainer/TrainerAIGenerate.jsx')).not.toMatch(/consent/i)
    expect(src('lib/trainer-ai-api.js')).not.toMatch(/consent/i)
    expect(src('views/Settings.jsx')).not.toContain('StaffAiConsentSheet')
    expect(src('store/useStore.js')).not.toContain('staffAi')
  })
})
