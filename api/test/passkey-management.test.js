// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { Authenticator, bootServer } from './webauthn-helper.mjs'

/* "Your passkeys": list, add another from a signed-in session, rename, remove. Adding and removing need a fresh step-up; the last
 * passkey can never be removed; everything is scoped to the signed-in person; credentials made before the metadata existed keep working. */
const legacyKey = new Authenticator(), bKey = new Authenticator()
const fullKeys = Array.from({ length: 10 }, () => new Authenticator())
const srv = await bootServer({
  port: 34812,
  db: {
    users: [{ id: 'a', name: 'Ana Lopez' }, { id: 'b', name: 'Bruno Diaz' }, { id: 'c', name: 'Carla Full' }],
    creds: [legacyKey.record('a'), bKey.record('b'), ...fullKeys.map(k => k.record('c', { name: 'k', createdAt: '2026-01-01T00:00:00.000Z' }))],
  },
})
after(() => srv.stop())
const A = srv.cookieFor('a'), B = srv.cookieFor('b'), C = srv.cookieFor('c')
const handleOf = async cookie => (await (await srv.get('/api/me/passkeys', cookie)).json()).passkeys

async function stepUp(cookie, key, purpose = 'passkeys') {
  const o = await (await srv.post('/api/me/step-up/options', {}, cookie)).json()
  const res = await srv.post('/api/me/step-up', { cid: o.cid, purpose, credential: key.assertion(o.options.challenge, { origin: srv.origin }) }, cookie)
  assert.equal(res.status, 200, await res.clone().text())
  return (await res.json()).token
}
async function addPasskey(cookie, token, key, name) {
  const o = await srv.post('/api/me/passkeys/options', {}, cookie, { 'x-step-up': token })
  if (o.status !== 200) return o
  const data = await o.json()
  return srv.post('/api/me/passkeys/verify', { cid: data.cid, name, credential: key.registration(data.options.challenge, { origin: srv.origin }) }, cookie, { 'x-step-up': token })
}

test('the list shows what each passkey is without exposing the credential; a legacy passkey (no metadata) still works and still shows up', async () => {
  assert.equal((await srv.get('/api/me/passkeys')).status, 401)
  const res = await srv.get('/api/me/passkeys', A)
  const body = await res.json()
  assert.equal(body.passkeys.length, 1)
  assert.deepEqual(body.passkeys[0], { id: body.passkeys[0].id, name: null, createdAt: null, lastUsedAt: null, transports: ['internal'], legacy: true })
  const text = JSON.stringify(body)
  assert.ok(!text.includes(legacyKey.id) && !/publicKey|counter/i.test(text))
  // the legacy credential signs in, and from then on has a last-use time
  const o = await (await srv.post('/api/login/options', {})).json()
  assert.equal((await srv.post('/api/login/verify', { cid: o.cid, credential: legacyKey.assertion(o.options.challenge, { origin: srv.origin }) })).status, 200)
  const after = (await handleOf(A))[0]
  assert.ok(after.lastUsedAt); assert.equal(after.legacy, true)
})

test('adding a passkey needs a fresh step-up, then works from a normal session with no admin', async () => {
  assert.equal((await srv.post('/api/me/passkeys/options', {}, A)).status, 403)
  assert.equal((await (await srv.post('/api/me/passkeys/options', {}, A)).json()).code, 'step_up_required')
  assert.equal((await srv.post('/api/me/passkeys/options', {}, A, { 'x-step-up': 'garbage.token' })).status, 403)

  const token = await stepUp(A, legacyKey)
  const newKey = new Authenticator()
  const added = await addPasskey(A, token, newKey, '  Mi <b>portátil</b>  ')
  assert.equal(added.status, 200)
  const view = (await added.json()).passkey
  assert.equal(view.name, 'Mi bportátil/b'); assert.ok(view.createdAt); assert.equal(view.legacy, false)
  const list = await handleOf(A)
  assert.equal(list.length, 2)
  assert.equal(srv.readDb().creds.filter(c => c.userId === 'a').length, 2)
  // the new passkey signs in
  const o = await (await srv.post('/api/login/options', {})).json()
  assert.equal((await srv.post('/api/login/verify', { cid: o.cid, credential: newKey.assertion(o.options.challenge, { origin: srv.origin }) })).status, 200)
  assert.ok(srv.readDb().securityEvents.some(e => e.event === 'passkey_added' && e.userId === 'a' && e.meta.handle === view.id))
  // registering the same credential again is refused
  assert.equal((await addPasskey(A, await stepUp(A, legacyKey), newKey)).status, 409)
})

