// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Safe primitives for outbound webhooks. See docs/WEBHOOKS_SECURITY_REVIEW.md for the threat
   model and the decisions behind each rule. This module has no network I/O of its own, no routes
   and no storage: it only validates targets, signs and verifies payloads, and protects the
   signing secret at rest. Nothing here sends a webhook yet. */
import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import { encrypt, decrypt } from './crypto.js';

export const WEBHOOK_SECRET_INFO = 'webhook-secret-v1';
export const SIGNATURE_HEADER = '2J-Signature';
export const SIGNATURE_TOLERANCE_SEC = 300;

const fail = (code, message) => ({ ok: false, code, message });
const err = code => Object.assign(new Error(code), { code });

// ---- IP address classes ------------------------------------------------------------------

function blockedV4(ip) {
  const [a, b, c] = ip.split('.').map(Number);
  if (a === 0 || a === 10 || a === 127) return true;          // "this" net, private, loopback
  if (a === 100 && b >= 64 && b <= 127) return true;           // carrier-grade NAT
  if (a === 169 && b === 254) return true;                     // link-local, cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;            // private
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 192 && b === 168) return true;                     // private
  if (a === 198 && (b === 18 || b === 19)) return true;        // benchmarking
  if (a === 198 && b === 51 && c === 100) return true;         // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true;          // TEST-NET-3
  if (a >= 224) return true;                                   // multicast, reserved, broadcast
  return false;
}

// Expands an IPv6 literal (with optional trailing dotted IPv4) to its 16 bytes, or null.
function v6Bytes(ip) {
  let s = ip.toLowerCase();
  let v4tail = null;
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) { v4tail = m[1].split('.').map(Number); s = s.slice(0, s.length - m[1].length) + '0:0'; }
  const parts = s.split('::');
  if (parts.length > 2) return null;
  const head = parts[0] ? parts[0].split(':') : [];
  const tail = parts.length === 2 && parts[1] ? parts[1].split(':') : [];
  const missing = parts.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array(Math.max(0, missing)).fill('0'), ...tail];
  if (groups.length !== 8 || groups.some(g => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const bytes = Buffer.alloc(16);
  groups.forEach((g, i) => bytes.writeUInt16BE(parseInt(g, 16), i * 2));
  if (v4tail) bytes.set(v4tail, 12);
  return bytes;
}

const embeddedV4 = (b, off) => `${b[off]}.${b[off + 1]}.${b[off + 2]}.${b[off + 3]}`;

function blockedV6(ip) {
  const b = v6Bytes(ip);
  if (!b) return true;
  const zeroTo = n => b.subarray(0, n).every(x => x === 0);
  if (zeroTo(12)) return blockedV4(embeddedV4(b, 12));         // ::, ::1, IPv4-compatible
  if (zeroTo(10) && b[10] === 0xff && b[11] === 0xff) return blockedV4(embeddedV4(b, 12)); // ::ffff:a.b.c.d
  if ((b[0] & 0xfe) === 0xfc) return true;                     // unique local fc00::/7
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0x80) return true;    // link-local fe80::/10
  if (b[0] === 0xfe && (b[1] & 0xc0) === 0xc0) return true;    // site-local fec0::/10
  if (b[0] === 0xff) return true;                              // multicast ff00::/8
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.subarray(4, 12).every(x => x === 0)) {
    return blockedV4(embeddedV4(b, 12));                       // NAT64 64:ff9b::/96
  }
  if (b[0] === 0x20 && b[1] === 0x02) return blockedV4(embeddedV4(b, 2)); // 6to4 2002::/16
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return true; // Teredo 2001::/32
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // documentation 2001:db8::/32
  return false;
}

// True for any address a webhook must never connect to. Unknown input counts as blocked.
export function isBlockedAddress(ip) {
  const v = net.isIP(String(ip || ''));
  if (v === 4) return blockedV4(ip);
  if (v === 6) return blockedV6(ip);
  return true;
}

// ---- target URL --------------------------------------------------------------------------

