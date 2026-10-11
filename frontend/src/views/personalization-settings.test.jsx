import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Settings carries one compact Personalisation row; the controls live on their own screen (same controls, same S.ux functions: lib/ux-layout.js is tested separately). */
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))), IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
const memory = new Map()
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
}
afterEach(() => { vi.unstubAllGlobals(); memory.clear() })

describe('Settings → Personalisation', () => {
  it('its own screen holds Home, Progress and the guide controls, with a back button', async () => {
    await boot()
    const { default: View } = await import('./PersonalizationSettings.jsx')
    const html = renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>)
    expect(html).toContain('aria-label="Back"'); expect(html).toContain('Personalisation')
    expect(html).toContain('aria-label="Home"'); expect(html).toContain('aria-label="Progress"')
    expect(html).toContain('Show the personalisation guide again')
  })
  it('Settings itself no longer embeds the big block: only a compact row that opens the screen', async () => {
    const fs = await import('node:fs')
    const src = fs.readFileSync(new URL('./Settings.jsx', import.meta.url), 'utf8')
    expect(src).not.toContain('<PersonalizationSection')
    expect(src).toContain("nav('/settings/personalisation')"); expect(src).toContain('Order and choose what to see in Home and Progress')
    const app = fs.readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).toContain('path="/settings/personalisation"')
  })
})
