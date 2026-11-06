// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
const privatePeer = value => {
  const ip = String(value || '').replace(/^::ffff:/, '')
  return ip === '::1' || ip === '127.0.0.1' || ip.startsWith('10.') || ip.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
}

// Who is a proxy, and therefore allowed to tell us the client address?
//
//  - TRUSTED_PROXIES unset (today's behaviour, kept so nothing changes by itself): any PRIVATE direct peer is believed, and the FIRST
//    X-Forwarded-For hop is the client. This assumes every private peer is our own nginx and that the public edge overwrote the header.
//    A private address is NOT proof of that (another container, a LAN host or a compromised neighbour is private too).
//  - TRUSTED_PROXIES set (recommended before exposing the service): a comma-separated list of exact IPs / IPv4 CIDRs of the proxies in the chain
//    (for example the compose subnet that holds nginx, plus the host/gateway address Caddy connects from). Only a direct peer inside the list is
//    believed, and the client is the RIGHTMOST address that is not itself a trusted proxy, so a forged leftmost entry changes nothing even if the
//    edge forwards client-supplied headers. A peer outside the list is keyed by its own address.
const ipv4 = text => { const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text); if (!m) return null; const p = m.slice(1).map(Number); return p.some(n => n > 255) ? null : ((p[0] * 2 ** 24) + (p[1] << 16) + (p[2] << 8) + p[3]); };
const normalizeIp = value => String(value || '').trim().replace(/^::ffff:/i, '').toLowerCase();

export function parseTrustedProxies(text) {
  const entries = String(text || '').split(',').map(part => part.trim()).filter(Boolean);
  if (!entries.length) return null;
  return entries.map(entry => {
    const [address, prefix, ...rest] = entry.split('/');
    const ip = normalizeIp(address);
    const v4 = ipv4(ip);
    if (rest.length) throw new Error('TRUSTED_PROXIES: invalid entry ' + entry);
    if (v4 !== null) {
      const bits = prefix === undefined ? 32 : /^\d{1,2}$/.test(prefix) ? Number(prefix) : NaN;
      if (!Number.isInteger(bits) || bits > 32 || bits < 8) throw new Error('TRUSTED_PROXIES: an IPv4 network must be /8 to /32 (' + entry + ')');
      const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
      return { v4: true, network: (v4 & mask) >>> 0, mask };
    }
    if (prefix !== undefined || !/^[0-9a-f:]+$/.test(ip) || !ip.includes(':')) throw new Error('TRUSTED_PROXIES: use an IPv4 address/CIDR or an exact IPv6 address (' + entry + ')');
    return { v4: false, exact: ip };
  });
}

let trustedProxies = null;
/** Called once at start-up from TRUSTED_PROXIES; null restores the legacy "private peer" rule. */
export const setTrustedProxies = list => { trustedProxies = list && list.length ? list : null; };
const isTrusted = (ip, list) => { const v4 = ipv4(ip); return list.some(rule => rule.v4 ? v4 !== null && ((v4 & rule.mask) >>> 0) === rule.network : rule.exact === ip); };

export function bunkerClientIp(req, list = trustedProxies) {
  const peer = normalizeIp(req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown');
  const forwardedHeader = req.headers?.['x-forwarded-for'];
  const hops = String(Array.isArray(forwardedHeader) ? forwardedHeader.join(',') : forwardedHeader || '').split(',').map(normalizeIp).filter(Boolean);
  if (list) {
    if (!isTrusted(peer, list)) return peer;
    for (let i = hops.length - 1; i >= 0; i--) if (!isTrusted(hops[i], list)) return hops[i];
    return String(req.headers?.['x-real-ip'] || '').trim() || hops[0] || peer;
  }
  if (!privatePeer(peer)) return peer;
  return hops[0] || String(req.headers?.['x-real-ip'] || '').trim() || peer;
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