// Syntactic check of a user-supplied target. DNS is checked separately, right before sending.
export function validateWebhookUrl(input) {
  let u;
  try { u = new URL(String(input ?? '').trim()); } catch { return fail('WEBHOOK_URL_INVALID', 'The address is not a valid URL.'); }
  if (u.protocol !== 'https:') return fail('WEBHOOK_URL_NOT_HTTPS', 'Only https:// addresses are allowed.');
  if (u.username || u.password) return fail('WEBHOOK_URL_CREDENTIALS', 'Addresses with a user name or password are not allowed.');
  if (u.port && u.port !== '443') return fail('WEBHOOK_URL_PORT', 'Only the standard HTTPS port (443) is allowed.');
  const host = u.hostname.toLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (!host || host.length > 253) return fail('WEBHOOK_URL_HOST', 'The address has no usable host name.');
  const localNames = ['localhost', 'localdomain', 'local', 'internal'];
  if (localNames.includes(host) || localNames.some(n => host.endsWith('.' + n))) {
    return fail('WEBHOOK_URL_HOST', 'Local host names are not allowed.');
  }
  if (net.isIP(host) && isBlockedAddress(host)) return fail('WEBHOOK_TARGET_PRIVATE', 'Addresses on private or internal networks are not allowed.');
  return { ok: true, url: u.href };
}

// Resolves every address of the host and refuses the target if ANY of them is blocked.
// Returns the vetted addresses; the sender must connect to one of them, not re-resolve the name.
export async function resolvePublicAddresses(hostname, lookup = h => dns.lookup(h, { all: true, verbatim: true })) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '');
  if (net.isIP(host)) {
    if (isBlockedAddress(host)) throw err('WEBHOOK_TARGET_PRIVATE');
    return [host];
  }
  const entries = await lookup(host);
  if (!Array.isArray(entries) || entries.length === 0) throw err('WEBHOOK_DNS_EMPTY');
  for (const e of entries) if (isBlockedAddress(e.address)) throw err('WEBHOOK_TARGET_PRIVATE');
  return entries.map(e => e.address);
}

// ---- signing -----------------------------------------------------------------------------

export function generateWebhookSecret() {
  return 'whsec_' + crypto.randomBytes(32).toString('base64url');
}

function v1Of(secret, timestamp, body) {
  return crypto.createHmac('sha256', String(secret)).update(`${timestamp}.${body}`, 'utf8').digest('hex');
}

// Header value for the payload: "t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">".
export function signWebhook({ secret, body, timestamp = Math.floor(Date.now() / 1000) }) {
  const t = Math.floor(timestamp);
  return `t=${t},v1=${v1Of(secret, t, body)}`;
}

// Receiver-side check (also used by tests): signature must match and the timestamp must be
// within the tolerance window, which blocks replays of an old captured request.
export function verifyWebhookSignature({ secret, header, body, now = Math.floor(Date.now() / 1000), toleranceSec = SIGNATURE_TOLERANCE_SEC }) {
  const m = /^t=(\d+),v1=([0-9a-f]{64})$/.exec(String(header || ''));
  if (!m) return { ok: false, reason: 'malformed' };
  const t = Number(m[1]);
  if (!Number.isFinite(now) || Math.abs(now - t) > toleranceSec) return { ok: false, reason: 'stale' };
  const a = Buffer.from(m[2], 'hex');
  const b = Buffer.from(v1Of(secret, t, body), 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return { ok: false, reason: 'mismatch' };
  return { ok: true };
}

// ---- secret at rest ----------------------------------------------------------------------

// A hash cannot sign, so the secret is stored encrypted (AES-256-GCM, its own HKDF domain).
export function encryptWebhookSecret(secret) {
  return encrypt({ s: String(secret) }, WEBHOOK_SECRET_INFO);
}

export function decryptWebhookSecret(blob) {
  const v = decrypt(blob, WEBHOOK_SECRET_INFO);
  return v && typeof v.s === 'string' ? v.s : null;
}
