import test from 'node:test'
import assert from 'node:assert/strict'
import { createRestAlertRateLimiter, createRestAlertScheduler, normalizePushSubscription, pushRequestError, upsertPushSubscription } from '../lib/rest-alerts.js'

const endpoint = 'https://push.example.test/subscription/abcdefghijklmnopqrstuvwxyz0123456789'
const keys = { p256dh: 'A'.repeat(65), auth: 'B'.repeat(20) }
const deviceId = 'device_0123456789'
const id = n => `alert_identifier_${n}`

function fixture() {
  let now = 1_800_000_000_000
  const db = { subs: [], restAlerts: [] }
  const saves = []
  const sent = []
  let send = async (sub, payload) => { sent.push({ sub, payload }) }
  const saveDb = () => saves.push(JSON.stringify(db))
  const normalized = normalizePushSubscription({ endpoint, keys }, 'u1', deviceId, () => now)
  db.subs.push(normalized.subscription)
  const scheduler = createRestAlertScheduler({ db, saveDb, send: (...args) => send(...args), now: () => now })
  return { db, saves, sent, scheduler, sub: normalized.subscription, setNow: value => { now = value }, setSend: fn => { send = fn } }
}

test('subscription registration validates HTTPS keys and is stable per endpoint', () => {
  const a = normalizePushSubscription({ endpoint, keys }, 'u1', deviceId, () => 1000)
  const b = normalizePushSubscription({ endpoint, keys }, 'u2', deviceId, () => 2000)
  assert.equal(a.subscription.id, b.subscription.id)
  assert.equal(a.subscription.userId, 'u1')
  assert.equal(a.subscription.deviceId, deviceId)
  assert.equal(a.subscription.enabled, true)
  assert.equal(normalizePushSubscription({ endpoint: 'http://push.test/x', keys }, 'u1', deviceId).error, 'invalid_subscription')
  assert.equal(normalizePushSubscription({ endpoint, keys: { p256dh: 'bad', auth: 'bad' } }, 'u1', deviceId).error, 'invalid_subscription')
  assert.equal(normalizePushSubscription({ endpoint, keys }, 'u1', 'x').error, 'invalid_subscription')
})

test('subscription upsert is idempotent, retains other devices, and replaces stale endpoint for the same device', () => {
  const subA = normalizePushSubscription({ endpoint, keys }, 'u1', deviceId, () => 1000).subscription
  const otherDevice = normalizePushSubscription({ endpoint: endpoint + '/other', keys }, 'u1', 'device_987654321', () => 1000).subscription
  const db = { subs: [subA, otherDevice], restAlerts: [{ subscriptionId: subA.id, status: 'scheduled', userId: 'u1' }] }
  const refreshed = normalizePushSubscription({ endpoint, keys }, 'u1', deviceId, () => 2000).subscription
  upsertPushSubscription(db, refreshed, () => 2000)
  assert.equal(db.subs.length, 2)
  assert.equal(db.subs.find(item => item.id === subA.id).createdAt, subA.createdAt)
  const replacement = normalizePushSubscription({ endpoint: endpoint + '/new', keys }, 'u1', deviceId, () => 3000).subscription
  upsertPushSubscription(db, replacement, () => 3000)
  assert.equal(db.subs.length, 2)
  assert.ok(db.subs.some(item => item.id === otherDevice.id))
  assert.ok(db.subs.some(item => item.id === replacement.id))
  assert.equal(db.restAlerts[0].status, 'cancelled')
})

test('schedule is idempotent, replaces pending alert on that device and sends only a private-safe payload', async () => {
  const f = fixture(), endA = 1_800_000_010_000, endB = 1_800_000_020_000
  const first = f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(1), endsAt: endA })
  assert.equal(first.error, undefined)
  assert.equal(f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(1), endsAt: endA }).duplicate, true)
  f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(2), endsAt: endB })
  assert.equal(f.db.restAlerts[0].status, 'cancelled')
  assert.equal(f.db.restAlerts.length, 2)
  f.setNow(endB)
  await f.scheduler.processDue()
  assert.equal(f.db.restAlerts[1].status, 'sent')
  assert.equal(f.sent.length, 1)
  assert.deepEqual(f.sent[0].payload, { type: 'rest-alert', id: id(2), url: '#/workout' })
  assert.equal(JSON.stringify(f.sent[0].payload).includes('Press'), false)
})

test('ownership blocks another user from scheduling or cancelling a subscription', () => {
  const f = fixture()
  assert.equal(f.scheduler.schedule({ userId: 'u2', subscriptionId: f.sub.id, alertId: id(3), endsAt: 1_800_000_010_000 }).error, 'subscription_not_found')
  assert.equal(f.scheduler.cancel({ userId: 'u2', subscriptionId: f.sub.id, alertId: id(3) }).error, 'subscription_not_found')
  assert.equal(f.db.restAlerts.length, 0)
})

test('cancel is idempotent and prevents due delivery', async () => {
  const f = fixture(), endsAt = 1_800_000_010_000
  f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(4), endsAt })
  assert.deepEqual(f.scheduler.cancel({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(4) }), { cancelled: 1 })
  assert.deepEqual(f.scheduler.cancel({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(4) }), { cancelled: 0 })
  f.setNow(endsAt)
  await f.scheduler.processDue()
  assert.equal(f.sent.length, 0)
  assert.equal(f.db.restAlerts[0].status, 'cancelled')
})

