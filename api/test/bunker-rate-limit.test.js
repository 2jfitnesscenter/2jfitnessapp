import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { tempData } from './helpers.mjs'

tempData()
const { bunkerRoutes } = await import('../bunker/routes.js')
const store = await import('../bunker/store.js')
const { AttemptLimiter, bunkerClientIp } = await import('../bunker/rate-limit.js')

let now = 1000
const limiters = () => ({
  pin: new AttemptLimiter({ limit: 3, windowMs: 60000, blockMs: 30000, now: () => now }),
  admin: new AttemptLimiter({ limit: 2, windowMs: 60000, blockMs: 60000, now: () => now }),
})
const people = [{ id: 'member', name: 'Member' }, { id: 'trainer', name: 'Trainer', trainer: true }]
const sign = payload => payload + '.' + crypto.createHash('sha256').update(payload).digest('hex')
const factory = rateLimiters => bunkerRoutes({
  json: (res, status, body, headers) => Object.assign(res, { status, body, headers }),
  readBody: async req => req.body, readSession: () => null, sign, verifySig: () => null,
  users: () => people, isTrainer: user => !!user.trainer, rateLimiters,
})
const call = async (handler, body, ip = '198.51.100.1') => {
  const req = { body, headers: { 'x-forwarded-for': ip + ', 172.18.0.4' }, socket: { remoteAddress: '172.18.0.3' } }
  const res = {}; await handler(req, res); return res
}

test('PIN guesses are limited, advertise recovery time, and recover after the block', async () => {
  now = 1000
  const routes = factory(limiters()), checkin = routes['POST /api/bunker/checkin']
  for (let i = 0; i < 3; i++) assert.equal((await call(checkin, { pin: 'nope' })).status, 400)
  const blocked = await call(checkin, { pin: 'nope' })
  assert.equal(blocked.status, 429); assert.equal(blocked.headers['Retry-After'], '30')
  now += 30001
  assert.equal((await call(checkin, { pin: store.pinFor('member') })).status, 200)
})

test('limits are isolated by real client IP and a successful shared-kiosk change clears typos', async () => {
  now = 1000
  const routes = factory(limiters()), checkin = routes['POST /api/bunker/checkin'], pin = store.pinFor('member')
  for (let i = 0; i < 3; i++) await call(checkin, { pin: 'bad' }, '198.51.100.10')
  assert.equal((await call(checkin, { pin }, '198.51.100.11')).status, 200)
  now += 30001
  await call(checkin, { pin: 'bad' }, '198.51.100.10')
  assert.equal((await call(checkin, { pin }, '198.51.100.10')).status, 200)
  assert.equal((await call(checkin, { pin }, '198.51.100.10')).status, 200)
})

test('admin unlock has its own stricter bucket and does not block member check-in', async () => {
  now = 1000
  const routes = factory(limiters()), admin = routes['POST /api/bunker/admin-checkin'], checkin = routes['POST /api/bunker/checkin']
  await call(admin, { code: 'bad' }); await call(admin, { code: 'bad' })
  assert.equal((await call(admin, { code: 'bad' })).status, 429)
  assert.equal((await call(checkin, { pin: store.pinFor('member') })).status, 200)
})

test('proxy address uses the first forwarded hop only from a private direct peer', () => {
  assert.equal(bunkerClientIp({ headers: { 'x-forwarded-for': '203.0.113.8, 172.18.0.4' }, socket: { remoteAddress: '172.18.0.3' } }), '203.0.113.8')
  assert.equal(bunkerClientIp({ headers: { 'x-forwarded-for': '203.0.113.8' }, socket: { remoteAddress: '198.51.100.9' } }), '198.51.100.9')
})
