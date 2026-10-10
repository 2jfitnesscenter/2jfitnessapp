import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

/* Official-content history in the admin screens: what a version line says, what the two calls send, and that it is in Spanish. */
const calls = []
vi.mock('../../../lib/api.js', () => ({
  api: vi.fn(async (path, opts = {}) => {
    calls.push({ path, method: opts.method || 'GET', body: opts.body ? JSON.parse(opts.body) : null })
    if (path.startsWith('/api/guided/history')) return { versions: [{ at: '2026-10-01T10:00:00.000Z', by: 'ad', kind: 'routine', name: 'Core', status: 'active', exercises: 7 }] }
    if (path === '/api/guided') return { routines: [], programs: [], collections: [], mine: [], uid: 'ad' }
    return { routine: { id: 'r1' } }
  }),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../../../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
let hist, guided, i18n

beforeEach(async () => {
  calls.length = 0
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: () => null, setItem() {}, removeItem() {} })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  i18n = await import('../../../lib/i18n.js')
  const { useUI } = await import('../../../store/useUI.js')
  ;(await import('../../../components/ui.jsx')).bindUI(useUI)
  hist = await import('./History.jsx')
  guided = (await import('../../../lib/guided-api.js')).useGuided
})
afterEach(() => vi.unstubAllGlobals())

describe('official content history (admin)', () => {
  it('a version line says what it held: exercises for a routine, weeks for a program, workouts for a collection, and the state it was in', async () => {
    await i18n.setLang('en')
    expect(hist.versionLine({ name: 'Core', status: 'active', exercises: 7 })).toBe('Core · 7 exercises · Active')
    expect(hist.versionLine({ name: 'Return plan', status: 'hidden', weeks: 3 })).toBe('Return plan · 3 weeks · Hidden')
    expect(hist.versionLine({ name: 'Summer', status: 'draft', routines: 5 })).toBe('Summer · 5 workouts · Draft')
    await i18n.setLang('es')
    expect(hist.versionLine({ name: 'Core', status: 'active', exercises: 7 })).toMatch(/7 ejercicios/)
  })
  it('asks the server for one item\'s versions, and restores one by its timestamp', async () => {
    const versions = await guided.getState().history('r2j-core-start')
    expect(versions).toHaveLength(1)
    expect(calls[0]).toEqual({ path: '/api/guided/history?id=r2j-core-start', method: 'GET', body: null })
    calls.length = 0
    await guided.getState().restore('r2j-core-start', '2026-10-01T10:00:00.000Z')
    expect(calls[0]).toEqual({ path: '/api/guided/restore', method: 'POST', body: { id: 'r2j-core-start', at: '2026-10-01T10:00:00.000Z' } })
    expect(calls.some(c => c.path === '/api/guided')).toBe(true)         // the catalogue is re-read afterwards
  })
  it('the button renders only for an item that has an id, and every string has a Spanish translation', async () => {
    await i18n.setLang('en')
    expect(renderToStaticMarkup(<hist.HistoryButton id="p1" />)).toContain('Version history')
    expect(renderToStaticMarkup(<hist.HistoryButton id={null} />)).toBe('')
    const es = readFileSync(new URL('../../../locales/es.js', import.meta.url), 'utf8')
    const src = readFileSync(new URL('./History.jsx', import.meta.url), 'utf8')
    const keys = [...src.matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"))
    expect(keys.length).toBeGreaterThan(8)
    expect(keys.filter(k => !es.includes("'" + k.replace(/'/g, "\\'") + "':"))).toEqual([])
  })
})
