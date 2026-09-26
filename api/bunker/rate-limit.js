// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
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
    // Keys are client IPs on the public auth routes, so a sweep from many addresses must not
    // grow this map forever: drop entries that are neither blocked nor inside their window.
    if (this.entries.size > 10000) {
      for (const [k, e] of this.entries) if (e.blockedUntil <= at && at - e.windowStarted >= this.windowMs) this.entries.delete(k)
    }
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

// Public passkey/registration/recovery routes in server.js. Keyed by client IP only (there is
// no credential to fingerprint before a WebAuthn ceremony) and generous on purpose: the whole
// gym can reach the app from one public address behind its router.
export const authLimiters = () => ({
  // Every options request counts: each one mints a server-side challenge.
  challenge: new AttemptLimiter({ limit: 30, windowMs: 60000, blockMs: 60000 }),
  // Only failed verifications count.
  verify: new AttemptLimiter({ limit: 20, windowMs: 60000, blockMs: 60000 }),
  // Writes to db.json and pushes every admin, so it is the tightest.
  recoveryRequest: new AttemptLimiter({ limit: 5, windowMs: 10 * 60000, blockMs: 10 * 60000, maxBlockMs: 60 * 60000 }),
})

export const bunkerLimiters = () => ({
  // The IP buckets slow broad sweeps without punishing a gym NAT for one typo. Credential
  // buckets also stop a distributed attack against one guessed PIN/code. Their keys are
  // one-way fingerprints created by routes.js; the limiter never retains the credential.
  pin: new AttemptLimiter({ limit: 20, windowMs: 60000, blockMs: 30000 }),
  pinCredential: new AttemptLimiter({ limit: 5, windowMs: 60000, blockMs: 30000 }),
  admin: new AttemptLimiter({ limit: 10, windowMs: 60000, blockMs: 60000 }),
  adminCredential: new AttemptLimiter({ limit: 4, windowMs: 60000, blockMs: 60000 }),
})
