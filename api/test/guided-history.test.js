// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { bootServer } from './webauthn-helper.mjs'

/* Official catalogue history: the version an admin replaces is kept (ten per item, only real content changes, no merchandising), can be listed
 * by admins only, and is put back through the normal validated save path. */
const srv = await bootServer({
  port: 34814,
  db: { users: [{ id: 'm1', name: 'Member' }, { id: 't1', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Admin', admin: true }], creds: [] },
})
after(() => srv.stop())
const SEED = JSON.parse(fs.readFileSync(path.resolve('lib/guided-official.json'), 'utf8'))
const call = async (method, route, uid, body) => { const r = await (method === 'GET' ? srv.get(route, uid && srv.cookieFor(uid)) : srv.post(route, body, uid && srv.cookieFor(uid))); let j = null; try { j = await r.json() } catch { /* empty */ } return { status: r.status, body: j } }
const master = SEED.routines.find(r => r.id === 'r2j-core-start')
const save = (description, extra = {}) => call('POST', '/api/guided/save', 'ad', { routine: { ...master, scope: 'official', description, ...extra } })
const versions = async id => (await call('GET', '/api/guided/history?id=' + id, 'ad')).body.versions
const live = async id => (await call('GET', '/api/guided', 'ad')).body.routines.find(r => r.id === id)

test('a content edit keeps the version it replaced; an unchanged re-save, and curation, keep nothing', async () => {
  assert.deepEqual(await versions(master.id), [])
  assert.equal((await save(master.description)).status, 200)                       // saved as it is: nothing changed
  assert.deepEqual(await versions(master.id), [])
  assert.equal((await save('First edit')).status, 200)
  const first = await versions(master.id)
  assert.equal(first.length, 1)
  assert.equal(first[0].kind, 'routine'); assert.equal(first[0].name, master.name); assert.equal(first[0].exercises, master.ex.length); assert.ok(first[0].at && first[0].by === 'ad')
  assert.equal((await call('POST', '/api/guided/curate', 'ad', { id: master.id, featured: 5, badge: 'new', order: 7 })).status, 200)
  assert.equal((await versions(master.id)).length, 1, 'featured / badge / order are merchandising, not content')
  assert.equal((await save('Second edit')).status, 200)
  assert.equal((await versions(master.id)).length, 2)
})

test('restoring a version puts the content back and keeps the version it replaced', async () => {
  const [newest, oldest] = await versions(master.id)
  assert.equal((await live(master.id)).description, 'Second edit')
  const res = await call('POST', '/api/guided/restore', 'ad', { id: master.id, at: oldest.at })
  assert.equal(res.status, 200)
  assert.equal((await live(master.id)).description, master.description)
  const after = await versions(master.id)
  assert.equal(after.length, 3, 'the "Second edit" version is itself kept')
  assert.equal((await call('POST', '/api/guided/restore', 'ad', { id: master.id, at: newest.at })).status, 200)
  assert.equal((await live(master.id)).description, 'First edit')
  assert.equal((await call('POST', '/api/guided/restore', 'ad', { id: master.id, at: 'no-such-version' })).status, 404)
})

test('only admins read or restore history; members and trainers are refused', async () => {
  for (const uid of ['m1', 't1']) {
    assert.equal((await call('GET', '/api/guided/history?id=' + master.id, uid)).status, 403)
    assert.equal((await call('POST', '/api/guided/restore', uid, { id: master.id, at: 'x' })).status, 403)
  }
  assert.equal((await call('GET', '/api/guided/history?id=' + master.id)).status, 401)
  const member = JSON.stringify((await call('GET', '/api/guided', 'm1')).body)
  assert.ok(!/snapshot|"history"|"versions"/.test(member), 'a member never receives the history')
})

test('a hidden/active switch is a version; only the last ten are kept; the seed file is never touched', async () => {
  const id = 'r2j-core-start'
  for (let i = 0; i < 12; i++) assert.equal((await save('Edit ' + i)).status, 200)
  assert.equal((await versions(id)).length, 10)
  const before = (await versions(id)).length
  assert.equal((await call('POST', '/api/guided/status', 'ad', { id, status: 'hidden' })).status, 200)
  const withStatus = await versions(id)
  assert.equal(withStatus.length, 10); assert.equal(withStatus[0].status, 'active', 'the version kept is the one that was live')
  assert.equal((await call('POST', '/api/guided/status', 'ad', { id, status: 'active' })).status, 200)
  assert.ok(before === 10)
  assert.equal(fs.readFileSync(path.resolve('lib/guided-official.json'), 'utf8'), JSON.stringify(SEED, null, 1) + '\n')
})

test('programs and collections keep versions too; deleting a custom item forgets its history', async () => {
  const prog = (await call('GET', '/api/guided', 'ad')).body.programs[0]
  assert.equal((await call('POST', '/api/guided/program/curate', 'ad', { id: prog.id, description: 'Edited description' })).status, 200)
  const pv = await versions(prog.id)
  assert.equal(pv.length, 1); assert.equal(pv[0].kind, 'program'); assert.ok(pv[0].weeks > 0)
  assert.equal((await call('POST', '/api/guided/restore', 'ad', { id: prog.id, at: pv[0].at })).status, 200)
  assert.equal((await live2(prog.id)).description, prog.description)

  const made = await call('POST', '/api/guided/collection', 'ad', { collection: { name: 'Mine', description: 'a', style: 'hiit', order: 1, routineIds: [master.id] } })
  const coll = made.body.collections.find(c => c.name === 'Mine')
  await call('POST', '/api/guided/collection', 'ad', { collection: { ...coll, name: 'Mine v2' } })
  const cv = await versions(coll.id)
  assert.equal(cv.length, 1); assert.equal(cv[0].kind, 'collection'); assert.equal(cv[0].name, 'Mine')
  assert.equal((await call('POST', '/api/guided/restore', 'ad', { id: coll.id, at: cv[0].at })).status, 200)
  assert.equal((await call('GET', '/api/guided', 'ad')).body.collections.find(c => c.id === coll.id).name, 'Mine')
  assert.equal((await call('POST', '/api/guided/collection/delete', 'ad', { id: coll.id })).status, 200)
  assert.deepEqual(await versions(coll.id), [])
})
async function live2(id) { return (await call('GET', '/api/guided', 'ad')).body.programs.find(p => p.id === id) }
