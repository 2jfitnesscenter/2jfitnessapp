import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
vi.mock('../components/InstallPrompt.jsx', () => ({ default: () => React.createElement('section', { id: 'pwa-install-prompt' }, 'Install 2J Fitness') }))
vi.mock('../store/useStore.js', () => {
  const useStore = () => ({ setUser: vi.fn(), pullState: vi.fn(), setGuest: vi.fn() })
  useStore.getState = () => ({ S: {} })
  return { useStore, hasData: () => false }
})
vi.mock('../store/useUI.js', () => {
  const useUI = () => ({ timer: null, work: null })
  useUI.getState = () => ({ openSheet: vi.fn(), toast: vi.fn() })
  return { useUI }
})
vi.mock('../lib/api.js', () => ({
  BIO: 'Passkey', webauthnOK: () => true, passkeyLogin: vi.fn(), passkeyRegister: vi.fn(), passkeyRecover: vi.fn(),
  api: vi.fn(), sharedDeviceStatus: vi.fn(), sharedStaffLogin: vi.fn(),
}))
vi.mock('../lib/demo.js', () => ({ DEMO: false }))
import {
  dismissPwaInstall, getPwaInstallGuide, getPwaInstallMode, getPwaInstallSnapshot, initPwaInstallEvents,
  isIOSDevice, isStandalone, PWA_INSTALL_COOLDOWN_MS, PWA_INSTALL_DISMISSAL_KEY,
  promptPwaInstall, readInstallDismissedUntil, resetPwaInstallStateForTests,
} from './pwa-install.js'
import PwaInstallBanner from '../components/PwaInstallBanner.jsx'
import PwaInstallPromptHost from '../components/PwaInstallPromptHost.jsx'
import Login from '../views/Login.jsx'

class EventTargetFake {
  events = new Map()
  addEventListener(type, listener) { this.events.set(type, listener) }
  removeEventListener(type, listener) { if (this.events.get(type) === listener) this.events.delete(type) }
  emit(type, event = {}) { this.events.get(type)?.(event) }
}

let detach
afterEach(() => { detach?.(); detach = null; resetPwaInstallStateForTests(); vi.restoreAllMocks() })

