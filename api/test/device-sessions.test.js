// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Authenticator, bootServer } from './webauthn-helper.mjs'

/* "Your devices": every passkey sign-in gets a session record (platform, created, last use, state) and a cookie that names it, so one session can be
 * ended on its own. Nothing like an IP address or a raw user-agent is kept. Older cookies without a record keep working. */
const keyA1 = new Authenticator(), keyA2 = new Authenticator(), keyB = new Authenticator(), keyP = new Authenticator()
const PHONE = 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36'
const LAPTOP = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.61'
const old = i => ({ id: 'seed' + i, userId: 'p', platform: 'Linux', via: 'passkey', createdAt: new Date(Date.now() - (100 - i) * 3600000).toISOString(), lastUsedAt: new Date(Date.now() - (100 - i) * 3600000).toISOString(), expiresAt: Date.now() + 80 * 86400000 })
const srv = await bootServer({
  port: 34813,
  db: {
    users: [{ id: 'a', name: 'Ana' }, { id: 'b', name: 'Bruno' }, { id: 'p', name: 'Pru' }],
    creds: [keyA1.record('a'), keyA2.record('a'), keyB.record('b'), keyP.record('p')],
    deviceSessions: Array.from({ length: 25 }, (_, i) => old(i)),
  },
})
after(() => srv.stop())

async function login(key, ua = PHONE) {
  const o = await (await srv.post('/api/login/options', {}, '', { 'user-agent': ua })).json()
  const res = await srv.post('/api/login/verify', { cid: o.cid, credential: key.assertion(o.options.challenge, { origin: srv.origin }) }, '', { 'user-agent': ua })
  assert.equal(res.status, 200)
  return res.headers.get('set-cookie').split(';')[0]
}
const sessions = async cookie => (await (await srv.get('/api/me/sessions', cookie)).json())

test('a sign-in creates a session record labelled by platform and browser, and the cookie names it', async () => {
  const cookie = await login(keyA1, PHONE)
  assert.match(cookie, /^gymsid=a:\d+:0:passkey:\d+:[A-Za-z0-9_-]+\./)
  const body = await sessions(cookie)
  assert.equal(body.sessions.length, 1); assert.equal(body.thisSessionListed, true)
  assert.deepEqual(Object.keys(body.sessions[0]).sort(), ['createdAt', 'current', 'id', 'lastUsedAt', 'platform', 'via'])
  assert.equal(body.sessions[0].platform, 'Android · Chrome'); assert.equal(body.sessions[0].current, true)
  const stored = JSON.stringify(srv.readDb().deviceSessions)
  assert.doesNotMatch(stored, /Pixel|AppleWebKit|127\.0\.0\.1|::1|Mozilla/)
  assert.equal((await srv.get('/api/me/sessions')).status, 401)
})

test('two devices are two sessions; ending one ends only that one, and only the owner can', async () => {
  const phone = await login(keyA1, PHONE)
  const laptop = await login(keyA2, LAPTOP)
  const list = (await sessions(laptop)).sessions
  assert.deepEqual(list.map(s => s.platform).sort(), ['Android · Chrome', 'Android · Chrome', 'Windows · Edge'].sort())
  const phoneRecord = list.find(s => !s.current && s.platform.startsWith('Android'))
  const bCookie = await login(keyB, PHONE)
  assert.equal((await srv.post('/api/me/sessions/revoke', { id: phoneRecord.id }, bCookie)).status, 404, 'somebody else cannot end it, or even see it')
  assert.equal((await srv.post('/api/me/sessions/revoke', { id: 'nope' }, laptop)).status, 404)

  const ended = await srv.post('/api/me/sessions/revoke', { id: phoneRecord.id }, laptop)
  assert.equal(ended.status, 200); assert.equal((await ended.json()).current, false)
  assert.equal((await srv.get('/api/me', laptop)).status, 200, 'the other session is untouched')
  const survivors = (await sessions(laptop)).sessions
  assert.ok(!survivors.some(s => s.id === phoneRecord.id))
  assert.ok(srv.readDb().securityEvents.some(e => e.event === 'session_revoked' && e.userId === 'a'))
  void phone
})

