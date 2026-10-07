import crypto from 'node:crypto'

export const restSubscriptionId = endpoint => crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 32)

export function pushRequestError({ origin, expectedOrigin, user }) {
  if (origin !== expectedOrigin) return 'origin_not_allowed'
  if (!user) return 'not_authenticated'
  if (user.authLevel !== 'passkey') return 'passkey_required'
  return null
}

export function createRestAlertRateLimiter({ now = Date.now } = {}) {
  const buckets = new Map()
  return (key, limit, windowMs) => {
    const at = now()
    const bucket = buckets.get(key)
    if (!bucket || at - bucket.startedAt >= windowMs) {
      buckets.set(key, { startedAt: at, count: 1 })
      if (buckets.size > 5000) for (const [id, value] of buckets) if (at - value.startedAt >= windowMs) buckets.delete(id)
      return true
    }
    if (bucket.count >= limit) return false
    bucket.count++
    return true
  }
}

const iso = ms => new Date(ms).toISOString()
const activeStatuses = new Set(['scheduled', 'sending'])

export function createRestAlertScheduler({ db, saveDb, send, now = Date.now, maxAttempts = 3 }) {
  db.subs = Array.isArray(db.subs) ? db.subs : []
  db.restAlerts = Array.isArray(db.restAlerts) ? db.restAlerts : []
  let running = null

  function ownSubscription(userId, id) {
    return db.subs.find(sub => sub.userId === userId && sub.id === id && sub.enabled !== false) || null
  }

  function prune(at) {
    const before = db.restAlerts.length
    db.restAlerts = db.restAlerts.filter(alert => activeStatuses.has(alert.status) || at - Date.parse(alert.updatedAt || alert.createdAt) < 7 * 86400000)
    if (db.restAlerts.length > 2000) {
      const terminal = db.restAlerts.filter(alert => !activeStatuses.has(alert.status)).sort((a, b) => Date.parse(a.updatedAt) - Date.parse(b.updatedAt))
      const remove = new Set(terminal.slice(0, db.restAlerts.length - 2000))
      db.restAlerts = db.restAlerts.filter(alert => !remove.has(alert))
    }
    return db.restAlerts.length !== before
  }

  function schedule({ userId, subscriptionId, alertId, endsAt, kind = 'rest' }) {
    const at = now()
    const timestamp = Number(endsAt)
    if (!/^[A-Za-z0-9_-]{12,80}$/.test(String(alertId || '')) || !Number.isSafeInteger(timestamp) || timestamp < at + 1000 || timestamp > at + 2 * 60 * 60_000)
      return { error: 'invalid_alert' }
    if (!['rest', 'test'].includes(kind)) return { error: 'invalid_kind' }
    const sub = ownSubscription(userId, subscriptionId)
    if (!sub) return { error: 'subscription_not_found' }
    const existing = db.restAlerts.find(alert => alert.userId === userId && alert.subscriptionId === subscriptionId && alert.alertId === alertId)
    if (existing && activeStatuses.has(existing.status)) {
      if (existing.endsAt === timestamp && existing.kind === kind) return { alert: existing, duplicate: true }
      existing.status = 'cancelled'
      existing.updatedAt = iso(at)
    }
    for (const alert of db.restAlerts) {
      if (alert.userId === userId && alert.subscriptionId === subscriptionId && alert.kind === kind && activeStatuses.has(alert.status)) {
        alert.status = 'cancelled'
        alert.updatedAt = iso(at)
      }
    }
    const alert = {
      id: crypto.randomUUID(), userId, subscriptionId, alertId: String(alertId), endsAt: timestamp,
      kind, status: 'scheduled', attempts: 0, nextAttemptAt: timestamp,
      createdAt: iso(at), updatedAt: iso(at),
    }
    db.restAlerts.push(alert)
    prune(at)
    saveDb()
    return { alert, duplicate: false }
  }

  function cancel({ userId, subscriptionId, alertId }) {
    if (!ownSubscription(userId, subscriptionId)) return { error: 'subscription_not_found' }
    const at = now()
    let changed = 0
    for (const alert of db.restAlerts) {
      if (alert.userId === userId && alert.subscriptionId === subscriptionId &&
          (!alertId || alert.alertId === alertId) && activeStatuses.has(alert.status)) {
        alert.status = 'cancelled'
        alert.updatedAt = iso(at)
        changed++
      }
    }
    if (changed) saveDb()
    return { cancelled: changed }
  }

  async function processDue() {
    if (running) return running
    running = (async () => {
      const at = now()
      let dirty = false
      for (const alert of db.restAlerts) {
        if (!activeStatuses.has(alert.status)) continue
        const sub = ownSubscription(alert.userId, alert.subscriptionId)
        if (!sub || at - alert.endsAt > 24 * 60 * 60_000) {
          alert.status = 'expired'; alert.updatedAt = iso(at); dirty = true; continue
        }
        if (alert.status === 'sending') {
          // A crash can occur after the push service accepted a message. The service worker
          // deduplicates alertId, so resending after recovery cannot create a second banner.
          alert.status = 'scheduled'; alert.nextAttemptAt = at; alert.updatedAt = iso(at); dirty = true
        }
        if (alert.nextAttemptAt > at) continue
        alert.status = 'sending'; alert.attempts++; alert.updatedAt = iso(at); dirty = true
        saveDb() // persist the claim before crossing the network boundary
        const dispatchEndsAt = alert.endsAt
        const dispatchAlertId = alert.alertId
        const payload = alert.kind === 'test'
          ? { type: 'rest-alert-test', id: alert.alertId, url: '#/workout' }
          : { type: 'rest-alert', id: alert.alertId, url: '#/workout' }
        try {
          await send(sub, payload)
          if (alert.status === 'sending' && alert.endsAt === dispatchEndsAt && alert.alertId === dispatchAlertId) {
            alert.status = 'sent'; alert.updatedAt = iso(now()); dirty = true
          }
        } catch (error) {
          if (alert.status !== 'sending' || alert.endsAt !== dispatchEndsAt || alert.alertId !== dispatchAlertId) continue
          if (error?.statusCode === 404 || error?.statusCode === 410) {
            db.subs = db.subs.filter(item => item.id !== sub.id)
            alert.status = 'expired'
            dirty = true
          } else if (alert.attempts < maxAttempts && now() - alert.endsAt < 15 * 60_000) {
            alert.status = 'scheduled'
            alert.nextAttemptAt = now() + Math.min(30_000, 5000 * alert.attempts)
            dirty = true
          } else {
            alert.status = 'expired'; dirty = true
          }
        }
        alert.updatedAt = iso(now())
        saveDb()
      }
      dirty = prune(now()) || dirty
      if (dirty) saveDb()
    })().finally(() => { running = null })
    return running
  }

  function recover() {
    const at = now()
    let changed = false
    for (const alert of db.restAlerts) {
      if (alert.status === 'sending') { alert.status = 'scheduled'; alert.nextAttemptAt = at; alert.updatedAt = iso(at); changed = true }
    }
    changed = prune(at) || changed
    if (changed) saveDb()
  }

  return { schedule, cancel, processDue, recover, ownSubscription }
}

