import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  dismissPwaInstall, getPwaInstallMode, getPwaInstallSnapshot, initPwaInstallEvents,
  isIOSDevice, isStandalone, PWA_INSTALL_COOLDOWN_MS, PWA_INSTALL_DISMISSAL_KEY,
  promptPwaInstall, readInstallDismissedUntil, resetPwaInstallStateForTests,
} from './pwa-install.js'
import PwaInstallBanner from '../components/PwaInstallBanner.jsx'

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
    expect(getPwaInstallMode({ promptAvailable: false, ios: false })).toBe(null)
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
    const closed = renderToStaticMarkup(<PwaInstallBanner mode="guide" />)
    expect(closed).toContain('How to install')
    expect(closed).not.toContain('Tap Safari')
    expect(closed).not.toContain('Add to Home Screen')
    const open = renderToStaticMarkup(<PwaInstallBanner mode="guide" instructionsOpen />)
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