test('a test notification never replaces an active workout rest alert', () => {
  const f = fixture(), endsAt = 1_800_000_010_000
  f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(10), endsAt })
  f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(11), endsAt: endsAt + 1000, kind: 'test' })
  assert.deepEqual(f.db.restAlerts.map(alert => alert.status), ['scheduled', 'scheduled'])
})

test('restart recovers a claimed alert and overdue alerts expire after one day', async () => {
  const f = fixture(), endsAt = 1_800_000_010_000
  f.db.restAlerts.push({ id: 'stored', userId: 'u1', subscriptionId: f.sub.id, alertId: id(5), endsAt, kind: 'rest', status: 'sending', attempts: 1, nextAttemptAt: endsAt, createdAt: new Date(endsAt - 1).toISOString(), updatedAt: new Date(endsAt).toISOString() })
  f.setNow(endsAt + 1000)
  f.scheduler.recover()
  assert.equal(f.db.restAlerts[0].status, 'scheduled')
  await f.scheduler.processDue()
  assert.equal(f.db.restAlerts[0].status, 'sent')
  f.db.restAlerts.push({ id: 'old', userId: 'u1', subscriptionId: f.sub.id, alertId: id(6), endsAt: endsAt - 2 * 86400000, kind: 'rest', status: 'scheduled', attempts: 0, nextAttemptAt: endsAt - 2 * 86400000, createdAt: new Date(endsAt).toISOString(), updatedAt: new Date(endsAt).toISOString() })
  await f.scheduler.processDue()
  assert.equal(f.db.restAlerts.find(a => a.id === 'old').status, 'expired')
})

test('transient push failure retries; revoked endpoint expires and is removed', async () => {
  const f = fixture(), endsAt = 1_800_000_010_000
  let fail = true
  f.setSend(async () => { if (fail) { fail = false; throw new Error('temporary') } })
  f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(7), endsAt })
  f.setNow(endsAt)
  await f.scheduler.processDue()
  assert.equal(f.db.restAlerts[0].status, 'scheduled')
  assert.equal(f.db.restAlerts[0].attempts, 1)
  f.setNow(f.db.restAlerts[0].nextAttemptAt)
  await f.scheduler.processDue()
  assert.equal(f.db.restAlerts[0].status, 'sent')

  const second = f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(8), endsAt: f.db.restAlerts[0].nextAttemptAt + 1000 })
  assert.ok(second.alert)
  f.setSend(async () => { const error = new Error('gone'); error.statusCode = 410; throw error })
  f.setNow(second.alert.endsAt)
  await f.scheduler.processDue()
  assert.equal(f.db.restAlerts.find(a => a.alertId === id(8)).status, 'expired')
  assert.equal(f.db.subs.some(s => s.id === f.sub.id), false)
})

test('single-flight prevents concurrent worker ticks from sending twice', async () => {
  const f = fixture(), endsAt = 1_800_000_010_000
  let release
  f.setSend(() => new Promise(resolve => { release = resolve }))
  f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(9), endsAt })
  f.setNow(endsAt)
  const one = f.scheduler.processDue(), two = f.scheduler.processDue()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.db.restAlerts[0].attempts, 1)
  release()
  await Promise.all([one, two])
  assert.equal(f.db.restAlerts[0].status, 'sent')
})

test('cancellation during an in-flight push is not overwritten when send resolves', async () => {
  const f = fixture(), endsAt = 1_800_000_010_000
  let release
  f.setSend(() => new Promise(resolve => { release = resolve }))
  f.scheduler.schedule({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(12), endsAt })
  f.setNow(endsAt)
  const sending = f.scheduler.processDue()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(f.db.restAlerts[0].status, 'sending')
  f.scheduler.cancel({ userId: 'u1', subscriptionId: f.sub.id, alertId: id(12) })
  release()
  await sending
  assert.equal(f.db.restAlerts[0].status, 'cancelled')
})

test('rate limiter bounds repeated test pushes', () => {
  let now = 1000
  const allow = createRestAlertRateLimiter({ now: () => now })
  assert.equal(allow('u1:device1', 2, 60_000), true)
  assert.equal(allow('u1:device1', 2, 60_000), true)
  assert.equal(allow('u1:device1', 2, 60_000), false)
  assert.equal(allow('u2:device1', 2, 60_000), true)
  now += 60_001
  assert.equal(allow('u1:device1', 2, 60_000), true)
})

test('push mutations require exact app origin and authenticated passkey session', () => {
  const expectedOrigin = 'https://app.2jfitnesscenter.com'
  assert.equal(pushRequestError({ origin: expectedOrigin, expectedOrigin, user: { id: 'u1', authLevel: 'passkey' } }), null)
  assert.equal(pushRequestError({ origin: 'https://evil.example', expectedOrigin, user: { id: 'u1', authLevel: 'passkey' } }), 'origin_not_allowed')
  assert.equal(pushRequestError({ origin: expectedOrigin, expectedOrigin, user: null }), 'not_authenticated')
  assert.equal(pushRequestError({ origin: expectedOrigin, expectedOrigin, user: { id: 'staff', authLevel: 'pin' } }), 'passkey_required')
})
