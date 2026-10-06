import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { hashStaffPin, verifyStaffPin, validateStaffPin, createPinLimiter } from '../lib/shared-staff.js'

const SECRET = 'f'.repeat(64)
const port = 34791
const base = `http://localhost:${port}`
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shared-staff-'))
fs.writeFileSync(path.join(dataDir, 'secret'), SECRET, { mode: 0o600 })
const pinHash = await hashStaffPin('739462')
const keyPair = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
const credentialId = Buffer.from('admin-passkey-test').toString('base64url')
function cborPublicKey(jwk) {
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url')
  return Buffer.concat([Buffer.from([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]), x, Buffer.from([0x22, 0x58, 0x20]), y])
}
const users = [
  { id: 'admin1', name: 'Admin One', email: 'admin-private@example.test' },
  { id: 'trainer1', name: 'Trainer One', trainer: true, email: 'trainer-private@example.test', avatar: 'private-avatar' },
  { id: 'member1', name: 'Member One', email: 'member-private@example.test' },
  { id: 'member2', name: 'Member Two' }
]
const deviceToken = crypto.randomBytes(32).toString('base64url')
const deviceHash = crypto.createHash('sha256').update(deviceToken).digest('hex')
const secondDeviceToken = crypto.randomBytes(32).toString('base64url')
const secondDeviceHash = crypto.createHash('sha256').update(secondDeviceToken).digest('hex')
fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify({
  users, creds: [{ id: credentialId, userId: 'admin1', publicKey: cborPublicKey(keyPair.publicKey.export({ format: 'jwk' })).toString('base64url'), counter: 0, transports: ['internal'] }], subs: [], invites: [], recoveries: [],
  staffPins: [{ userId: 'trainer1', ...pinHash, createdAt: new Date().toISOString() }],
  sharedDevices: [
    { id: 'device-a', label: 'PC recepción', tokenHash: deviceHash, active: true, createdAt: new Date().toISOString(), authorizedBy: 'admin1', activeSessionId: null },
    { id: 'device-b', label: 'Tablet', tokenHash: secondDeviceHash, active: true, createdAt: new Date().toISOString(), authorizedBy: 'admin1', activeSessionId: null }
  ]
}))
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: 'admin1' },
  stdio: ['ignore', 'ignore', 'ignore']
})
async function waitForServer() {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) return } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)) }
  throw new Error('server child process never became healthy')
}
await waitForServer()
const post = (route, body, cookie = '') => fetch(base + route, {
  method: 'POST', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body || {})
})
const get = (route, cookie = '') => fetch(base + route, { headers: cookie ? { cookie } : {} })
const signedCookie = (uid, { auth = null, device = null, version = 0 } = {}) => {
  const p = `${uid}:${Date.now() + 86_400_000}:${version}${auth ? `:${auth}:${Date.now()}` : ''}`
  const token = p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url')
  return `gymsid=${token}${device ? `; j2shared=${device}` : ''}`
}
const b64u = b => Buffer.from(b).toString('base64url')
const dbPath = path.join(dataDir, 'db.json')
let assertionCounter = 0
async function assertion(challenge) {
  assertionCounter++
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: base }))
  const authData = Buffer.concat([crypto.createHash('sha256').update('localhost').digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, assertionCounter])])
  const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), keyPair.privateKey)
  return { id: credentialId, rawId: credentialId, type: 'public-key', response: { clientDataJSON: b64u(clientDataJSON), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: null }, clientExtensionResults: {} }
}
async function passkeyAction(routeOptions, routeFinish, body, cookie) {
  const optionsResponse = await post(routeOptions, body, cookie)
  const optionData = await optionsResponse.json()
  assert.equal(optionsResponse.status, 200, JSON.stringify(optionData))
  const credential = await assertion(optionData.options.challenge)
  return post(routeFinish, { ...body, cid: optionData.cid, credential }, cookie)
}

