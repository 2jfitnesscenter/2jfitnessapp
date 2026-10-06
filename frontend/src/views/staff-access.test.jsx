import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Staff access: a user with the trainer role must find the management panel (/trainer) from the app; admin keeps the full dashboard; a member sees neither.
   Visibility only — what each call may do is still decided by the server (requireTrainer / requireAdmin), which this change does not touch. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
}
// the session shape the server returns from /api/me: admin implies trainer (isTrainer = trainer === true || isAdmin)
const ROLES = {
  member: { id: 'u1', name: 'Ana Socia' },
  trainer: { id: 'u2', name: 'Tomas Trainer', trainer: true },
  admin: { id: 'u3', name: 'Alba Admin', admin: true, trainer: true },
}
async function renderAs(role, view) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, uxInviteDismissed: true })))
  memory.set('gym_user', JSON.stringify(ROLES[role]))
  await boot()
  const View = (await import(`./${view}.jsx`)).default
  return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>)
}
beforeEach(() => { memory = new Map(); vi.useFakeTimers({ toFake: ['Date'] }) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Settings → Account', () => {
  it('admin: the full dashboard, no duplicate trainer row', async () => {
    const h = await renderAs('admin', 'Settings')
    expect(h).toContain('Admin dashboard'); expect(h).not.toContain('Trainer panel')
  })
  it('trainer: a clear way into the management panel, and no admin dashboard', async () => {
    const h = await renderAs('trainer', 'Settings')
    expect(h).toContain('Trainer panel'); expect(h).toContain('Build and assign routines for your members'); expect(h).not.toContain('Admin dashboard')
  })
  it('member: neither', async () => {
    const h = await renderAs('member', 'Settings')
    expect(h).not.toContain('Trainer panel'); expect(h).not.toContain('Admin dashboard')
  })
})

describe('Profile', () => {
  it('trainer and admin see the panel entry without opening any disclosure; a member does not', async () => {
    expect(await renderAs('trainer', 'Profile')).toContain('Trainer panel')
    expect(await renderAs('admin', 'Profile')).toContain('Trainer panel')
    expect(await renderAs('member', 'Profile')).not.toContain('Trainer panel')
  })
})

describe('Routes stay protected', () => {
  const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
  it('/admin renders the dashboard only for admin; a trainer is sent to the trainer panel, anyone else home', () => {
    expect(app).toContain(`<Route path="/admin" element={user?.admin ? <Admin /> : <Navigate to={user?.trainer ? '/trainer' : '/home'} replace />} />`)
  })
  it('every other admin screen is still admin-only (trainers only keep the Bunker admin they already had)', () => {
    const adminRoutes = app.split(/\r?\n/).filter(l => l.includes('<Route path="/admin')).map(l => [l.match(/path="([^"]*)"/)[1], l.slice(l.indexOf('element={') + 9)])
    expect(adminRoutes.length).toBeGreaterThanOrEqual(8)
    for (const [path, el] of adminRoutes) {
      if (path === '/admin' || path === '/admin/bunker') continue
      expect(el, path).toMatch(/^user\?\.admin \? </)
      expect(el, path).not.toMatch(/trainer/)
    }
    expect(app).toContain(`<Route path="/admin/bunker" element={(user?.admin || user?.trainer) ? <BunkerAdminPage />`)
  })
  it('the /trainer shell requires the trainer flag; the admin-only trainer screens keep their admin check', () => {
    expect(app).toContain(`!user?.trainer ? <Navigate to="/home" replace />`)
    expect(app).toContain(`<Route path="/trainer/guided/program/:id" element={user?.admin ?`)
    expect(app).toContain(`<Route path="/trainer/library-quality" element={user?.admin ?`)
  })
  it('trainer routes stay trainer-guarded and role changes stay admin-guarded', () => {
    const api = readFileSync(new URL('../../../api/server.js', import.meta.url), 'utf8')
    expect(api).toMatch(/'POST \/api\/admin\/user\/trainer': async \(req, res\) => \{\s*const admin = requireAdmin\(req, res\); if \(!admin\) return;/)
    expect(api).toMatch(/'POST \/api\/admin\/user\/role': async \(req, res\) => \{\s*const admin = requireAdmin\(req, res\); if \(!admin\) return;/)
    expect(api).toMatch(/'POST \/api\/trainer\/member-routine': async \(req, res\) => \{\s*if \(!requireTrainer\(req, res\)\) return;/)
    expect(api).toContain('const isTrainer = user => !!user && (user.trainer === true || isAdmin(user));')
  })
})
