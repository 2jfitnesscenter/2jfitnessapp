import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gym-profile-admin-'))
const SECRET = 'g'.repeat(64), PORT = 34597, base = `http://localhost:${PORT}`
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 })
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [
  { id: 'member', name: 'Member' }, { id: 'trainer', name: 'Trainer', trainer: true }, { id: 'admin', name: 'Admin', admin: true }
], creds: [], subs: [], invites: [], recoveries: [] }))

let child
async function start() {
  let bootOutput = ''
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', chunk => { bootOutput += chunk })
  child.stderr.on('data', chunk => { bootOutput += chunk })
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return } catch { /* waiting for boot */ }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('server child process never became healthy: ' + bootOutput)
}
const cookieFor = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`
}
async function req(method, route, uid, body) {
  const r = await fetch(base + route, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

await start()

test('the public config uses canonical defaults; member and trainer cannot write the gym-wide inventory', async () => {
  const initial = (await req('GET', '/api/config')).body.gymProfile.availableEquipment
  assert.deepEqual(initial, ['bodyweight', 'barbell', 'ez_bar', 'dumbbell', 'kettlebell', 'cable', 'weighted', 'selectorized', 'machine', 'plate_loaded', 'smith', 'sled', 'stability_ball', 'roller', 'treadmill', 'bike', 'elliptical', 'stepmill', 'skierg'])
  const endpoint = '/api/admin/gym-profile/official', body = { availableEquipment: ['bodyweight', 'smith'] }
  assert.equal((await req('POST', endpoint, undefined, body)).status, 401)
  assert.equal((await req('POST', endpoint, 'member', body)).status, 403)
  assert.equal((await req('POST', endpoint, 'trainer', body)).status, 403)
  assert.equal(fs.existsSync(path.join(dir, 'gym-profile.json')), false)
})

test('admin changes persist in one global file and are read by every client after server restart', async () => {
  const endpoint = '/api/admin/gym-profile/official'
  assert.equal((await req('POST', endpoint, 'admin', { availableEquipment: ['bodyweight', 'smith'] })).status, 200)
  assert.deepEqual((await req('GET', '/api/config', 'member')).body.gymProfile.availableEquipment, ['bodyweight', 'smith'])
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'gym-profile.json'), 'utf8')), { v: 1, availableEquipment: ['bodyweight', 'smith'] })
  assert.equal((await req('POST', endpoint, 'admin', { availableEquipment: ['invented'] })).status, 400)
  assert.deepEqual((await req('GET', '/api/config')).body.gymProfile.availableEquipment, ['bodyweight', 'smith'])
  const stopped = new Promise(resolve => child.once('exit', resolve))
  child.kill(); await stopped; await start()
  assert.deepEqual((await req('GET', '/api/config')).body.gymProfile.availableEquipment, ['bodyweight', 'smith'])
})

after(() => { child?.kill() })
