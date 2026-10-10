// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Authenticator, bootServer } from './webauthn-helper.mjs'
import { createLinkStore, LINK_TTL_MS, CODE_TRIES } from '../lib/device-link.js'

/* QR device linking: A (signed out) shows a QR, B (signed in) approves it with the code shown on A and a fresh passkey, A is signed in once.
 * The store is exercised with a controllable clock; the HTTP flow runs on a real server with real WebAuthn assertions. */
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.61'
const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36'

test('the store: one link, one approval, one claim; wrong secrets and codes get nowhere; links expire', () => {
  let t = 1_000_000
  const store = createLinkStore({ now: () => t })
  const a = store.start({ platform: 'Windows · Edge' })
  assert.match(a.id, /^[A-Z2-9]{10}$/); assert.match(a.code, /^\d{4}$/); assert.ok(a.secret.length >= 40)
  assert.deepEqual(store.info(a.id), { id: a.id, platform: 'Windows · Edge', expiresAt: t + LINK_TTL_MS })
  assert.ok(!('code' in store.info(a.id)) && !('secret' in store.info(a.id)))
  assert.deepEqual(store.claim(a.id, a.secret), { status: 'pending' })
  assert.equal(store.claim(a.id, 'not-the-secret').error, 'forbidden')
  assert.equal(store.claim('NOSUCHLINK', a.secret).error, 'not_found')
  assert.equal(store.approve(a.id, 'u1', a.code === '0000' ? '1111' : '0000').error, 'wrong_code')
  assert.deepEqual(store.approve(a.id, 'u1', a.code), { ok: true })
  assert.equal(store.approve(a.id, 'u2', a.code).error, 'taken', 'a second approval cannot take it over')
  assert.equal(store.info(a.id), null, 'once approved it is no longer offered')
  assert.deepEqual(store.claim(a.id, a.secret), { status: 'approved', userId: 'u1', platform: 'Windows · Edge' })
  assert.equal(store.claim(a.id, a.secret).error, 'used', 'replay is refused')

  const b = store.start({ platform: 'x' })
  t += LINK_TTL_MS + 1
  assert.equal(store.claim(b.id, b.secret).error, 'expired'); assert.equal(store.approve(b.id, 'u1', b.code).error, 'expired'); assert.equal(store.info(b.id), null)
  const c = store.start({ platform: 'x' })
  assert.deepEqual(store.approve(c.id, 'u1', c.code), { ok: true })
  t += LINK_TTL_MS + 1
  assert.equal(store.claim(c.id, c.secret).error, 'expired', 'an approved link that is not claimed in time is dead too')
  store.sweep(); t += 120_000; store.sweep()
  assert.equal(store.size(), 0)
})

test('the store: three wrong codes kill the link, and the number of open links is bounded', () => {
  const store = createLinkStore({ max: 3 })
  const a = store.start({ platform: 'x' })
  const wrong = a.code === '0000' ? '1111' : '0000'
  for (let i = 1; i < CODE_TRIES; i++) assert.equal(store.approve(a.id, 'u1', wrong).error, 'wrong_code')
  assert.equal(store.approve(a.id, 'u1', wrong).error, 'denied')
  assert.equal(store.approve(a.id, 'u1', a.code).error, 'expired', 'even the right code is too late')
  assert.equal(store.claim(a.id, a.secret).error, 'denied')
  store.start({ platform: 'x' }); store.start({ platform: 'x' })
  assert.equal(store.start({ platform: 'x' }), null, 'no more than the cap at once')
})

const keyB = new Authenticator(), keyC = new Authenticator()
const srv = await bootServer({
  port: 34815,
  db: { users: [{ id: 'b', name: 'Bruno' }, { id: 'c', name: 'Carla' }, { id: 'x', name: 'Xavi' }, { id: 'ad', name: 'Admin', admin: true }], creds: [keyB.record('b'), keyC.record('c')] },
})
after(() => srv.stop())
const B = srv.cookieFor('b'), C = srv.cookieFor('c')

async function stepUp(cookie, key, purpose) {
  const o = await (await srv.post('/api/me/step-up/options', {}, cookie)).json()
  const res = await srv.post('/api/me/step-up', { cid: o.cid, purpose, credential: key.assertion(o.options.challenge, { origin: srv.origin }) }, cookie)
  assert.equal(res.status, 200)
  return (await res.json()).token
}
const start = async () => (await srv.post('/api/link/start', {}, '', { 'user-agent': LAPTOP })).json()

