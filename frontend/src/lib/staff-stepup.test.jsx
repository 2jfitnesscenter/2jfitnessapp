import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { api } from './api.js'
import { STAFF_STEPUP_ACTIONS, STAFF_STEPUP_EVENT, STAFF_STEPUP_TEXT, STAFF_STEPUP_TITLE, startStaffStepUp } from './staff-stepup.js'
import { StaffStepUpSheet } from '../components/StaffStepUpSheet.jsx'
import es from '../locales/es.js'

// Sin DOM en estas pruebas: basta un `window` que reparta eventos.
beforeEach(() => { vi.stubGlobal('window', new EventTarget()) })
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })
const reply = (status, body) => new Response(JSON.stringify(body), { status })

describe('F9o · acciones fuertes del personal con la passkey de 2J Hub', () => {
  it('lista cerrada igual que la del servidor: sin recovery-link ni me/delete', () => {
    expect(Object.keys(STAFF_STEPUP_ACTIONS).sort()).toEqual([
      'POST /api/admin/invites/new', 'POST /api/admin/invites/revoke', 'POST /api/admin/user/disable',
      'POST /api/admin/user/role', 'POST /api/admin/user/trainer', 'POST /api/logout/all',
    ])
  })

  it('passkey_required con staffStepUp abre el aviso con la acción y el cuerpo; no reintenta con la passkey de Búnker', async () => {
    const fetchMock = vi.fn(async () => reply(403, { error: 'x', code: 'passkey_required', staffStepUp: true }))
    vi.stubGlobal('fetch', fetchMock)
    const seen = []
    const on = e => seen.push(e.detail)
    window.addEventListener(STAFF_STEPUP_EVENT, on)
    await expect(api('/api/admin/user/role', { method: 'POST', body: JSON.stringify({ id: 'u-1', role: 'trainer' }) })).rejects.toThrow()
    window.removeEventListener(STAFF_STEPUP_EVENT, on)
    expect(seen).toEqual([{ action: 'user_role', body: { id: 'u-1', role: 'trainer' } }])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('sin staffStepUp (o recovery-link) no se ofrece 2J Hub', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(403, { error: 'x', code: 'passkey_required', staffStepUp: true })))
    const seen = []
    const on = e => seen.push(e.detail)
    window.addEventListener(STAFF_STEPUP_EVENT, on)
    vi.stubGlobal('fetch', vi.fn(async () => reply(403, { error: 'x', code: 'step_up_required' })))
    await expect(api('/api/admin/invites/new', { method: 'POST', body: '{}' })).rejects.toThrow()
    window.removeEventListener(STAFF_STEPUP_EVENT, on)
    expect(seen).toEqual([])
  })

  it('empezar devuelve la dirección de 2J Hub o el error del servidor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => reply(200, { confirmUrl: 'https://admin.example/#/bunker-confirmar/x' })))
    expect(await startStaffStepUp('logout_all', {})).toBe('https://admin.example/#/bunker-confirmar/x')
    vi.stubGlobal('fetch', vi.fn(async () => reply(503, { error: 'no se puede confirmar ahora: 2J Hub no responde', code: 'platform_unavailable' })))
    await expect(startStaffStepUp('logout_all', {})).rejects.toThrow(/2J Hub no responde/)
  })

  it('el aviso dice qué pasa y está en español', () => {
    const html = renderToStaticMarkup(<StaffStepUpSheet action="user_role" body={{}} close={() => {}} />)
    expect(html).toContain('role="dialog"')
    expect(es[STAFF_STEPUP_TITLE]).toBe('Confirmar con tu passkey de 2J Hub')
    expect(es[STAFF_STEPUP_TEXT]).toContain('sobre quién')
  })
})