test('a step-up token belongs to one person and one purpose; a challenge cannot be replayed', async () => {
  const tokenA = await stepUp(A, legacyKey)
  assert.equal((await srv.post('/api/me/passkeys/options', {}, B, { 'x-step-up': tokenA })).status, 403, 'another person cannot use it')
  const linkToken = await stepUp(A, legacyKey, 'device-link')
  assert.equal((await srv.post('/api/me/passkeys/options', {}, A, { 'x-step-up': linkToken })).status, 403, 'a token for another purpose does not unlock passkeys')
  const cut = tokenA.lastIndexOf('.'), forged = tokenA.slice(0, cut).replace('passkeys', 'device-link') + tokenA.slice(cut)   // the signature no longer matches
  assert.equal((await srv.post('/api/me/passkeys/options', {}, A, { 'x-step-up': forged })).status, 403)
  // an assertion made for somebody else's challenge / twice is not accepted
  const o = await (await srv.post('/api/me/step-up/options', {}, A)).json()
  const cred = legacyKey.assertion(o.options.challenge, { origin: srv.origin })
  assert.equal((await srv.post('/api/me/step-up', { cid: o.cid, credential: cred }, A)).status, 200)
  assert.equal((await srv.post('/api/me/step-up', { cid: o.cid, credential: cred }, A)).status, 400, 'replay')
  const o2 = await (await srv.post('/api/me/step-up/options', {}, A)).json()
  assert.equal((await srv.post('/api/me/step-up', { cid: o2.cid, credential: bKey.assertion(o2.options.challenge, { origin: srv.origin }) }, A)).status, 403, "somebody else's passkey proves nothing")
})

test('rename keeps to the owner and to a clean name', async () => {
  const mine = await handleOf(A)
  const target = mine.find(p => p.legacy)
  assert.equal((await srv.post('/api/me/passkeys/rename', { id: target.id, name: 'Móvil de Ana' }, A)).status, 200)
  assert.equal((await handleOf(A)).find(p => p.id === target.id).name, 'Móvil de Ana')
  assert.equal((await srv.post('/api/me/passkeys/rename', { id: target.id, name: '   ' }, A)).status, 400)
  assert.equal((await srv.post('/api/me/passkeys/rename', { id: target.id, name: 'Nope' }, B)).status, 404, 'another account cannot even tell it exists')
  assert.equal((await srv.post('/api/me/passkeys/rename', { id: 'zzzz', name: 'Nope' }, A)).status, 404)
  assert.ok(srv.readDb().securityEvents.some(e => e.event === 'passkey_renamed' && e.userId === 'a'))
})

test('removing a passkey needs a step-up, stays inside the account, and never removes the last one', async () => {
  const mine = await handleOf(A)
  assert.equal(mine.length, 2)
  assert.equal((await srv.post('/api/me/passkeys/revoke', { id: mine[0].id }, A)).status, 403)
  const token = await stepUp(A, legacyKey)
  assert.equal((await srv.post('/api/me/passkeys/revoke', { id: mine[0].id }, B, { 'x-step-up': await stepUp(B, bKey) })).status, 404, "never somebody else's")
  const gone = await srv.post('/api/me/passkeys/revoke', { id: mine[0].id }, A, { 'x-step-up': token })   // the legacy one
  assert.equal(gone.status, 200)
  assert.equal((await gone.json()).passkeys.length, 1)
  assert.equal(srv.readDb().creds.filter(c => c.userId === 'a').length, 1)
  const o = await (await srv.post('/api/login/options', {})).json()
  assert.equal((await srv.post('/api/login/verify', { cid: o.cid, credential: legacyKey.assertion(o.options.challenge, { origin: srv.origin }) })).status, 404, 'the removed passkey no longer signs in')
  // the one left is protected, even though we could not sign in to ask with the removed one
  const left = (await handleOf(A))[0]
  const keyLeft = srv.readDb().creds.find(c => c.userId === 'a')
  assert.ok(keyLeft)
  const last = await srv.post('/api/me/passkeys/revoke', { id: left.id }, A, { 'x-step-up': token })
  assert.equal(last.status, 409); assert.equal((await last.json()).code, 'last_passkey')
  assert.ok(srv.readDb().securityEvents.some(e => e.event === 'passkey_revoked' && e.userId === 'a'))
  assert.doesNotMatch(JSON.stringify(srv.readDb().securityEvents), new RegExp(legacyKey.id))
})

test('an account cannot hold more than ten passkeys', async () => {
  const token = await stepUp(C, fullKeys[0])
  const res = await srv.post('/api/me/passkeys/options', {}, C, { 'x-step-up': token })
  assert.equal(res.status, 409); assert.equal((await res.json()).code, 'passkey_limit')
})