test('shared-device PIN access, isolation, rate limits, passkey step-up and immediate revocation', async () => {
  assert.equal(validateStaffPin('123456').ok, false)
  assert.equal(validateStaffPin('999999').ok, false)
  assert.equal(validateStaffPin('739462').ok, true)
  assert.equal(validateStaffPin('739462001').ok, false, 'a PIN longer than eight digits is rejected')
  assert.equal(await verifyStaffPin('739462', pinHash), true)
  assert.equal(await verifyStaffPin('739463', pinHash), false)

  const noDevice = await get('/api/shared-device/status')
  assert.deepEqual(await noDevice.json(), { authorized: false })
  assert.equal((await post('/api/shared-device/pin', { userId: 'trainer1', pin: '739462' })).status, 403)
  assert.equal((await get('/api/shared-device/status', `j2shared=${deviceToken}x`)).status, 200)
  const deviceCookie = `j2shared=${deviceToken}`
  const adminCookie = signedCookie('admin1')
  const status = await (await get('/api/shared-device/status', deviceCookie)).json()
  assert.equal(status.authorized, true)
  assert.deepEqual(status.staff, [{ id: 'trainer1', name: 'Trainer One', role: 'trainer' }])
  assert.equal(JSON.stringify(status).includes('@example.test'), false)
  assert.equal(JSON.stringify(status).includes('private-avatar'), false)
  assert.equal(JSON.stringify(status).includes(pinHash.hash), false)

  const trainerLogin = await post('/api/shared-device/pin', { userId: 'trainer1', pin: '739462' }, deviceCookie)
  assert.equal(trainerLogin.status, 200)
  const trainerData = await trainerLogin.json()
  const trainerCookie = `${trainerLogin.headers.get('set-cookie').split(';')[0]}; ${deviceCookie}`
  assert.equal(trainerData.authLevel, 'pin')
  assert.equal(trainerData.user.trainer, true)
  assert.equal((await (await get('/api/me', trainerCookie)).json()).user.authLevel, 'pin')
  const trainerRoleAttempt = await post('/api/admin/user/role', { id: 'member2', role: 'admin' }, trainerCookie)
  assert.equal(trainerRoleAttempt.status, 403)
  assert.equal((await trainerRoleAttempt.json()).code, 'passkey_required')

  const locked = await post('/api/shared-device/lock', {}, trainerCookie)
  assert.equal(locked.status, 200)
  assert.equal((await get('/api/me', trainerCookie)).status, 401)
  assert.equal((await (await get('/api/shared-device/status', deviceCookie)).json()).authorized, true, 'locking keeps the base device authorization')

  const trainerSecondLogin = await post('/api/shared-device/pin', { userId: 'trainer1', pin: '739462' }, deviceCookie)
  assert.equal(trainerSecondLogin.status, 200)
  const demotedTrainerCookie = `${trainerSecondLogin.headers.get('set-cookie').split(';')[0]}; ${deviceCookie}`
  assert.equal((await post('/api/admin/user/role', { id: 'trainer1', role: 'member' }, adminCookie)).status, 200)
  assert.equal((await get('/api/me', demotedTrainerCookie)).status, 401, 'losing trainer role immediately invalidates PIN session')
  assert.equal((await post('/api/admin/user/role', { id: 'trainer1', role: 'trainer' }, adminCookie)).status, 200)
  assert.equal((await get('/api/me', demotedTrainerCookie)).status, 401, 'role restoration cannot resurrect the revoked PIN session')

  for (let i = 0; i < 5; i++) assert.equal((await post('/api/shared-device/pin', { userId: 'trainer1', pin: '111111' }, deviceCookie)).status, 401)
  const blockedOnDevice = await post('/api/shared-device/pin', { userId: 'trainer1', pin: '739462' }, deviceCookie)
  assert.equal(blockedOnDevice.status, 429)
  const secondDeviceCookie = `j2shared=${secondDeviceToken}`
  assert.equal((await post('/api/shared-device/pin', { userId: 'trainer1', pin: '739462' }, secondDeviceCookie)).status, 429, 'user rate limit spans authorized devices')

  const ownPin = await passkeyAction('/api/shared-staff/pin/options', '/api/shared-staff/pin', { pin: '684257' }, adminCookie)
  assert.equal(ownPin.status, 200)
  const pinDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
  const adminPin = pinDb.staffPins.find(p => p.userId === 'admin1')
  assert.ok(adminPin?.hash && adminPin.salt)
  assert.equal(JSON.stringify(pinDb).includes('684257'), false, 'plain PIN is never persisted')
  assert.notEqual(adminPin.hash, '684257')

  const authorize = await passkeyAction('/api/shared-device/authorize/options', '/api/shared-device/authorize', { label: 'PC compartido de prueba' }, adminCookie)
  assert.equal(authorize.status, 200)
  const authorized = await authorize.json()
  const authCookie = authorize.headers.get('set-cookie').split(';')[0]
  assert.ok(authCookie.startsWith('j2shared='))
  const adminPinLogin = await post('/api/shared-device/pin', { userId: 'admin1', pin: '684257' }, authCookie)
  assert.equal(adminPinLogin.status, 200)
  let adminPinCookie = `${adminPinLogin.headers.get('set-cookie').split(';')[0]}; ${authCookie}`
  assert.equal((await (await get('/api/me', adminPinCookie)).json()).user.admin, true)
  const pinResetOptions = await post('/api/admin/shared-staff/pin/options', { userId: 'trainer1' }, adminPinCookie)
  assert.equal(pinResetOptions.status, 200, 'admin PIN session may start a reset challenge')
  const pinResetChallenge = await pinResetOptions.json()
  assert.equal((await post('/api/admin/shared-staff/pin', { userId: 'trainer1', pin: '739468', cid: pinResetChallenge.cid }, adminPinCookie)).status, 403, 'PIN alone cannot reset another trainer’s PIN')
  const pinReset = await passkeyAction('/api/admin/shared-staff/pin/options', '/api/admin/shared-staff/pin', { userId: 'trainer1', pin: '739468' }, adminPinCookie)
  assert.equal(pinReset.status, 200, 'fresh passkey assertion authorizes reset from a PIN session')
  const deniedRole = await post('/api/admin/user/role', { id: 'member2', role: 'admin' }, adminPinCookie)
  assert.equal(deniedRole.status, 403)
  assert.equal((await deniedRole.json()).code, 'passkey_required')
  const deniedLogoutAll = await post('/api/logout/all', {}, adminPinCookie)
  assert.equal(deniedLogoutAll.status, 403, 'account-wide revocation is also a strong-auth action')

  const stepUp = await passkeyAction('/api/shared-device/step-up/options', '/api/shared-device/step-up', {}, adminPinCookie)
  assert.equal(stepUp.status, 200)
  const permittedAfterStepUp = await post('/api/admin/user/role', { id: 'member2', role: 'trainer' }, adminPinCookie)
  assert.equal(permittedAfterStepUp.status, 200)
  assert.equal((await post('/api/admin/user/role', { id: 'member2', role: 'member' }, adminCookie)).status, 200)
  assert.equal((await post('/api/logout/all', {}, adminPinCookie)).status, 200)
  assert.equal((await get('/api/me', adminPinCookie)).status, 401, 'sign out everywhere invalidates the derived session')
  const adminPinLoginAgain = await post('/api/shared-device/pin', { userId: 'admin1', pin: '684257' }, authCookie)
  assert.equal(adminPinLoginAgain.status, 200)
  adminPinCookie = `${adminPinLoginAgain.headers.get('set-cookie').split(';')[0]}; ${authCookie}`

  const adminFreshCookie = signedCookie('admin1', { version: 1 })
  const revoke = await passkeyAction('/api/admin/shared-device/revoke/options', '/api/admin/shared-device/revoke', { id: authorized.device.id }, adminFreshCookie)
  assert.equal(revoke.status, 200)
  assert.equal((await get('/api/shared-device/status', authCookie)).status, 200)
  assert.deepEqual(await (await get('/api/shared-device/status', authCookie)).json(), { authorized: false })
  assert.equal((await get('/api/me', adminPinCookie)).status, 401, 'revoking the device invalidates its derived session immediately')
  const finalDb = JSON.parse(fs.readFileSync(dbPath, 'utf8'))
  assert.equal(finalDb.sharedDevices.find(d => d.id === authorized.device.id).tokenHash?.length, 64)
  assert.equal(finalDb.sharedStaffSessions.some(s => s.deviceId === authorized.device.id && s.active), false)
  const audit = finalDb.sharedStaffAudit
  assert.ok(audit.some(e => e.event === 'pin_failed'))
  assert.ok(audit.some(e => e.event === 'device_authorized'))
  assert.ok(audit.some(e => e.event === 'device_revoked'))
  assert.equal(JSON.stringify(audit).includes('684257'), false)
  assert.equal(JSON.stringify(audit).includes('739462'), false)
  assert.equal(JSON.stringify(audit).includes(deviceToken), false)
})

test('PIN limiter blocks independently by user/device and recovers after progressive backoff', () => {
  let now = 1000
  const limiter = createPinLimiter({ now: () => now, limit: 2, baseBlockMs: 100, maxBlockMs: 400 })
  limiter.fail('device:a'); limiter.fail('user:u1')
  limiter.fail('device:a'); limiter.fail('user:u1')
  assert.equal(limiter.check('device:a').allowed, false)
  assert.equal(limiter.check('user:u1').allowed, false)
  now += 101
  assert.equal(limiter.check('device:a').allowed, true)
  limiter.fail('device:a'); limiter.fail('device:a')
  assert.equal(limiter.check('device:a').retryAfter, 1)
  now += 401
  assert.equal(limiter.check('device:a').allowed, true)
  limiter.success('device:a')
  assert.equal(limiter.check('device:a').allowed, true)
})

test('passkey login sessions are identified as strong and legacy cookies remain compatible', async () => {
  const cookie = signedCookie('admin1', { version: 1 })
  const response = await get('/api/me', cookie)
  assert.equal(response.status, 200)
  assert.equal((await response.json()).user.authLevel, 'passkey')
})

test.after(() => { child.kill() })
