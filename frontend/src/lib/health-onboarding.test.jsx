import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

/* Health Native Onboarding V1: shown once per account+device in the Android app, never prompts by itself, never re-appears (not even after a revoke),
   skips people who already granted access, and keeps its flag out of the synced state. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

let memory, mod, bridgeMod
const UID = 'u1'
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  mod = await import('./health-onboarding.js')
  bridgeMod = await import('./health-bridge.js')
}
const fake = (over = {}) => ({
  platform: 'android',
  isAvailable: vi.fn(async () => ({ available: true })),
  checkPermissions: vi.fn(async () => ({ granted: [] })),
  requestPermissions: vi.fn(async () => ({ granted: ['workouts', 'activeCalories', 'heartRate', 'steps'] })),
  readWorkouts: vi.fn(), ...over,
})
beforeEach(async () => { memory = new Map(); await boot() })
afterEach(() => { vi.unstubAllGlobals() })

describe('who gets the invitation', () => {
  it('only the Android app: not the web/PWA, not iOS, not without an account', async () => {
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: null })).toMatchObject({ show: false, reason: 'not_native_android' })
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: fake({ platform: 'ios' }) })).toMatchObject({ show: false })
    expect(await mod.evaluateOnboarding({ uid: null, bridge: fake() })).toMatchObject({ show: false, reason: 'no_user' })
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: fake() })).toEqual({ show: true, state: 'ready' })
  })
  it('already granted access is detected WITHOUT prompting, and counts as done', async () => {
    const b = fake({ checkPermissions: vi.fn(async () => ({ granted: ['workouts', 'steps'] })) })
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: b })).toMatchObject({ show: false, reason: 'already_granted' })
    expect(b.requestPermissions).not.toHaveBeenCalled()
    expect(mod.onboardingSeen(UID)).toBe(true)
  })
  it('a shell that cannot check, or a failing check, still shows the (harmless) invitation', async () => {
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: fake({ checkPermissions: undefined }) })).toMatchObject({ show: true, state: 'ready' })
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: fake({ checkPermissions: vi.fn(async () => { throw new Error('x') }) }) })).toMatchObject({ show: true })
  })
  it('Health Connect missing/outdated → an install route (never a dead button); a device that cannot run it → nothing, marked done', async () => {
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: fake({ isAvailable: async () => ({ available: false, reason: 'not_installed' }) }) })).toEqual({ show: true, state: 'needs_install' })
    expect(mod.onboardingSeen(UID)).toBe(false)
    expect(await mod.evaluateOnboarding({ uid: 'u2', bridge: fake({ isAvailable: async () => ({ available: false, reason: 'unsupported' }) }) })).toMatchObject({ show: false, reason: 'unsupported' })
    expect(mod.onboardingSeen('u2')).toBe(true)
  })
  it('a bridge hiccup is not held against the person: nothing shown, nothing marked, asked again next launch', async () => {
    const b = fake({ isAvailable: vi.fn(async () => { throw new Error('boom') }) })
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: b })).toMatchObject({ show: false, reason: 'bridge_error' })
    expect(mod.onboardingSeen(UID)).toBe(false)
  })
})

describe('every way out marks it as seen, and it never comes back', () => {
  it('"Activar": granted → connected; the permission sheet is requested once', async () => {
    const b = fake()
    const r = await mod.acceptOnboarding({ uid: UID, bridge: b })
    expect(r.status).toBe('connected'); expect(b.requestPermissions).toHaveBeenCalledTimes(1)
    expect(bridgeMod.bridgeState(UID).enabled).toBe(true)
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: fake() })).toMatchObject({ show: false, reason: 'seen' })
  })
  it('partial grants, a refusal and a cancelled sheet all finish the onboarding without connecting', async () => {
    for (const [uid, b] of [
      ['partial', fake({ requestPermissions: async () => ({ granted: ['steps'] }) })],
      ['refused', fake({ requestPermissions: async () => ({ granted: [] }) })],
      ['cancelled', fake({ requestPermissions: async () => { throw new Error('cancelled') } })],
      ['broken', fake({ isAvailable: async () => { throw new Error('x') } })],
    ]) {
      const r = await mod.acceptOnboarding({ uid, bridge: b })
      expect(['denied', 'unavailable']).toContain(r.status)
      expect(bridgeMod.bridgeState(uid).enabled).toBe(false)
      expect(mod.onboardingSeen(uid)).toBe(true)
    }
  })
  it('"Ahora no" marks it and a later evaluation (a restart) stays quiet', async () => {
    mod.declineOnboarding(UID)
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: fake() })).toMatchObject({ show: false, reason: 'seen' })
  })
  it('permissions revoked later: no second onboarding (Settings shows the reconnect state instead)', async () => {
    await mod.acceptOnboarding({ uid: UID, bridge: fake() })
    const revoked = fake({ checkPermissions: async () => ({ granted: [] }) })
    expect(await mod.evaluateOnboarding({ uid: UID, bridge: revoked })).toMatchObject({ show: false, reason: 'seen' })
    expect(revoked.isAvailable).not.toHaveBeenCalled()
  })
  it('the install route opens the store once and counts as done', () => {
    const open = vi.fn()
    mod.openInstall({ uid: UID, open })
    expect(open).toHaveBeenCalledWith(mod.HEALTH_CONNECT_STORE_URL); expect(mod.onboardingSeen(UID)).toBe(true)
  })
  it('it is per account on this device, and resettable explicitly', () => {
    mod.markOnboardingSeen(UID, 'x'); expect(mod.onboardingSeen('someone-else')).toBe(false)
    mod.resetOnboarding(UID); expect(mod.onboardingSeen(UID)).toBe(false)
  })
})

describe('scope and privacy', () => {
  it('lists only what the app really reads and adds no permission of its own', () => {
    expect(mod.ONBOARDING_CATEGORIES).toEqual(bridgeMod.PERMISSIONS)
    const src = readFileSync(new URL('./health-onboarding.js', import.meta.url), 'utf8')
    expect(src).not.toMatch(/requestWritePermissions|writeWorkout|READ_WEIGHT|bodyFat/)
    expect(src).not.toMatch(/useStore|sync-client|useSync/)       // the flag is local, never part of the synced state
  })
  it('the flag is a device-local key, not a field of the synced state', async () => {
    mod.markOnboardingSeen(UID, 'declined')
    expect([...memory.keys()]).toEqual(['health_onboarding_v1:' + UID])
    const { DEF } = await import('../store/useStore.js')
    expect(JSON.stringify(DEF)).not.toMatch(/healthOnboarding|health_onboarding/)
  })
  it('the sheet shows the premium copy, the real categories and both choices; the install variant has its own CTA', async () => {
    const { HealthOnboardingSheet } = await import('../components/HealthOnboarding.jsx')
    const ready = renderToStaticMarkup(<HealthOnboardingSheet uid={UID} state="ready" close={() => {}} />)
    for (const k of ['Connect your health with 2J', 'Activate health data', 'Not now', 'v3-hob-cats', 'Workouts', 'Steps', 'Active energy', 'Heart rate', 'Settings → Health &amp; activity']) expect(ready).toContain(k)
    expect(ready).not.toMatch(/weight|composition|Weight/i)
    const install = renderToStaticMarkup(<HealthOnboardingSheet uid={UID} state="needs_install" close={() => {}} />)
    expect(install).toContain('Open Health Connect'); expect(install).toContain('installed or updated'); expect(install).not.toContain('Activate health data')
  })
  it('the app shell mounts the gate behind the session, the profile wizards and an active workout', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).toMatch(/<HealthOnboardingGate ready=\{ready\} authed=\{!!user\} blocked=\{needsOnboarding \|\| needsUxSetup \|\| !!S\.active\}/)
    const gate = readFileSync(new URL('../components/HealthOnboarding.jsx', import.meta.url), 'utf8')
    expect(gate).toMatch(/\(workout\|bunker\|trainer\)/)
    expect(gate).toMatch(/bridge\.platform !== 'android'/)
  })
})
