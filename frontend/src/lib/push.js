// Web Push subscribe/unsubscribe — requires a signed-in profile (subscriptions are stored
// server-side per user, same as everything else under /api).
import { api } from './api.js'
import { t } from './i18n.js'

const notificationApi = () => globalThis.Notification || globalThis.window?.Notification

export const pushSupported = () => Boolean(
  globalThis.navigator?.serviceWorker && globalThis.window?.PushManager && notificationApi(),
)
export const pushPermission = () => {
  try { return pushSupported() ? notificationApi().permission || 'unsupported' : 'unsupported' }
  catch { return 'unsupported' }
}

function pushDeviceId() {
  const key = '2j_push_device_v1'
  let value
  try { value = localStorage.getItem(key) } catch {}
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(value || '')) {
    value = globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
    try { localStorage.setItem(key, value) } catch {}
  }
  return value
}

const urlBase64ToUint8Array = b64 => {
  const padded = (b64 + '='.repeat((4 - b64.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(padded)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function enablePush() {
  if (!pushSupported()) throw new Error(t('Push notifications are not supported in this browser'))
  const notifications = notificationApi()
  if (notifications.permission === 'denied') throw new Error(t('Notifications are blocked. Open your browser or device settings to allow them for 2J Fitness.'))
  const perm = notifications.permission === 'granted' ? 'granted' : await notifications.requestPermission()
  if (perm !== 'granted') throw new Error(t('Notifications permission was not granted'))
  const reg = await globalThis.navigator?.serviceWorker?.ready
  if (!reg?.pushManager?.getSubscription || !reg.pushManager.subscribe) throw new Error(t('Push notifications are not supported in this browser'))
  const keyResponse = await api('/api/push/public-key')
  const key = keyResponse?.key
  if (typeof key !== 'string' || !key) throw new Error(t('Could not schedule the notification test.'))
  // Reusing the current browser subscription makes opt-in idempotent when a member previously
  // enabled push under the existing rest-timer settings.
  const subscription = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) })
  const result = await api('/api/push/subscribe', { method: 'POST', body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: pushDeviceId() }) })
  return { subscriptionId: result.subscriptionId, subscription }
}

// Rest alerts use the durable, account-scoped scheduler. This path never requests permission
// and never creates a subscription: it only schedules when this browser already has an active
// subscription and the user explicitly granted notifications earlier in Settings.
let restAlertQueue = Promise.resolve()
let activeRestAlert = null
const enqueueRestAlert = operation => {
  const result = restAlertQueue.then(operation, operation)
  restAlertQueue = result.catch(() => {})
  return result
}

async function existingPushSubscriptionId(ownerId, getCurrentOwnerId) {
  if (!ownerId || getCurrentOwnerId() !== ownerId || !pushSupported() || pushPermission() !== 'granted') return null
  const registration = await globalThis.navigator.serviceWorker.ready
  const manager = registration?.pushManager
  if (!manager?.getSubscription) return null
  const subscription = await manager.getSubscription()
  if (!subscription || getCurrentOwnerId() !== ownerId) return null
  const result = await api('/api/push/subscribe', {
    method: 'POST',
    body: JSON.stringify({ subscription: subscription.toJSON(), deviceId: pushDeviceId() }),
  })
  return getCurrentOwnerId() === ownerId ? result?.subscriptionId || null : null
}

export function syncRestPushAlert({ timer, ownerId, enabled, getCurrentOwnerId = () => ownerId }) {
  return enqueueRestAlert(async () => {
    if (timer && enabled && !timer.paused) {
      if (!ownerId || getCurrentOwnerId() !== ownerId || !/^[A-Za-z0-9_-]{12,80}$/.test(timer.alertId || '')) return false
      const subscriptionId = activeRestAlert?.ownerId === ownerId
        ? activeRestAlert.subscriptionId
        : await existingPushSubscriptionId(ownerId, getCurrentOwnerId)
      if (!subscriptionId || getCurrentOwnerId() !== ownerId) return false
      activeRestAlert = { ownerId, subscriptionId, alertId: timer.alertId }
      const result = await api('/api/rest-alert', {
        method: 'POST',
        body: JSON.stringify({ subscriptionId, alertId: timer.alertId, endsAt: timer.endsAt }),
      })
      return !!result?.ok
    }

    const alertId = timer?.alertId
    const pending = activeRestAlert
    if (!pending || (alertId && pending.alertId !== alertId) || getCurrentOwnerId() !== pending.ownerId) return false
    await api('/api/rest-alert/cancel', {
      method: 'POST',
      body: JSON.stringify({ subscriptionId: pending.subscriptionId, alertId: pending.alertId }),
    })
    if (activeRestAlert?.alertId === pending.alertId) activeRestAlert = null
    return true
  }).catch(() => false)
}

export async function disablePush() {
  if (!pushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  await sub.unsubscribe()
  await api('/api/push/unsubscribe', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {})
}

export const sendTestPush = () => api('/api/push/test', { method: 'POST', body: '{}' })

export const scheduleTestRestAlert = subscriptionId => api('/api/rest-alert/test', {
  method: 'POST', body: JSON.stringify({ subscriptionId }),
})
