import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
const PIN_BYTES = 64
const AUDIT_LIMIT = 1000

export function validateStaffPin(value) {
  const pin = String(value ?? '')
  if (!/^\d{6,8}$/.test(pin)) return { ok: false, reason: 'length' }
  if (/^(\d)\1+$/.test(pin)) return { ok: false, reason: 'weak' }
  const digits = [...pin].map(Number)
  const ascending = digits.every((n, i) => i === 0 || n === (digits[i - 1] + 1) % 10)
  const descending = digits.every((n, i) => i === 0 || n === (digits[i - 1] + 9) % 10)
  if (ascending || descending) return { ok: false, reason: 'weak' }
  return { ok: true, pin }
}

export async function hashStaffPin(pin, salt = crypto.randomBytes(16).toString('hex')) {
  const derived = await scrypt(pin, salt, PIN_BYTES, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
  return { salt, hash: derived.toString('base64url') }
}

export async function verifyStaffPin(pin, record) {
  if (!record?.salt || !record?.hash) return false
  try {
    const expected = Buffer.from(record.hash, 'base64url')
    const actual = await scrypt(pin, record.salt, PIN_BYTES, { N: 1 << 14, r: 8, p: 1, maxmem: 64 * 1024 * 1024 })
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual)
  } catch { return false }
}

export function createPinLimiter({ now = () => Date.now(), limit = 5, baseBlockMs = 30_000, maxBlockMs = 15 * 60_000 } = {}) {
  const buckets = new Map()
  return {
    check(key) {
      const item = buckets.get(key)
      const current = now()
      if (!item || item.blockedUntil <= current) return { allowed: true }
      return { allowed: false, retryAfter: Math.max(1, Math.ceil((item.blockedUntil - current) / 1000)) }
    },
    fail(key) {
      const current = now()
      if (buckets.size >= 10_000) {
        for (const [k, value] of buckets) {
          if (current - (value.updatedAt || current) > maxBlockMs && value.blockedUntil <= current) buckets.delete(k)
        }
      }
      let item = buckets.get(key)
      if (!item) item = { failures: 0, strikes: 0, blockedUntil: 0 }
      item.failures++
      if (item.failures >= limit) {
        item.blockedUntil = current + Math.min(maxBlockMs, baseBlockMs * (2 ** item.strikes++))
        item.failures = 0
      }
      item.updatedAt = current
      buckets.set(key, item)
    },
    success(key) { buckets.delete(key) },
  }
}

export function appendSharedAudit(db, event) {
  db.sharedStaffAudit ||= []
  db.sharedStaffAudit.push({ at: new Date().toISOString(), ...event })
  if (db.sharedStaffAudit.length > AUDIT_LIMIT) db.sharedStaffAudit.splice(0, db.sharedStaffAudit.length - AUDIT_LIMIT)
}

export function publicStaffUsers(users, staffPins, { isAdmin = user => !!user?.admin, isTrainer = user => !!user?.trainer || isAdmin(user) } = {}) {
  const allowed = new Set((staffPins || []).map(pin => pin.userId))
  return (users || []).filter(user => allowed.has(user.id) && !user.disabled && isTrainer(user))
    .map(user => ({ id: user.id, name: String(user.name || '').slice(0, 60), role: isAdmin(user) ? 'admin' : 'trainer' }))
}
