// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Authenticator, bootServer } from './webauthn-helper.mjs'

/* Recovery and the security log. A recovery link exists because a device or a passkey was lost, so completing it must end every earlier
 * session and (by default) remove every earlier passkey, leaving the new one as a way in — never an account without one. */
const oldKey = new Authenticator(), adminKey = new Authenticator(), keptKey = new Authenticator(), newKey1 = new Authenticator(), newKey2 = new Authenticator(), newKey3 = new Authenticator()
const srv = await bootServer({
  port: 34811,
  env: { ADMIN_UIDS: 'admin1' },
  db: {
    users: [{ id: 'admin1', name: 'Admin One' }, { id: 'u1', name: 'Lucia Perez' }, { id: 'u2', name: 'Pablo Gil' }, { id: 'u3', name: 'Marta Ruiz' }, { id: 'u4', name: 'Legacy Link' }],
    creds: [adminKey.record('admin1'), oldKey.record('u1'), keptKey.record('u2'), new Authenticator().record('u3'), new Authenticator().record('u4')],
    recoveries: [{ token: 'LEGACYTOKEN00001', userId: 'u4', createdBy: 'admin1', created: new Date().toISOString(), expiresAt: Date.now() + 600000 }],   // a link made before the revokeOld flag existed
  },
})
after(() => srv.stop())
const admin = srv.cookieFor('admin1')

const loginWith = async key => {
  const o = await (await srv.post('/api/login/options', {})).json()
  return srv.post('/api/login/verify', { cid: o.cid, credential: key.assertion(o.options.challenge, { origin: srv.origin }) })
}
const recoverWith = async (token, key) => {
  const o = await srv.post('/api/recover/options', { token })
  if (o.status !== 200) return o
  const data = await o.json()
  return srv.post('/api/recover/verify', { cid: data.cid, credential: key.registration(data.options.challenge, { origin: srv.origin }) })
}
const cookieOf = res => res.headers.get('set-cookie').split(';')[0]
const eventsOf = async cookie => (await (await srv.get('/api/me/security-events', cookie)).json()).events

test('a successful sign-in is logged with whether the authenticator verified the person, and a bad signature is logged as a failure', async () => {
  const ok = await loginWith(oldKey)
  assert.equal(ok.status, 200)
  const cookie = cookieOf(ok)
  const events = await eventsOf(cookie)
  assert.deepEqual(events.find(e => e.event === 'login_ok').meta, { uv: true })

  const impostor = new Authenticator({ id: oldKey.id })           // same credential id, different private key: the signature cannot verify
  const bad = await loginWith(impostor)
  assert.equal(bad.status, 400)
  assert.ok((await eventsOf(cookie)).some(e => e.event === 'login_failed'))
  const text = JSON.stringify(srv.readDb().securityEvents)
  assert.doesNotMatch(text, /publicKey|signature|clientData|authenticatorData|user-agent/i)
})

test('completing a recovery ends every earlier session, removes the earlier passkeys and leaves the new one working', async () => {
  const before = cookieOf(await loginWith(oldKey))
  assert.equal((await srv.get('/api/me', before)).status, 200)

  const link = await srv.post('/api/admin/user/recovery-link', { id: 'u1' }, admin)
  assert.equal(link.status, 200)
  const { token, revokesOldPasskeys } = await link.json()
  assert.equal(revokesOldPasskeys, true)

  const done = await recoverWith(token, newKey1)
  assert.equal(done.status, 200)
  const body = await done.json()
  assert.equal(body.recovery.revokedPasskeys, 1)
  const after1 = cookieOf(done)
  assert.equal((await srv.get('/api/me', after1)).status, 200, 'the session issued by the recovery itself works')
  assert.equal((await srv.get('/api/me', before)).status, 401, 'a session from before the recovery is dead')

  assert.deepEqual(srv.readDb().creds.filter(c => c.userId === 'u1').map(c => c.id), [newKey1.id])
  assert.equal((await loginWith(oldKey)).status, 404, 'the old passkey no longer signs in')
  assert.equal((await loginWith(newKey1)).status, 200)

  const events = await eventsOf(after1)
  const completed = events.find(e => e.event === 'recovery_completed')
  assert.deepEqual(completed.meta, { revokedPasskeys: 1, kept: false, sessionsEnded: true })
  assert.equal(completed.byOther, true)
  assert.ok(!JSON.stringify(events).includes(token))
  assert.ok(srv.readDb().recoveries.find(r => r.token === token).usedAt)
  assert.equal((await recoverWith(token, newKey3)).status, 400, 'the link works once')
})

test('keepExisting leaves the earlier passkeys in place but still ends every session', async () => {
  const before = cookieOf(await loginWith(keptKey))
  const { token, revokesOldPasskeys } = await (await srv.post('/api/admin/user/recovery-link', { id: 'u2', keepExisting: true }, admin)).json()
  assert.equal(revokesOldPasskeys, false)
  const done = await recoverWith(token, newKey2)
  assert.equal(done.status, 200)
  assert.equal((await done.json()).recovery.revokedPasskeys, 0)
  assert.equal((await srv.get('/api/me', before)).status, 401)
  assert.equal((await loginWith(keptKey)).status, 200)
  assert.equal((await loginWith(newKey2)).status, 200)
  assert.equal(srv.readDb().creds.filter(c => c.userId === 'u2').length, 2)
})

test('a link created before the flag existed is treated as the safe default: earlier passkeys are removed', async () => {
  const newKey = new Authenticator()
  const done = await recoverWith('LEGACYTOKEN00001', newKey)
  assert.equal(done.status, 200)
  assert.deepEqual(srv.readDb().creds.filter(c => c.userId === 'u4').map(c => c.id), [newKey.id])
})

test('a recovery request, a role change and "sign out everywhere" are all logged, and the log shows a member only their own', async () => {
  assert.equal((await srv.post('/api/recover/request', { name: 'Marta Ruiz' })).status, 200)
  assert.equal((await srv.post('/api/admin/user/role', { id: 'u3', role: 'trainer' }, admin)).status, 200)
  const u3 = srv.cookieFor('u3')
  assert.equal((await srv.post('/api/logout/all', {}, u3)).status, 200)
  const kinds = (srv.readDb().securityEvents || []).filter(e => e.userId === 'u3').map(e => e.event)
  assert.deepEqual(kinds, ['recovery_requested', 'role_changed', 'logout_all'])
  const role = srv.readDb().securityEvents.find(e => e.event === 'role_changed')
  assert.deepEqual(role.meta, { from: 'member', to: 'trainer' }); assert.equal(role.actorId, 'admin1')

  const mine = await eventsOf(srv.cookieFor('u3', { version: 1 }))
  assert.ok(mine.every(e => !('userId' in e) && !('actorId' in e)))
  assert.ok(mine.find(e => e.event === 'role_changed').byOther)
  assert.equal((await srv.get('/api/me/security-events')).status, 401)
  assert.equal((await srv.get('/api/admin/security-events', srv.cookieFor('u2', { version: 1 }))).status, 403)
  const adminView = await (await srv.get('/api/admin/security-events?userId=u3', admin)).json()
  assert.ok(adminView.events.length >= 3 && adminView.events.every(e => e.userId === 'u3' || e.actorId === 'u3'))
  assert.equal(adminView.events.find(e => e.event === 'role_changed').actorName, 'Admin One')
})
