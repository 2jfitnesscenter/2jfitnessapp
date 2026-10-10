// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Linking a device with a QR code.
 *
 *   device A (signed out) asks for a link and shows its QR  →  device B (signed in, passkey) opens it, confirms the short code shown on A and
 *   approves with a fresh passkey step-up  →  A, which is polling with the secret only it holds, is signed in as B's account.
 *
 * What makes it safe to leave on a screen:
 *   - the QR carries only a public id; claiming needs a 256-bit secret that never leaves device A (the server keeps its hash);
 *   - a link lives three minutes, is approved once and claimed once — a second claim of the same link is refused, a replayed approval too;
 *   - B must type the four-digit code that A shows, and three wrong tries kill the link (someone who only photographed the QR cannot approve it);
 *   - it is held in memory only, like the WebAuthn challenges: a restart simply cancels pending links; nothing about it is ever written to disk.
 * This is not Shared Staff and does not touch it: it signs a person in as themselves, with an ordinary session of their own.
 */
import crypto from 'node:crypto'

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'      // no 0/O/1/I: the id can also be typed
const sha = s => crypto.createHash('sha256').update(String(s)).digest()
const same = (a, b) => crypto.timingSafeEqual(sha(a), sha(b))
const newId = () => Array.from(crypto.randomBytes(10), b => ALPHABET[b % ALPHABET.length]).join('')
const newCode = () => String(crypto.randomInt(0, 10000)).padStart(4, '0')

export const LINK_TTL_MS = 3 * 60_000
export const LINK_MAX = 500
export const CODE_TRIES = 3

export function createLinkStore({ now = Date.now, ttlMs = LINK_TTL_MS, max = LINK_MAX } = {}) {
  const links = new Map()
  const live = l => l && l.expiresAt > now() && (l.status === 'pending' || l.status === 'approved')
  const sweep = () => { for (const [id, l] of links) if (l.expiresAt + 60_000 < now()) links.delete(id) }
  return {
    size: () => links.size,
    sweep,
    /** Device A asks for a link. `platform` is the coarse label of A. Returns the secret exactly once. */
    start({ platform }) {
      sweep()
      if (links.size >= max) return null
      const id = newId(), secret = crypto.randomBytes(32).toString('base64url'), code = newCode()
      links.set(id, { id, secretHash: sha(secret), code, platform: String(platform || '').slice(0, 40), status: 'pending', userId: null, tries: 0, createdAt: now(), expiresAt: now() + ttlMs })
      return { id, secret, code, expiresAt: now() + ttlMs }
    },
    /** What the approving device may know before it approves: where the request comes from and when it runs out. Never the code or the secret. */
    info(id) {
      const l = links.get(String(id || ''))
      if (!live(l) || l.status !== 'pending') return null
      return { id: l.id, platform: l.platform, expiresAt: l.expiresAt }
    },
    /** Device B, already authenticated as `userId`, approves with the code A shows. */
    approve(id, userId, code) {
      const l = links.get(String(id || ''))
      if (!l) return { error: 'not_found', status: 404 }
      if (!live(l)) return { error: 'expired', status: 410 }
      if (l.status !== 'pending') return { error: 'taken', status: 409 }
      if (!same(String(code || '').trim(), l.code)) {
        if (++l.tries >= CODE_TRIES) { l.status = 'denied'; return { error: 'denied', status: 410 } }
        return { error: 'wrong_code', status: 403, triesLeft: CODE_TRIES - l.tries }
      }
      l.status = 'approved'; l.userId = userId; l.approvedAt = now()
      return { ok: true }
    },
    /** Device A polls. Approved links are handed out once and are gone afterwards. */
    claim(id, secret) {
      const l = links.get(String(id || ''))
      if (!l) return { error: 'not_found', status: 404 }
      if (!crypto.timingSafeEqual(l.secretHash, sha(String(secret ?? '')))) return { error: 'forbidden', status: 403 }
      if (l.status === 'used') return { error: 'used', status: 410 }
      if (l.status === 'denied' || l.expiresAt <= now()) return { error: l.status === 'denied' ? 'denied' : 'expired', status: 410 }
      if (l.status === 'pending') return { status: 'pending' }
      l.status = 'used'
      const out = { status: 'approved', userId: l.userId, platform: l.platform }
      l.userId = null
      return out
    },
  }
}
