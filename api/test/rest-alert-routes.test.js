import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2j-rest-alerts-'))
const secret = 'r'.repeat(64)
fs.writeFileSync(path.join(dir, 'secret'), secret, { mode: 0o600 })
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [{ id: 'member', name: 'Member' }], creds: [], subs: [], invites: [], recoveries: [] }))
// An OS-assigned free port: a random one can land in a range Windows reserves (e.g. 50798-50897), where listen() fails with EACCES and the server never starts.
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)) }) })
const port = await freePort()
const base = `http://127.0.0.1:${port}`
const apiDir = path.resolve('..', 'api')
const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, env: { ...process.env, PORT: String(port), DATA_DIR: dir, ORIGIN: base, RP_ID: 'localhost' }, stdio: ['ignore', 'ignore', 'inherit'] })

async function waitForApi() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) return }
    catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('isolated API did not start')
}

function cookie(uid = 'member') {
  const payload = `${uid}:${Date.now() + 3600000}:0:passkey:${Date.now()}`
  return `gymsid=${payload}.${crypto.createHmac('sha256', secret).update(payload).digest('base64url')}`
}

async function call(method, route, body, { auth = true, origin = base } = {}) {
  const headers = { origin, 'content-type': 'application/json' }
  if (auth) headers.cookie = cookie()
  const response = await fetch(base + route, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
  return { status: response.status, body: await response.json() }
}

test('Web Push API authenticates, binds subscriptions to a device, validates ownership and persists idempotent alerts', async t => {
  t.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }) })
  await waitForApi()

  assert.equal((await call('POST', '/api/push/subscribe', {}, { auth: false })).status, 401)
  assert.equal((await call('POST', '/api/push/subscribe', {}, { origin: 'https://attacker.example' })).status, 403)
  const key = await (await fetch(base + '/api/push/public-key')).json()
  assert.match(key.key, /^[A-Za-z0-9_-]+$/)
  const subscription = { endpoint: 'https://push.example.test/push/endpoint/token', keys: { p256dh: 'A'.repeat(65), auth: 'B'.repeat(20) } }
  const deviceId = 'device_123456789'
  const registered = await call('POST', '/api/push/subscribe', { subscription, deviceId })
  assert.equal(registered.status, 200)
  assert.match(registered.body.subscriptionId, /^[a-f0-9]{32}$/)
  assert.equal((await call('POST', '/api/push/subscribe', { subscription, deviceId })).body.subscriptionId, registered.body.subscriptionId)

  const startsAt = Date.now() + 120_000
  const alert = { subscriptionId: registered.body.subscriptionId, alertId: 'test_rest_alert_12345', endsAt: startsAt }
  assert.deepEqual(await call('POST', '/api/rest-alert', alert), { status: 200, body: { ok: true, duplicate: false } })
  assert.deepEqual(await call('POST', '/api/rest-alert', alert), { status: 200, body: { ok: true, duplicate: true } })
  assert.equal((await call('POST', '/api/rest-alert', { ...alert, subscriptionId: 'foreign-subscription' })).status, 404)
  assert.equal((await call('POST', '/api/rest-alert', { ...alert, endsAt: Date.now() - 1 })).status, 400)
  assert.equal((await call('POST', '/api/rest-alert/cancel', { subscriptionId: 'foreign-subscription' })).status, 404)
  assert.deepEqual(await call('POST', '/api/rest-alert/cancel', { subscriptionId: registered.body.subscriptionId, alertId: alert.alertId }), { status: 200, body: { ok: true, cancelled: 1 } })

  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'))
  assert.equal(db.subs.length, 1)
  assert.equal(db.subs[0].deviceId, deviceId)
  assert.ok(db.subs[0].createdAt && db.subs[0].lastSeen && db.subs[0].enabled)
  assert.equal(db.restAlerts[0].status, 'cancelled')
  assert.equal(JSON.stringify(db.restAlerts[0]).includes('exercise'), false)
})
