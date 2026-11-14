import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { LEVEL_PATH, STEPUP_DELETE_HINT, STEPUP_DELETE_READY, STEPUP_EXPORT_READY, loadStepUp } from './platform-notices.js'
import DeleteAccountSheet from '../components/DeleteAccountSheet.jsx'
import es from '../locales/es.js'

vi.mock('../store/useStore.js', () => ({ useStore: sel => sel({ user: { username: 'ana' }, deleteAccount: vi.fn() }) }))
vi.mock('../store/useUI.js', () => ({ useUI: sel => sel({ toast: vi.fn() }) }))

const fetchOf = (config, level) => vi.fn(async url => ({ ok: true, json: async () => (url === LEVEL_PATH ? level : config) }))

describe('F9d-2 · passkey confirmed in 2J Home for this session (export / erasure)', () => {
  it('only a live grant for export or delete, with the bridge on, is shown', async () => {
    const future = new Date(Date.now() + 60_000).toISOString()
    expect(await loadStepUp(fetchOf({ platformBridge: true }, { stepUp: { purpose: 'export', expiresAt: future } }))).toEqual({ purpose: 'export', expiresAt: future })
    expect(await loadStepUp(fetchOf({ platformBridge: true }, { stepUp: { purpose: 'passkeys', expiresAt: future } }))).toBeNull()
    expect(await loadStepUp(fetchOf({ platformBridge: true }, { stepUp: { purpose: 'delete', expiresAt: new Date(Date.now() - 1).toISOString() } }))).toBeNull()
    expect(await loadStepUp(fetchOf({ platformBridge: true }, { stepUp: null }))).toBeNull()
    expect(await loadStepUp(fetchOf({}, { stepUp: { purpose: 'export', expiresAt: future } }))).toBeNull()
    expect(await loadStepUp(vi.fn(async () => { throw new Error('offline') }))).toBeNull()
  })

  it('the erasure sheet does not promise a Búnker passkey when 2J already confirmed it; texts are in Spanish', () => {
    const html = renderToStaticMarkup(<MemoryRouter><DeleteAccountSheet close={() => {}} platformStepUp /></MemoryRouter>)
    expect(html).toContain(STEPUP_DELETE_HINT)
    expect(html).not.toContain('Then you will confirm with your passkey.')
    for (const key of [STEPUP_EXPORT_READY, STEPUP_DELETE_READY, STEPUP_DELETE_HINT]) expect(es[key]).toBeTruthy()
  })
})
