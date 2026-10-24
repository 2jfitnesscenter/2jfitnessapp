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
  pinCredential: new AttemptLimiter({ limit: 3, windowMs: 60000, blockMs: 30000, now: () => now }),
  admin: new AttemptLimiter({ limit: 2, windowMs: 60000, blockMs: 60000, now: () => now }),
  adminCredential: new AttemptLimiter({ limit: 2, windowMs: 60000, blockMs: 60000, now: () => now }),
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

test('distributed guesses of one PIN are blocked by the credential bucket', async () => {
  now = 1000
  const routes = factory(limiters()), checkin = routes['POST /api/bunker/checkin']
  for (let i = 0; i < 3; i++) {
    assert.equal((await call(checkin, { pin: 'same-wrong-pin' }, '198.51.100.' + (20 + i))).status, 400)
  }
  const blocked = await call(checkin, { pin: 'same-wrong-pin' }, '198.51.100.99')
  assert.equal(blocked.status, 429)
  assert.equal(blocked.body.error, 'demasiados intentos; espera un momento')
})

test('concurrent legitimate members behind one NAT remain independent', async () => {
  now = 1000
  const routes = factory(limiters()), checkin = routes['POST /api/bunker/checkin']
  const memberPin = store.pinFor('member')
  const trainerPin = store.pinFor('trainer')
  await call(checkin, { pin: '1111' }, '198.51.100.50')
  await call(checkin, { pin: '2222' }, '198.51.100.50')
  assert.equal((await call(checkin, { pin: memberPin }, '198.51.100.50')).status, 200)
  assert.equal((await call(checkin, { pin: trainerPin }, '198.51.100.50')).status, 200)
})

test('repeated blocks back off progressively and a later success resets them', () => {
  now = 1000
  const limiter = new AttemptLimiter({ limit: 1, windowMs: 60000, blockMs: 1000, maxBlockMs: 8000, now: () => now })
  limiter.fail('x')
  assert.equal(limiter.check('x').retryAfter, 1)
  now += 1001
  limiter.fail('x')
  assert.equal(limiter.check('x').retryAfter, 2)
  now += 2001
  limiter.success('x')
  assert.deepEqual(limiter.check('x'), { allowed: true })
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

test('contract: a private peer is believed about the first forwarded hop, so the public edge MUST overwrite X-Forwarded-For (docs/security/2J-INT-CLOSURE-security-closure.md)', () => {
  // If the edge forwarded a client-supplied header, a forged leftmost entry would pick the limiter key. Caddy must set it with header_up.
  assert.equal(bunkerClientIp({ headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.8, 172.18.0.4' }, socket: { remoteAddress: '172.18.0.3' } }), '6.6.6.6')
  // A directly reachable (public) peer can never pick its own key.
  assert.equal(bunkerClientIp({ headers: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '7.7.7.7' }, socket: { remoteAddress: '198.51.100.9' } }), '198.51.100.9')
  assert.equal(bunkerClientIp({ headers: {}, socket: { remoteAddress: '::ffff:172.18.0.3' } }), '172.18.0.3')
})

test('TRUSTED_PROXIES: only listed proxies are believed, the client is the rightmost untrusted hop, and a private address proves nothing', async () => {
  const { parseTrustedProxies } = await import('../bunker/rate-limit.js')
  const list = parseTrustedProxies('172.18.0.0/16, 10.1.2.3, ::1')
  const req = (peer, forwarded, extra = {}) => ({ headers: { ...(forwarded ? { 'x-forwarded-for': forwarded } : {}), ...extra }, socket: { remoteAddress: peer } })
  // nginx (172.18.0.3) behind Caddy (172.18.0.1): a forged leftmost entry is ignored even if the edge forwarded it.
  assert.equal(bunkerClientIp(req('172.18.0.3', '6.6.6.6, 203.0.113.8, 172.18.0.1'), list), '203.0.113.8')
  assert.equal(bunkerClientIp(req('::ffff:172.18.0.3', '203.0.113.8, 172.18.0.1'), list), '203.0.113.8')
  // A private peer that is NOT in the list (another container, a LAN host) is keyed by its own address; its header is not believed.
  assert.equal(bunkerClientIp(req('192.168.1.50', '6.6.6.6'), list), '192.168.1.50')
  assert.equal(bunkerClientIp(req('172.19.0.9', '6.6.6.6'), list), '172.19.0.9')
  // A public peer is never believed.
  assert.equal(bunkerClientIp(req('198.51.100.9', '6.6.6.6'), list), '198.51.100.9')
  // Only trusted hops (internal request): fall back to the first hop / real-ip / peer.
  assert.equal(bunkerClientIp(req('172.18.0.3', '172.18.0.1'), list), '172.18.0.1')
  assert.equal(bunkerClientIp(req('172.18.0.3', undefined), list), '172.18.0.3')
  // Without a list the legacy rule is unchanged.
  assert.equal(bunkerClientIp(req('172.18.0.3', '6.6.6.6, 203.0.113.8'), null), '6.6.6.6')
  // Parsing is strict and narrow.
  assert.equal(parseTrustedProxies(''), null)
  for (const bad of ['0.0.0.0/0', '10.0.0.0/7', '172.18.0.0/33', 'nginx', '10.0.0.1/8/1', '300.1.1.1', 'fe80::/10', '10.0.0.1,,x']) assert.throws(() => parseTrustedProxies(bad), /TRUSTED_PROXIES/, bad)
})
