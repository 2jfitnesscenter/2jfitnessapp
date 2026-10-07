import { afterEach, describe, expect, it, vi } from 'vitest'

const api = vi.fn()
vi.mock('./api.js', () => ({ api: (...args) => api(...args) }))
vi.mock('./i18n.js', () => ({ t: value => value }))

const originalLocalStorage = globalThis.localStorage
const originalNotification = globalThis.Notification
const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: originalLocalStorage })
  if (originalNotification) Object.defineProperty(globalThis, 'Notification', { configurable: true, value: originalNotification })
  else delete globalThis.Notification
  if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator)
  else delete globalThis.navigator
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
  else delete globalThis.window
})

const browser = (serviceWorker, notification) => {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { PushManager: function PushManager() {}, Notification: notification } })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { serviceWorker } })
  Object.defineProperty(globalThis, 'Notification', { configurable: true, value: notification })
}

describe('Web Push setup', () => {
  it('requests permission only through enablePush and registers the browser subscription to the current account', async () => {
    const subscription = { toJSON: () => ({ endpoint: 'https://push.example.test/sub', keys: { p256dh: 'p', auth: 'a' } }) }
    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn().mockResolvedValue(subscription) } }
    const requestPermission = vi.fn().mockResolvedValue('granted')
    const values = new Map()
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } })
    browser({ ready: Promise.resolve(reg) }, { permission: 'default', requestPermission })
    api.mockImplementation(async path => path === '/api/push/public-key' ? { key: 'AQID' } : { subscriptionId: 'subscription-id' })
    const { enablePush, scheduleTestRestAlert } = await import('./push.js')

    const result = await enablePush()
    expect(requestPermission).toHaveBeenCalledTimes(1)
    expect(reg.pushManager.subscribe).toHaveBeenCalledWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) })
    expect(api).toHaveBeenLastCalledWith('/api/push/subscribe', expect.objectContaining({ method: 'POST' }))
    const body = JSON.parse(api.mock.calls.at(-1)[1].body)
    expect(body.subscription).toEqual(subscription.toJSON())
    expect(body.deviceId).toMatch(/^[A-Za-z0-9_-]{8,100}$/)
    expect(result.subscriptionId).toBe('subscription-id')

    await scheduleTestRestAlert(result.subscriptionId)
    expect(api).toHaveBeenLastCalledWith('/api/rest-alert/test', expect.objectContaining({ body: '{"subscriptionId":"subscription-id"}' }))
  })

  it('does not re-prompt when permission is denied', async () => {
    const requestPermission = vi.fn()
    browser({ ready: Promise.resolve({}) }, { permission: 'denied', requestPermission })
    const { enablePush } = await import('./push.js')
    await expect(enablePush()).rejects.toThrow('Notifications are blocked')
    expect(requestPermission).not.toHaveBeenCalled()
    expect(api).not.toHaveBeenCalled()
  })

  it('reuses an existing subscription and never exposes the private VAPID key to the browser', async () => {
    const subscription = { toJSON: () => ({ endpoint: 'https://push.example.test/existing', keys: { p256dh: 'p', auth: 'a' } }) }
    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription), subscribe: vi.fn() } }
    browser({ ready: Promise.resolve(reg) }, { permission: 'granted', requestPermission: vi.fn() })
    api.mockImplementation(async path => path === '/api/push/public-key' ? { key: 'public-only' } : { subscriptionId: 's1' })
    const { enablePush } = await import('./push.js')
    await enablePush()
    expect(reg.pushManager.subscribe).not.toHaveBeenCalled()
    expect(api.mock.calls.some(([path]) => path === '/api/push/private-key')).toBe(false)
  })

  it('keeps feature detection safe when browser globals are missing', async () => {
    const { pushSupported, pushPermission } = await import('./push.js')
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: undefined })
    Object.defineProperty(globalThis, 'window', { configurable: true, value: undefined })
    Object.defineProperty(globalThis, 'Notification', { configurable: true, value: undefined })
    expect(pushSupported()).toBe(false)
    expect(pushPermission()).toBe('unsupported')
  })

  it('rejects an unavailable registration PushManager and a failed public-key request without leaking the error into render', async () => {
    browser({ ready: Promise.resolve({}) }, { permission: 'granted', requestPermission: vi.fn() })
    const { enablePush } = await import('./push.js')
    await expect(enablePush()).rejects.toThrow('not supported')

    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(null), subscribe: vi.fn() } }
    browser({ ready: Promise.resolve(reg) }, { permission: 'granted', requestPermission: vi.fn() })
    api.mockRejectedValueOnce(new Error('public key unavailable'))
    await expect(enablePush()).rejects.toThrow('public key unavailable')
  })
})
