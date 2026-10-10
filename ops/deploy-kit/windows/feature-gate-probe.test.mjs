import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderTemplate, validateConfig } from './generate-release-runner.mjs'

/* A route the admin can switch off answers 401 to an anonymous caller while its feature is on, and 403 {"code":"feature_off"} while it is off: both are "closed".
 * This runs the REAL wait_status / http_probe from the template in bash against a local server and checks what is accepted and what is not. */
const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8').replace(/\r\n/g, '\n')
const lib = template.slice(template.indexOf('http_probe() {'), template.indexOf('wait_services() {'))
assert.ok(lib.includes('wait_status()') && lib.includes('http_probe_for_retry()'))
const BASH = ['bash'].find(b => spawnSync(b, ['-c', 'echo ok'], { encoding: 'utf8' }).stdout?.trim() === 'ok')

const ROUTES = {
  '/active': [401, { error: 'no has iniciado sesión' }],
  '/off': [403, { error: 'esta función está desactivada por el gimnasio', code: 'feature_off' }],
  '/forbidden': [403, { error: 'prohibido' }],
  '/other-code': [403, { error: 'x', code: 'passkey_required' }],
  '/ok': [200, { ok: true }],
  '/missing': [404, { error: 'no encontrado' }],
  '/moved': [302, {}],
  '/boom': [500, { error: 'error del servidor' }],
}
let server, port
test.before(async () => {
  server = http.createServer((req, res) => { const [code, body] = ROUTES[req.url.split('?')[0]] || [404, {}]; res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)) })
  await new Promise(r => server.listen(0, '127.0.0.1', r)); port = server.address().port
})
test.after(() => server.close())

async function probe(route, { gate = '', method = 'GET' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'))
  const script = `${lib}\nRETRY_INTERVAL_SEC=1\nstatus=$(wait_status 401 'http://127.0.0.1:${port}${route}' '${dir.replace(/\\/g, '/')}/b' '${dir.replace(/\\/g, '/')}/h' 4 '' ${method} '' ${gate})\ncode=$?\nprintf 'STATUS=%s EXIT=%s' "$status" "$code"`
  const r = await run(script)
  return { status: /STATUS=(\d+)/.exec(r)?.[1], exit: Number(/EXIT=(\d+)/.exec(r)?.[1]), raw: r }
}
// async: the server lives in this process, so a synchronous spawn would starve it
const run = script => new Promise(resolve => { let out = ''; const c = spawn(BASH, ['-c', script]); c.stdout.on('data', d => { out += d }); c.on('close', () => resolve(out)) })

test('bash is available for the tooling test', () => assert.ok(BASH))

test('1. feature on, no session: 401 is valid, gated or not', async () => {
  const gated = await probe('/active', { gate: 'feature_off' })
  assert.deepEqual([gated.exit, (await probe('/active')).exit], [0, 0]); assert.equal(gated.status, '401')
})
test('2. feature off: 403 with code feature_off is valid for a gated route only', async () => {
  const gated = await probe('/off', { gate: 'feature_off' })
  assert.equal(gated.exit, 0); assert.equal(gated.status, '403')
  assert.notEqual((await probe('/off')).exit, 0, 'an ungated route must not accept it')
})
test('3. a 403 for any other reason is rejected, even on a gated route', async () => {
  assert.notEqual((await probe('/forbidden', { gate: 'feature_off' })).exit, 0)
  assert.notEqual((await probe('/other-code', { gate: 'feature_off' })).exit, 0)
})
test('4. 200, redirects and unexpected 404 are rejected', async () => {
  for (const route of ['/ok', '/moved', '/missing']) assert.notEqual((await probe(route, { gate: 'feature_off' })).exit, 0, route)
})
test('5. a 5xx is rejected', async () => assert.notEqual((await probe('/boom', { gate: 'feature_off' })).exit, 0))

test('the generator emits the gate only for routes marked featureGate, and refuses a gate on anything but an unauthenticated 401', () => {
  const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/training-quality-review.json'), 'utf8'))
  const gated = ['/api/social/goals', '/api/chat/messages', '/api/social/shares/item'].map(p => ({ method: 'GET', path: p, status: 401, expectUnauthenticated: true, featureGate: true }))
  const m = { ...base, probes: { ...base.probes, unauthenticatedRoutes: [...base.probes.unauthenticatedRoutes, ...gated, { method: 'GET', path: '/api/admin/social-reports', status: 401, expectUnauthenticated: true }] } }
  const rendered = renderTemplate(template, m)
  for (const p of ['/api/social/goals', '/api/chat/messages', '/api/social/shares/item']) assert.ok(new RegExp(`wait_status 401 'https://app\\.2jfitnesscenter\\.com${p}' \\S+ \\S+ 45 '' GET '' feature_off\\)`).test(rendered), p)
  assert.equal(/admin\/social-reports'[^\n]*feature_off/.test(rendered), false, 'a route no switch covers stays strictly 401')
  const bad = (over) => ({ ...m, probes: { ...m.probes, unauthenticatedRoutes: [...m.probes.unauthenticatedRoutes, { method: 'GET', path: '/api/x', ...over }] } })
  assert.throws(() => validateConfig(bad({ status: 200, featureGate: true })), /INVALID_FEATURE_GATE_ROUTE/)
  assert.throws(() => validateConfig(bad({ status: 401, expectUnauthenticated: true, featureGate: 'yes' })), /INVALID_FEATURE_GATE_ROUTE/)
})

test('every hard-coded smoke line for a switchable route (social, friends, chat) carries the gate; the always-on ones do not', () => {
  const lines = template.split('\n').filter(l => /^\w+_STATUS=\$\(wait_status 401 https:\/\/app\.2jfitnesscenter\.com\/api\/(social|friends|chat|notifications)/.test(l))
  assert.ok(lines.length >= 12)
  for (const l of lines) {
    const gated = /\/api\/(social\/(wall|shares|reports)|friends|chat\/(threads|direct))/.test(l)
    assert.equal(l.includes('feature_off'), gated, l.slice(0, 70))
  }
})