export function normalizePushSubscription(input, userId, deviceId, now = Date.now) {
  const endpoint = typeof input?.endpoint === 'string' ? input.endpoint : ''
  let parsed
  try { parsed = new URL(endpoint) } catch { return { error: 'invalid_subscription' } }
  if (parsed.protocol !== 'https:' || endpoint.length > 2048 || !input?.keys ||
      !/^[A-Za-z0-9_-]{40,200}$/.test(input.keys.p256dh || '') || !/^[A-Za-z0-9_-]{16,100}$/.test(input.keys.auth || '') ||
      !/^[A-Za-z0-9_-]{8,100}$/.test(String(deviceId || ''))) return { error: 'invalid_subscription' }
  const id = restSubscriptionId(endpoint)
  const timestamp = iso(now())
  return {
    subscription: {
      id, deviceId: String(deviceId), userId, endpoint,
      keys: { p256dh: input.keys.p256dh, auth: input.keys.auth },
      createdAt: timestamp, lastSeen: timestamp, enabled: true,
    },
  }
}

export function upsertPushSubscription(db, subscription, now = Date.now) {
  db.subs = Array.isArray(db.subs) ? db.subs : []
  db.restAlerts = Array.isArray(db.restAlerts) ? db.restAlerts : []
  const removed = db.subs.filter(item => item.endpoint === subscription.endpoint ||
    (item.userId === subscription.userId && item.deviceId === subscription.deviceId))
  const prior = removed.find(item => item.userId === subscription.userId && item.id === subscription.id)
  if (prior) subscription.createdAt = prior.createdAt || prior.created || subscription.createdAt
  const removedIds = new Set(removed.map(item => item.id).filter(Boolean))
  for (const alert of db.restAlerts) if (removedIds.has(alert.subscriptionId) && activeStatuses.has(alert.status)) {
    alert.status = 'cancelled'; alert.updatedAt = iso(now())
  }
  db.subs = db.subs.filter(item => !removed.includes(item))
  db.subs.push(subscription)
  return subscription
}
