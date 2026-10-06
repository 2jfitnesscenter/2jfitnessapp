import crypto from 'node:crypto'
import { appendSharedAudit, hashStaffPin, publicStaffUsers, validateStaffPin, verifyStaffPin } from './shared-staff.js'

export function sharedStaffRoutes(ctx) {
  const {
    db, json, readBody, readSession, requireAdmin, requireSharedDevice, isAdmin, isTrainer,
    deviceForRequest, deviceTokenHash, sessionCookie, clearCookie, sharedDeviceCookie,
    staffPasskeyOptions, verifyStaffPasskey, pinLimiter, pinLoginGate, pinLoginFailure, pinLoginSuccess, dummyPin, saveDb
  } = ctx
  let lastActivityWrite = 0
  return {
    'GET /api/shared-device/status': async (req, res) => {
      const device = deviceForRequest(req)
      if (!device) return json(res, 200, { authorized: false })
      json(res, 200, { authorized: true, device: { id: device.id, label: device.label, authorizedAt: device.createdAt }, staff: publicStaffUsers(db.users, db.staffPins, { isAdmin, isTrainer }) })
    },
    'POST /api/shared-device/pin': async (req, res) => {
      const device = requireSharedDevice(req, res); if (!device) return
      const ip = pinLoginGate(req, res); if (!ip) return
      const body = await readBody(req)
      const userId = String(body.userId || '').slice(0, 100), pin = String(body.pin || '').slice(0, 9)
      const deviceKey = `device:${device.id}`, userKey = `user:${userId || 'unknown'}`
      const deviceCheck = pinLimiter.check(deviceKey), userCheck = pinLimiter.check(userKey)
      if (!deviceCheck.allowed || !userCheck.allowed) {
        const retryAfter = Math.max(deviceCheck.retryAfter || 0, userCheck.retryAfter || 0)
        return json(res, 429, { error: 'demasiados intentos; espera un momento' }, { 'Retry-After': String(retryAfter) })
      }
      const user = db.users.find(u => u.id === userId), pinRecord = db.staffPins.find(p => p.userId === userId)
      const pinShapeOk = /^\d{6,8}$/.test(pin)
      const validPin = pinShapeOk && await verifyStaffPin(pin, pinRecord || dummyPin)
      if (!pinShapeOk) await verifyStaffPin('000000', dummyPin)
      if (!user || user.disabled || !isTrainer(user) || !validPin) {
        pinLimiter.fail(deviceKey); pinLimiter.fail(userKey)
        pinLoginFailure(ip)
        appendSharedAudit(db, { event: 'pin_failed', deviceId: device.id, userId: user && isTrainer(user) ? user.id : null })
        saveDb()
        return json(res, 401, { error: 'usuario o PIN no válido' })
      }
      pinLimiter.success(deviceKey); pinLimiter.success(userKey)
      pinLoginSuccess(ip)
      const issuedAt = Date.now(), exp = issuedAt + 12 * 60 * 60_000
      const sessionId = crypto.randomBytes(18).toString('base64url')
      db.sharedStaffSessions.filter(s => s.deviceId === device.id && s.active).forEach(s => { s.active = false; s.revokedAt = new Date(issuedAt).toISOString() })
      const role = isAdmin(user) ? 'admin' : 'trainer'
      db.sharedStaffSessions.push({ id: sessionId, deviceId: device.id, userId: user.id, role, issuedAt, lastActivityAt: issuedAt, expiresAt: exp, active: true, strongUntil: 0 })
      device.activeSessionId = sessionId
      device.lastUsedAt = new Date(issuedAt).toISOString()
      appendSharedAudit(db, { event: 'staff_unlocked', deviceId: device.id, userId: user.id })
      saveDb()
      const responseUser = { id: user.id, name: user.name, username: user.username || null, created: user.created || null, avatar: user.avatar || null, admin: isAdmin(user), trainer: isTrainer(user), strava: !!user.stravaAuth, whoop: !!user.whoopAuth }
      json(res, 200, { user: responseUser, authLevel: 'pin', expiresAt: exp }, { 'Set-Cookie': sessionCookie(user, { authLevel: 'pin', sharedDeviceId: device.id, sessionId, role, issuedAt, exp }) })
    },
    'POST /api/shared-device/lock': async (req, res) => {
      const user = readSession(req)
      if (!user || user.authLevel !== 'pin') return json(res, 401, { error: 'no hay una sesión compartida activa' }, { 'Set-Cookie': clearCookie })
      const session = db.sharedStaffSessions.find(s => s.id === user.sessionId && s.active)
      if (session) { session.active = false; session.revokedAt = new Date().toISOString() }
      const device = db.sharedDevices.find(d => d.id === user.sharedDeviceId)
      if (device?.activeSessionId === user.sessionId) device.activeSessionId = null
      appendSharedAudit(db, { event: 'staff_locked', deviceId: user.sharedDeviceId, userId: user.id })
      saveDb()
      json(res, 200, { ok: true }, { 'Set-Cookie': clearCookie })
    },
    'POST /api/shared-device/heartbeat': async (req, res) => {
      const user = readSession(req)
      if (!user || user.authLevel !== 'pin') return json(res, 401, { error: 'la sesión compartida ya no está activa' }, { 'Set-Cookie': clearCookie })
      const session = db.sharedStaffSessions.find(s => s.id === user.sessionId && s.active)
      const device = db.sharedDevices.find(d => d.id === user.sharedDeviceId && d.active && !d.revokedAt)
      if (!session || !device || device.activeSessionId !== session.id) return json(res, 401, { error: 'la sesión compartida ya no está activa' }, { 'Set-Cookie': clearCookie })
      const now = Date.now()
      session.lastActivityAt = now; device.lastUsedAt = new Date(now).toISOString()
      if (now - lastActivityWrite >= 30_000) { saveDb(); lastActivityWrite = now }
      json(res, 200, { ok: true })
    },
    'POST /api/shared-device/step-up/options': async (req, res) => {
      const user = readSession(req)
      if (!user || user.authLevel !== 'pin') return json(res, 403, { error: 'esta confirmación solo está disponible en una sesión compartida' })
      return staffPasskeyOptions(req, res, { user, purpose: 'shared-device-step-up', subjectId: user.sessionId })
    },
    'POST /api/shared-device/step-up': async (req, res) => {
      const sessionUser = readSession(req)
      if (!sessionUser || sessionUser.authLevel !== 'pin') return json(res, 403, { error: 'no hay una sesión compartida activa' })
      const body = await readBody(req)
      const user = await verifyStaffPasskey(req, res, body, { purpose: 'shared-device-step-up', subjectId: sessionUser.sessionId })
      if (!user) return
      if (!isTrainer(user)) return json(res, 403, { error: 'el rol de entrenador ya no está activo' })
      const session = db.sharedStaffSessions.find(s => s.id === sessionUser.sessionId && s.active)
      if (!session || session.deviceId !== sessionUser.sharedDeviceId || session.userId !== user.id) return json(res, 401, { error: 'la sesión ya no está activa' }, { 'Set-Cookie': clearCookie })
      session.strongUntil = Date.now() + 5 * 60_000
      appendSharedAudit(db, { event: 'strong_reauth', deviceId: session.deviceId, userId: user.id })
      saveDb(); json(res, 200, { ok: true, expiresAt: session.strongUntil })
    },
    'POST /api/shared-device/authorize/options': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return
      return staffPasskeyOptions(req, res, { user: admin, purpose: 'authorize-shared-device' })
    },
    'POST /api/shared-device/authorize': async (req, res) => {
      const admin = readSession(req)
      if (!admin) return json(res, 401, { error: 'no has iniciado sesión' })
      if (!isAdmin(admin)) return json(res, 403, { error: 'solo un administrador puede autorizar este ordenador' })
      const body = await readBody(req), verified = await verifyStaffPasskey(req, res, body, { purpose: 'authorize-shared-device' })
      if (!verified) return
      if (!isAdmin(verified)) return json(res, 403, { error: 'se requiere un administrador con passkey' })
      const now = new Date().toISOString(), id = crypto.randomBytes(18).toString('base64url'), token = crypto.randomBytes(32).toString('base64url')
      const label = String(body.label || '').trim().replace(/[<>\u0000-\u001f]/g, '').slice(0, 60) || 'Ordenador compartido'
      db.sharedDevices.push({ id, label, tokenHash: deviceTokenHash(token), active: true, createdAt: now, authorizedBy: admin.id, lastUsedAt: null, activeSessionId: null })
      appendSharedAudit(db, { event: 'device_authorized', deviceId: id, actorId: admin.id })
      saveDb()
      json(res, 200, { ok: true, device: { id, label, authorizedAt: now } }, { 'Set-Cookie': sharedDeviceCookie(token) })
    },
    'GET /api/admin/shared-devices': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return
      json(res, 200, { devices: db.sharedDevices.map(d => ({ id: d.id, label: d.label, authorizedAt: d.createdAt, authorizedBy: db.users.find(u => u.id === d.authorizedBy)?.name || 'Admin', lastUsedAt: d.lastUsedAt, active: !!d.active && !d.revokedAt })) })
    },
    'POST /api/admin/shared-device/revoke/options': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return
      const body = await readBody(req), id = String(body.id || '')
      if (!db.sharedDevices.some(d => d.id === id && d.active)) return json(res, 404, { error: 'dispositivo no encontrado' })
      return staffPasskeyOptions(req, res, { user: admin, purpose: 'revoke-shared-device', subjectId: id })
    },
    'POST /api/admin/shared-device/revoke': async (req, res) => {
      const admin = readSession(req)
      if (!admin) return json(res, 401, { error: 'no has iniciado sesión' })
      if (!isAdmin(admin)) return json(res, 403, { error: 'solo un administrador puede revocar dispositivos' })
      const body = await readBody(req), id = String(body.id || '')
      const verified = await verifyStaffPasskey(req, res, body, { purpose: 'revoke-shared-device', subjectId: id })
      if (!verified) return
      if (!isAdmin(verified)) return json(res, 403, { error: 'se requiere un administrador con passkey' })
      const device = db.sharedDevices.find(d => d.id === id && d.active)
      if (!device) return json(res, 404, { error: 'dispositivo no encontrado' })
      device.active = false; device.revokedAt = new Date().toISOString(); device.activeSessionId = null
      db.sharedStaffSessions.filter(s => s.deviceId === id && s.active).forEach(s => { s.active = false; s.revokedAt = device.revokedAt })
      appendSharedAudit(db, { event: 'device_revoked', deviceId: id, actorId: admin.id })
      saveDb(); json(res, 200, { ok: true })
    },
    'POST /api/shared-staff/pin/options': async (req, res) => {
      const user = readSession(req)
      if (!user) return json(res, 401, { error: 'no has iniciado sesión' })
      if (!isTrainer(user)) return json(res, 403, { error: 'solo los entrenadores pueden configurar un PIN' })
      return staffPasskeyOptions(req, res, { user, purpose: 'set-own-staff-pin' })
    },
    'POST /api/shared-staff/pin': async (req, res) => {
      const user = readSession(req)
      if (!user || !isTrainer(user)) return json(res, 403, { error: 'solo los entrenadores pueden configurar un PIN' })
      const body = await readBody(req), verified = await verifyStaffPasskey(req, res, body, { purpose: 'set-own-staff-pin' })
      if (!verified) return
      if (!isTrainer(verified)) return json(res, 403, { error: 'el rol de entrenador ya no está activo' })
      const checked = validateStaffPin(body.pin)
      if (!checked.ok) return json(res, 400, { error: checked.reason === 'weak' ? 'elige un PIN menos predecible' : 'el PIN debe tener entre 6 y 8 dígitos' })
      const hashed = await hashStaffPin(checked.pin), at = new Date().toISOString(), record = db.staffPins.find(p => p.userId === user.id)
      if (record) Object.assign(record, { ...hashed, updatedAt: at }); else db.staffPins.push({ userId: user.id, ...hashed, createdAt: at, updatedAt: at })
      db.sharedStaffSessions.filter(s => s.userId === user.id && s.active).forEach(s => {
        s.active = false; s.revokedAt = at
        const device = db.sharedDevices.find(d => d.id === s.deviceId)
        if (device?.activeSessionId === s.id) device.activeSessionId = null
      })
      appendSharedAudit(db, { event: 'pin_set', userId: user.id }); saveDb(); json(res, 200, { ok: true, requiresRelogin: user.authLevel === 'pin' })
    },
    'POST /api/admin/shared-staff/pin/options': async (req, res) => {
      const admin = requireAdmin(req, res); if (!admin) return
      const body = await readBody(req), targetId = String(body.userId || '')
      if (!db.users.some(u => u.id === targetId && !u.disabled && isTrainer(u))) return json(res, 404, { error: 'entrenador no encontrado' })
      return staffPasskeyOptions(req, res, { user: admin, purpose: 'reset-staff-pin', subjectId: targetId })
    },
    'POST /api/admin/shared-staff/pin': async (req, res) => {
      const admin = readSession(req)
      if (!admin) return json(res, 401, { error: 'no has iniciado sesión' })
      if (!isAdmin(admin)) return json(res, 403, { error: 'solo un administrador puede restablecer el PIN' })
      const body = await readBody(req), targetId = String(body.userId || '')
      const verified = await verifyStaffPasskey(req, res, body, { purpose: 'reset-staff-pin', subjectId: targetId })
      if (!verified) return
      if (!isAdmin(verified)) return json(res, 403, { error: 'se requiere un administrador con passkey' })
      if (!db.users.some(u => u.id === targetId && !u.disabled && isTrainer(u))) return json(res, 404, { error: 'entrenador no encontrado' })
      const checked = validateStaffPin(body.pin)
      if (!checked.ok) return json(res, 400, { error: checked.reason === 'weak' ? 'elige un PIN menos predecible' : 'el PIN debe tener entre 6 y 8 dígitos' })
      const hashed = await hashStaffPin(checked.pin), at = new Date().toISOString(), record = db.staffPins.find(p => p.userId === targetId)
      if (record) Object.assign(record, { ...hashed, updatedAt: at }); else db.staffPins.push({ userId: targetId, ...hashed, createdAt: at, updatedAt: at })
      db.sharedStaffSessions.filter(s => s.userId === targetId && s.active).forEach(s => {
        s.active = false; s.revokedAt = at
        const device = db.sharedDevices.find(d => d.id === s.deviceId)
        if (device?.activeSessionId === s.id) device.activeSessionId = null
      })
      appendSharedAudit(db, { event: 'pin_reset', userId: targetId, actorId: admin.id }); saveDb(); json(res, 200, { ok: true })
    }
  }
}
