import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Sprint 2.1 — Settings: liquid glass is always on and no longer a setting, the accent colour is one compact row + sheet,
 * Advanced sits behind a single entry, and groups with nothing to show are not drawn. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
}
async function seed(over = {}, { user = true, admin = null } = {}) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true }, over)))
  if (user) memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia' }))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
}
const render = async () => { await boot(); const Settings = (await import('./Settings.jsx')).default; return renderToStaticMarkup(<MemoryRouter><Settings /></MemoryRouter>) }
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Liquid glass is always on', () => {
  it('no switch or dials in Settings, even when an old profile has it off', async () => {
    await seed({ glass: false, glassOpacity: 0, glassBlur: 0 })
    const html = await render()
    for (const gone of ['Liquid glass', 'Opacity', 'Thickness']) expect(html).not.toContain(gone)
  })
  it('the runtime ignores the stored values and always applies the same liquid look', async () => {
    const { LIQUID_GLASS } = await import('../lib/format.js')
    expect(LIQUID_GLASS).toEqual({ on: true, opacity: 35, blur: 45 })
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).not.toMatch(/S\.glass/); expect(app).toMatch(/LIQUID_GLASS\.on/)
  })
})

describe('Accent colour: one row, palette in a sheet', () => {
  it('Settings shows the current colour only; the palette is not listed', async () => {
    await seed({ accent: 'sky' })
    const html = await render()
    expect(html).toContain('Accent color'); expect(html).toContain('v3-accent-dot-cur'); expect(html).not.toContain('class="swatches"')
    expect(html).toContain('--dot:#0a84ff')
  })
  it('the sheet lists every colour as a 44px radio, marks the selected one and closes on pick', async () => {
    await seed({ accent: 'sky' })
    const { AccentSheet } = await import('../components/AccentSheet.jsx')
    const { ACCENTS } = await import('../lib/format.js')
    const html = renderToStaticMarkup(<AccentSheet close={() => {}} />)
    expect((html.match(/role="radio"/g) || []).length).toBe(Object.keys(ACCENTS).length)
    expect(html).toMatch(/aria-checked="true"[^>]*aria-label="sky"/)
    const src = readFileSync(new URL('../components/AccentSheet.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/s\.accent = k[\s\S]*close/)
    expect(readFileSync(new URL('../v3-progress.css', import.meta.url), 'utf8')).toMatch(/\.v3-accent-dot \{ width: 44px; height: 44px/)
  })
})

describe('Advanced is one entry; empty groups disappear', () => {
  it('data tools and resets stay behind Advanced until it is opened', async () => {
    await seed()
    const html = await render()
    expect(html).toContain('Technical settings and additional options')
    for (const hidden of ['Reset everything', 'Export backup (JSON)', 'Import from another app', 'Load starter plan']) expect(html).not.toContain(hidden)
  })
  it('a guest without features gets no Notifications / Social / Account groups', async () => {
    await seed({}, { user: false })
    const html = await render()
    for (const gone of ['>Notifications<', 'Social &amp; privacy', '>Account<']) expect(html).not.toContain(gone)
    expect(html).toContain('Appearance')
  })
  it('admin switching Health off removes the whole group; signed in keeps Account', async () => {
    await seed({}, { admin: { health: false, social: false } })
    const html = await render()
    expect(html).not.toContain('Health &amp; activity'); expect(html).not.toContain('Social preferences'); expect(html).toContain('Account')
  })
})

describe('Account data: export and erasure entry points', () => {
  it('a member can export and delete; staff can export but erasure is not offered', async () => {
    await seed()
    let html = await render()
    expect(html).toContain('Export my data'); expect(html).toContain('Delete my account')
    memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Coach', trainer: true }))
    html = await render()
    expect(html).toContain('Export my data'); expect(html).not.toContain('Delete my account')
  })
  it('the erasure sheet names what is deleted and needs the typed username before it can run', async () => {
    const src = readFileSync(new URL('../components/DeleteAccountSheet.jsx', import.meta.url), 'utf8')
    expect(src).toMatch(/const ok = !!name && typed\.trim\(\)\.toLowerCase\(\) === name\.toLowerCase\(\)/)
    expect(src).toMatch(/disabled=\{!ok \|\| busy\}/)
    expect(readFileSync(new URL('../lib/api.js', import.meta.url), 'utf8')).toMatch(/\/api\/me\/delete\/options[\s\S]*navigator\.credentials\.get[\s\S]*\/api\/me\/delete/)
  })
})