describe('PWA install prompt', () => {
  it('does not show when installed through display-mode or the iOS standalone signal', () => {
    expect(isStandalone({ matchMedia: () => ({ matches: true }) }, {})).toBe(true)
    expect(isStandalone({ matchMedia: () => ({ matches: false }) }, { standalone: true })).toBe(true)
    expect(getPwaInstallMode({ standalone: true, ios: true })).toBe(null)
    expect(getPwaInstallMode({ installed: true, promptAvailable: true })).toBe(null)
  })

  it('shows manual installation guidance when Chrome does not provide its native prompt', () => {
    expect(getPwaInstallMode({ ios: false, promptAvailable: false })).toBe('guide')
    expect(getPwaInstallGuide({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36' })).toBe('desktop-chrome')
    const html = renderToStaticMarkup(<PwaInstallBanner mode="guide" guide="desktop-chrome" instructionsOpen />)
    expect(html).toContain('Install 2J Fitness')
    expect(html).toContain('How to install')
    expect(html).toContain('Install page as app')
    expect(html).toContain('Not now')
  })

  it('keeps the invitation beside first-entry sign-in and renders one global host on Home', () => {
    const login = renderToStaticMarkup(<MemoryRouter initialEntries={['/']}><><PwaInstallPromptHost /><Login /></></MemoryRouter>)
    expect(login).toContain('Install 2J Fitness')
    expect(login).toContain('Sign in with passkey')
    const home = renderToStaticMarkup(<MemoryRouter initialEntries={['/home']}><><PwaInstallPromptHost /><main>Home</main></></MemoryRouter>)
    expect((home.match(/id="pwa-install-prompt"/g) || [])).toHaveLength(1)
  })

  it('does not show a personal install invitation on the shared Bunker kiosk', () => {
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/bunker']}><PwaInstallPromptHost /></MemoryRouter>)
    expect(html).not.toContain('pwa-install-prompt')
  })

  it('captures beforeinstallprompt and makes the native Install action available', () => {
    const target = new EventTargetFake(); detach = initPwaInstallEvents(target)
    const preventDefault = vi.fn()
    const event = { preventDefault, prompt: vi.fn(), userChoice: Promise.resolve({ outcome: 'accepted' }) }
    target.emit('beforeinstallprompt', event)
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(getPwaInstallSnapshot().promptAvailable).toBe(true)
    expect(getPwaInstallMode({ promptAvailable: getPwaInstallSnapshot().promptAvailable })).toBe('prompt')
    const html = renderToStaticMarkup(<PwaInstallBanner mode="prompt" />)
    expect(html).toContain('Install 2J Fitness')
    expect(html).toContain('Install')
    expect(html).toContain('Not now')
  })

  it('calls the captured prompt once and hides after accepted choice', async () => {
    const target = new EventTargetFake(); detach = initPwaInstallEvents(target)
    const event = { preventDefault() {}, prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'accepted' }) }
    target.emit('beforeinstallprompt', event)
    expect(await promptPwaInstall()).toBe('accepted')
    expect(event.prompt).toHaveBeenCalledOnce()
    expect(getPwaInstallSnapshot().installed).toBe(true)
    expect(getPwaInstallMode({ installed: getPwaInstallSnapshot().installed })).toBe(null)
    expect(await promptPwaInstall()).toBe('unavailable')
  })

  it('clears a consumed browser prompt when the user dismisses it', async () => {
    const target = new EventTargetFake(); detach = initPwaInstallEvents(target)
    const event = { preventDefault() {}, prompt: vi.fn().mockResolvedValue(undefined), userChoice: Promise.resolve({ outcome: 'dismissed' }) }
    target.emit('beforeinstallprompt', event)
    expect(await promptPwaInstall()).toBe('dismissed')
    expect(getPwaInstallSnapshot().promptAvailable).toBe(false)
    expect(getPwaInstallMode({ promptAvailable: false, ios: false })).toBe('guide')
  })

  it('selects conservative help for iOS, Android Chrome, Edge and generic browsers', () => {
    expect(getPwaInstallGuide({ ios: true, userAgent: 'Mozilla/5.0 (iPhone; Safari)' })).toBe('ios-safari')
    expect(getPwaInstallGuide({ userAgent: 'Mozilla/5.0 (Linux; Android 15) Chrome/140.0 Mobile Safari/537.36' })).toBe('android-chrome')
    expect(getPwaInstallGuide({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Edg/140.0' })).toBe('desktop-edge')
    expect(getPwaInstallGuide({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/140.0' })).toBe('generic')
  })

  it('stores the seven-day Now not cooldown and becomes eligible when it expires', () => {
    const values = new Map()
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
    const now = 1_800_000_000_000
    const until = dismissPwaInstall(storage, now)
    expect(PWA_INSTALL_DISMISSAL_KEY).toBe('2j_pwa_install_dismissed_until')
    expect(until).toBe(now + 7 * 24 * 60 * 60 * 1000)
    expect(Number(values.get(PWA_INSTALL_DISMISSAL_KEY))).toBe(until)
    expect(PWA_INSTALL_COOLDOWN_MS).toBe(7 * 24 * 60 * 60 * 1000)
    expect(readInstallDismissedUntil(storage)).toBe(until)
    expect(getPwaInstallMode({ promptAvailable: true, cooldown: until > now })).toBe(null)
    expect(getPwaInstallMode({ promptAvailable: true, cooldown: until > until })).toBe('prompt')
  })

  it('shows the iOS guide only outside standalone and explains Safari steps', () => {
    expect(isIOSDevice({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })).toBe(true)
    expect(isIOSDevice({ platform: 'MacIntel', maxTouchPoints: 5, userAgent: 'Mozilla/5.0 (Macintosh)' })).toBe(true)
    expect(getPwaInstallMode({ ios: true })).toBe('guide')
    expect(getPwaInstallMode({ ios: true, standalone: true })).toBe(null)
    const closed = renderToStaticMarkup(<PwaInstallBanner mode="guide" guide="ios-safari" />)
    expect(closed).toContain('How to install')
    expect(closed).not.toContain('Tap Safari')
    expect(closed).not.toContain('Add to Home Screen')
    const open = renderToStaticMarkup(<PwaInstallBanner mode="guide" guide="ios-safari" instructionsOpen />)
    expect(open).toContain('Tap Safari')
    expect(open).toContain('Add to Home Screen')
    expect(open).toContain('Confirm Add')
  })

  it('appinstalled immediately clears the prompt and marks the app installed', () => {
    const target = new EventTargetFake(); detach = initPwaInstallEvents(target)
    target.emit('beforeinstallprompt', { preventDefault() {}, prompt() {}, userChoice: Promise.resolve({ outcome: 'accepted' }) })
    target.emit('appinstalled')
    expect(getPwaInstallSnapshot()).toMatchObject({ promptAvailable: false, installed: true })
    expect(getPwaInstallMode(getPwaInstallSnapshot())).toBe(null)
  })
})