test('the whole flow: A shows the QR, B approves with the code and a passkey, A is signed in once as B', async () => {
  const link = await start()
  assert.equal((await srv.post('/api/link/claim', { id: link.id, secret: link.secret })).status, 202)
  assert.equal((await srv.get('/api/link/info?id=' + link.id)).status, 401, 'only a signed-in person can look at it')

  const info = await (await srv.get('/api/link/info?id=' + link.id, B)).json()
  assert.deepEqual(Object.keys(info).sort(), ['expiresAt', 'id', 'platform']); assert.equal(info.platform, 'Windows · Edge')

  const body = { id: link.id, code: link.code }
  assert.equal((await srv.post('/api/link/approve', body, B)).status, 403, 'a passkey step-up is required')
  const wrongPurpose = await stepUp(B, keyB, 'passkeys')
  assert.equal((await srv.post('/api/link/approve', body, B, { 'x-step-up': wrongPurpose })).status, 403, 'a step-up for passkeys does not approve devices')
  const token = await stepUp(B, keyB, 'device-link')
  assert.equal((await srv.post('/api/link/approve', body, srv.cookieFor('x'), { 'x-step-up': token })).status, 403, "another person's step-up proves nothing")
  const bad = await srv.post('/api/link/approve', { id: link.id, code: link.code === '0000' ? '1111' : '0000' }, B, { 'x-step-up': token })
  assert.equal(bad.status, 403); assert.equal((await bad.json()).triesLeft, 2)
  assert.equal((await srv.post('/api/link/approve', body, B, { 'x-step-up': token })).status, 200)
  assert.equal((await srv.post('/api/link/approve', body, B, { 'x-step-up': token })).status, 409, 'approved once')

  const claimed = await srv.post('/api/link/claim', { id: link.id, secret: link.secret }, '', { 'user-agent': LAPTOP })
  assert.equal(claimed.status, 200)
  const cookie = claimed.headers.get('set-cookie').split(';')[0]
  assert.equal((await claimed.json()).user.id, 'b')
  assert.equal((await (await srv.get('/api/me', cookie)).json()).user.id, 'b')
  const mine = (await (await srv.get('/api/me/sessions', cookie)).json()).sessions
  assert.ok(mine.some(s => s.current && s.via === 'qr' && s.platform === 'Windows · Edge'))
  // replay
  assert.equal((await srv.post('/api/link/claim', { id: link.id, secret: link.secret })).status, 410)
  assert.equal((await srv.post('/api/link/claim', { id: link.id, secret: 'wrong' })).status, 403)
  assert.ok(srv.readDb().securityEvents.some(e => e.event === 'device_linked' && e.userId === 'b' && e.meta.kind === 'qr'))
  assert.doesNotMatch(JSON.stringify(srv.readDb()), new RegExp(link.secret), 'the secret is never stored')
  assert.doesNotMatch(JSON.stringify(srv.readDb()), new RegExp(link.id), 'nor is the link: it lives in memory only')
})

test('three wrong codes end the link; a secret that is not A\'s cannot claim; a disabled account cannot be linked', async () => {
  const link = await start()
  const token = await stepUp(C, keyC, 'device-link')
  for (let i = 0; i < 3; i++) await srv.post('/api/link/approve', { id: link.id, code: link.code === '0000' ? '1111' : '0000' }, C, { 'x-step-up': token })
  assert.equal((await srv.post('/api/link/approve', { id: link.id, code: link.code }, C, { 'x-step-up': token })).status, 410)
  assert.equal((await srv.post('/api/link/claim', { id: link.id, secret: link.secret })).status, 410)

  const link2 = await start()
  assert.equal((await srv.post('/api/link/approve', { id: link2.id, code: link2.code }, C, { 'x-step-up': token })).status, 200)
  assert.equal((await srv.post('/api/link/claim', { id: link2.id, secret: 'stolen-id-only' })).status, 403, 'knowing the id from the QR is not enough')
  // approved, but the account is disabled before A claims: it gets nothing
  assert.equal((await srv.post('/api/admin/user/disable', { id: 'c', disabled: true }, srv.cookieFor('ad'))).status, 200)
  assert.equal((await srv.post('/api/link/claim', { id: link2.id, secret: link2.secret }, '', { 'user-agent': PHONE })).status, 403)
})