test('ending the current session signs this browser out; a normal sign-out ends its record too', async () => {
  const c1 = await login(keyA1, LAPTOP)
  const me = (await sessions(c1)).sessions.find(s => s.current)
  const res = await srv.post('/api/me/sessions/revoke', { id: me.id }, c1)
  assert.equal((await res.json()).current, true)
  assert.match(res.headers.get('set-cookie'), /Max-Age=0/)
  assert.equal((await srv.get('/api/me', c1)).status, 401)

  const c2 = await login(keyA1, LAPTOP)
  const id2 = (await sessions(c2)).sessions.find(s => s.current).id
  assert.equal((await srv.post('/api/logout', {}, c2)).status, 200)
  assert.equal((await srv.get('/api/me', c2)).status, 401, 'the record is gone even for a copy of the cookie')
  assert.ok(srv.readDb().deviceSessions.find(s => s.id === id2).revokedAt)
})

test('"sign out everywhere" ends every record, and a forged or unknown session id is refused', async () => {
  const x = await login(keyA1), y = await login(keyA2, LAPTOP)
  assert.equal((await srv.post('/api/logout/all', {}, x)).status, 200)
  assert.equal((await srv.get('/api/me', y)).status, 401)
  assert.ok(srv.readDb().deviceSessions.filter(s => s.userId === 'a').every(s => s.revokedAt))
  const forged = srv.cookieFor('a', { version: 1, extra: ['passkey', Date.now(), 'nosuchsession'] })
  assert.equal((await srv.get('/api/me', forged)).status, 401)
  const other = await login(keyB)
  const sid = other.split(':').pop().split('.')[0]
  const stolen = srv.cookieFor('a', { version: srv.readDb().users.find(u => u.id === 'a').sv, extra: ['passkey', Date.now(), sid] })
  assert.equal((await srv.get('/api/me', stolen)).status, 401, "a session id of somebody else's never authenticates this account")
})

test('a cookie from before sessions had records keeps working and is reported as unlisted', async () => {
  const legacy = srv.cookieFor('b', { version: 0 })
  assert.equal((await srv.get('/api/me', legacy)).status, 200)
  const body = await sessions(legacy)
  assert.equal(body.thisSessionListed, false)
  assert.ok(!body.sessions.some(s => s.current))
})

test('removing a passkey ends the sessions it created and leaves the others', async () => {
  const s1 = await login(keyA1, PHONE), s2 = await login(keyA2, LAPTOP)
  const o = await (await srv.post('/api/me/step-up/options', {}, s2)).json()
  const su = await (await srv.post('/api/me/step-up', { cid: o.cid, credential: keyA2.assertion(o.options.challenge, { origin: srv.origin }) }, s2)).json()
  const list = await (await srv.get('/api/me/passkeys', s2)).json()
  const first = srv.readDb().creds.filter(c => c.userId === 'a')
  const handleOfKey1 = list.passkeys.find((_, i) => first[i].id === keyA1.id).id
  const res = await srv.post('/api/me/passkeys/revoke', { id: handleOfKey1 }, s2, { 'x-step-up': su.token })
  assert.equal(res.status, 200)
  assert.ok((await res.json()).endedSessions >= 1)
  assert.equal((await srv.get('/api/me', s1)).status, 401, 'the session made with the removed passkey is gone')
  assert.equal((await srv.get('/api/me', s2)).status, 200)
})

test('one person never keeps more than 25 live sessions: the least recently used are ended first', async () => {
  const first = srv.readDb().deviceSessions.filter(s => s.userId === 'p' && !s.revokedAt)
  assert.equal(first.length, 25)
  const cookie = await login(keyP)
  const live = (await sessions(cookie)).sessions
  assert.equal(live.length, 25)
  assert.ok(live.some(s => s.current))
  const ended = srv.readDb().deviceSessions.filter(s => s.userId === 'p' && s.revokedAt).map(s => s.id); assert.deepEqual(ended, ['seed0'], 'exactly the least recently used one was ended')
})
