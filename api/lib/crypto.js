/* Shared AES-256-GCM at-rest encryption, key derived per-feature via HKDF off ./data/secret (the
   same file that already signs session cookies). Each caller passes its own `info` string so a
   leaked blob from one feature (e.g. a Strava refresh token) isn't decryptable with another
   feature's derived key (e.g. the Coach's) — domain separation, and lets a feature's secrets be
   rotated/scoped independently later.

   Extracted from api/coach/config.js, which now imports these instead of defining its own copy. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const DATA = process.env.DATA_DIR || '/data';
const keyCache = new Map();
function key(info) {
  if (keyCache.has(info)) return keyCache.get(info);
  // Read the secret lazily: server.js creates it at boot, and a feature module may be imported first.
  const secret = fs.readFileSync(path.join(DATA, 'secret'), 'utf8').trim();
  const k = Buffer.from(crypto.hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), Buffer.from(info), 32));
  keyCache.set(info, k);
  return k;
}
export function encrypt(obj, info) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(info), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}
export function decrypt(blob, info) {
  try {
    const buf = Buffer.from(String(blob || ''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', key(info), buf.subarray(0, 12));
    d.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
  } catch { return null; }   // wrong key (restored ./data without the secret), or tampered blob
}
// Test seam: forget every derived key so the next call re-reads ./data/secret from disk.
export function resetKeyCache() { keyCache.clear(); }
