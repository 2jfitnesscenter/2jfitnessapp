import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

const push = vi.hoisted(() => ({
  enablePush: vi.fn(), pushPermission: vi.fn(), pushSupported: vi.fn(), scheduleTestRestAlert: vi.fn(),
}))

vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))), IS_APPLE: false, IS_ANDROID: false,
  BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../lib/rest-notification.js', () => ({ isAndroidNative: () => false }))
vi.mock('../lib/push.js', () => push)

let memory
async function renderTraining({ notification = true, serviceWorker = true, pushManager = true, permission = 'default' } = {}) {
  vi.resetModules()
  memory = new Map()
  vi.stubGlobal('localStorage', {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, String(value)),
    removeItem: key => memory.delete(key),
    get length() { return memory.size }, key: index => [...memory.keys()][index] ?? null,
  })
  vi.stubGlobal('navigator', serviceWorker ? { serviceWorker: { ready: Promise.resolve({ pushManager: pushManager ? { getSubscription: vi.fn().mockResolvedValue(null) } : undefined }) } } : {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  const notificationApi = notification ? { permission, requestPermission: vi.fn() } : undefined
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), ...(serviceWorker ? {} : {}), ...(pushManager ? { PushManager: function PushManager() {} } : {}), ...(notificationApi ? { Notification: notificationApi } : {}) })
  if (notificationApi) vi.stubGlobal('Notification', notificationApi)
  else vi.stubGlobal('Notification', undefined)
  push.pushSupported.mockReturnValue(!!(notification && serviceWorker && pushManager))
  push.pushPermission.mockReturnValue(notification && serviceWorker && pushManager ? permission : 'unsupported')
  push.enablePush.mockRejectedValue(new Error('public key unavailable'))
  push.scheduleTestRestAlert.mockResolvedValue({})

  const { useStore, DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify({ ...structuredClone(DEF), onboarded: true }))
  memory.set('gym_user', JSON.stringify({ id: 'member-test', name: 'Test Member' }))
  const { bindUI } = await import('../components/ui.jsx')
  const { useUI } = await import('../store/useUI.js')
  bindUI(useUI)
  const View = (await import('./TrainingSettings.jsx')).default
  return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>)
}

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks() })

describe('Training Settings isolates optional Web Push', () => {
  it('renders the normal training settings with Web Push available', async () => {
    const html = await renderTraining()
    expect(html).toContain('Training')
    expect(html).toContain('Rest timer')
    expect(html).toContain('Enable web notifications and test')
  })

  it.each([
    ['Notification missing', { notification: false }],
    ['Service Worker missing', { serviceWorker: false }],
    ['PushManager missing', { pushManager: false }],
    ['permission denied', { permission: 'denied' }],
  ])('renders all settings when %s', async (_label, options) => {
    const html = await renderTraining(options)
    expect(html).toContain('Training')
    expect(html).toContain('Rest timer')
    expect(html).toContain('Sound')
  })

  it('keeps settings usable when the public-key request fails during the optional test flow', async () => {
    const html = await renderTraining()
    expect(html).toContain('Training')
    expect(html).toContain('Rest timer')
    expect(html).toContain('Sound')

    const { runWebPushRestAlertTest } = await import('./TrainingSettings.jsx')
    const outcome = await runWebPushRestAlertTest()
    expect(outcome.ok).toBe(false)
    expect(outcome.error.message).toBe('public key unavailable')
    expect(push.scheduleTestRestAlert).not.toHaveBeenCalled()
  })
})
