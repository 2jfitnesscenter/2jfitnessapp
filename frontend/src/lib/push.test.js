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

describe('rest timer Web Push scheduling', () => {
  it('uses only an already granted permission and existing subscription, then schedules/cancels the same alert id', async () => {
    const subscription = { endpoint: 'https://push.example.test/rest', toJSON: () => ({ endpoint: 'https://push.example.test/rest', keys: { p256dh: 'p', auth: 'a' } }) }
    const requestPermission = vi.fn()
    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } }
    browser({ ready: Promise.resolve(reg) }, { permission: 'granted', requestPermission })
    api.mockImplementation(async path => path === '/api/push/subscribe' ? { subscriptionId: 'sub-id' } : { ok: true })
    const { syncRestPushAlert } = await import('./push.js')
    const timer = { alertId: 'rest_alert_123456', endsAt: Date.now() + 20_000, paused: false }
    const getCurrentOwnerId = () => 'u1'

    await syncRestPushAlert({ timer, ownerId: 'u1', enabled: true, getCurrentOwnerId })
    await syncRestPushAlert({ timer, ownerId: 'u1', enabled: false, getCurrentOwnerId })

    expect(requestPermission).not.toHaveBeenCalled()
    expect(reg.pushManager.getSubscription).toHaveBeenCalledTimes(1)
    expect(api.mock.calls.map(([path]) => path)).toEqual(['/api/push/subscribe', '/api/rest-alert', '/api/rest-alert/cancel'])
    expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({ subscriptionId: 'sub-id', alertId: timer.alertId, endsAt: timer.endsAt })
    expect(JSON.parse(api.mock.calls[2][1].body)).toEqual({ subscriptionId: 'sub-id', alertId: timer.alertId })
  })

  it('silently skips denied permission, missing subscription, and a changed account', async () => {
    const { syncRestPushAlert } = await import('./push.js')
    const timer = { alertId: 'rest_alert_654321', endsAt: Date.now() + 20_000, paused: false }
    const requestPermission = vi.fn()

    browser({ ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }) }, { permission: 'denied', requestPermission })
    await syncRestPushAlert({ timer, ownerId: 'u1', enabled: true, getCurrentOwnerId: () => 'u1' })
    expect(api).not.toHaveBeenCalled()
    expect(requestPermission).not.toHaveBeenCalled()

    browser({ ready: Promise.resolve({ pushManager: { getSubscription: vi.fn().mockResolvedValue(null) } }) }, { permission: 'granted', requestPermission })
    await syncRestPushAlert({ timer: { ...timer, alertId: 'rest_alert_654322' }, ownerId: 'u1', enabled: true, getCurrentOwnerId: () => 'u1' })
    await syncRestPushAlert({ timer: { ...timer, alertId: 'rest_alert_654323' }, ownerId: 'u1', enabled: true, getCurrentOwnerId: () => 'u2' })
    expect(api).not.toHaveBeenCalled()
  })

  it('serializes reschedule and cancellation so an older rest cannot replace a newer one', async () => {
    const subscription = { toJSON: () => ({ endpoint: 'https://push.example.test/restart', keys: { p256dh: 'p', auth: 'a' } }) }
    const reg = { pushManager: { getSubscription: vi.fn().mockResolvedValue(subscription) } }
    browser({ ready: Promise.resolve(reg) }, { permission: 'granted', requestPermission: vi.fn() })
    api.mockImplementation(async path => path === '/api/push/subscribe' ? { subscriptionId: 'sub-restart' } : { ok: true })
    const { syncRestPushAlert } = await import('./push.js')
    let currentOwner = 'u1'
    const getCurrentOwnerId = () => currentOwner
    const oldTimer = { alertId: 'rest_alert_old_1234', endsAt: Date.now() + 30_000, paused: false }
    const newTimer = { alertId: 'rest_alert_new_1234', endsAt: Date.now() + 45_000, paused: false }

    await syncRestPushAlert({ timer: oldTimer, ownerId: 'u1', enabled: true, getCurrentOwnerId })
    await syncRestPushAlert({ timer: oldTimer, ownerId: 'u1', enabled: false, getCurrentOwnerId })
    await syncRestPushAlert({ timer: newTimer, ownerId: 'u1', enabled: true, getCurrentOwnerId })
    currentOwner = 'u2'
    await syncRestPushAlert({ timer: newTimer, ownerId: 'u1', enabled: false, getCurrentOwnerId })

    expect(api.mock.calls.map(([path]) => path)).toEqual([
      '/api/push/subscribe', '/api/rest-alert', '/api/rest-alert/cancel', '/api/push/subscribe', '/api/rest-alert',
    ])
    expect(JSON.parse(api.mock.calls.at(-1)[1].body).alertId).toBe(newTimer.alertId)
    expect(JSON.parse(api.mock.calls.at(-1)[1].body)).not.toHaveProperty('exercise')
    currentOwner = 'u1'
    await syncRestPushAlert({ timer: newTimer, ownerId: 'u1', enabled: false, getCurrentOwnerId })
  })
})
