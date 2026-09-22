const privatePeer = value => {
  const ip = String(value || '').replace(/^::ffff:/, '')
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
}

// The API container is reachable through nginx on the private compose network. Only in that
// case do we trust the first X-Forwarded-For hop (Caddy writes the public client address and
// nginx appends its own). A directly exposed API ignores a caller-supplied forwarding header.
export function bunkerClientIp(req) {
  const peer = String(req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown').replace(/^::ffff:/, '')
  if (!privatePeer(peer)) return peer
  const forwarded = req.headers?.['x-forwarded-for']
  const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded || '').split(',')[0].trim()
  return first || String(req.headers?.['x-real-ip'] || '').trim() || peer
}

export class AttemptLimiter {
  constructor({ limit, windowMs, blockMs, maxBlockMs = 5 * 60000, now = () => Date.now() }) {
    this.limit = limit; this.windowMs = windowMs; this.blockMs = blockMs; this.maxBlockMs = maxBlockMs; this.now = now
    this.entries = new Map()
  }
  check(key) {
    const at = this.now(), entry = this.entries.get(key)
    if (!entry) return { allowed: true }
    if (entry.blockedUntil > at) return { allowed: false, retryAfter: Math.max(1, Math.ceil((entry.blockedUntil - at) / 1000)) }
    if (at - entry.windowStarted >= this.windowMs) {
      entry.failures = 0; entry.windowStarted = at
    }
    return { allowed: true }
  }
  fail(key) {
    const at = this.now()
    let entry = this.entries.get(key)
    if (!entry || at - entry.windowStarted >= this.windowMs) entry = { failures: 0, windowStarted: at, strikes: entry?.strikes || 0, blockedUntil: 0 }
    entry.failures++
    if (entry.failures >= this.limit) {
      entry.blockedUntil = at + Math.min(this.maxBlockMs, this.blockMs * (2 ** entry.strikes))
      entry.strikes++
      entry.failures = 0
    }
    this.entries.set(key, entry)
  }
  success(key) { this.entries.delete(key) }
}

export const bunkerLimiters = () => ({
  // Enough room for several people sharing one kiosk to mistype, while making a 10,000-value
  // online PIN sweep impractical. Admin codes are longer and used less often, so tighter.
  pin: new AttemptLimiter({ limit: 12, windowMs: 60000, blockMs: 30000 }),
  admin: new AttemptLimiter({ limit: 6, windowMs: 60000, blockMs: 60000 }),
})
