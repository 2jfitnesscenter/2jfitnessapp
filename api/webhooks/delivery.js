// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* One signed HTTPS POST to a member's endpoint. Rules come from docs/WEBHOOKS_SECURITY_REVIEW.md §2:
   - HTTPS on 443 only, validated again right before connecting (validateWebhookUrl);
   - every address the name resolves to is checked; ONE blocked address refuses the target (resolvePublicAddresses);
   - the socket connects to the address that was just vetted, never to a second lookup (DNS rebinding);
   - redirects are never followed: any 3xx is a failed attempt;
   - 5 s total timeout, body at most 16 KB, at most 4 KB of the response is read and then discarded.
   The response body is never returned to the caller. Nothing here writes to disk. */
import https from 'node:https';
import net from 'node:net';
import { validateWebhookUrl, resolvePublicAddresses, isBlockedAddress, signWebhook, SIGNATURE_HEADER } from '../lib/webhook-security.js';

export const DELIVERY_TIMEOUT_MS = 5000;
export const MAX_BODY_BYTES = 16 * 1024;
export const MAX_RESPONSE_BYTES = 4 * 1024;

// A lookup that answers with the one vetted address, for both the single and the `all: true` call shapes.
export function pinnedLookup(address, family) {
  return (_host, options, callback) => {
    const cb = typeof options === 'function' ? options : callback;
    const opts = typeof options === 'function' ? {} : (options || {});
    if (opts.all) cb(null, [{ address, family }]);
    else cb(null, address, family);
  };
}

/**
 * Sends one signed attempt. Resolves to { status, httpCode, durationMs } where status is one of
 * ok | http | redirect | timeout | network | blocked | too_large. Never rejects.
 */
export async function sendSigned({
  url, body, secret, eventId, now = Date.now(),
  resolve = host => resolvePublicAddresses(host),
  transport = https.request, timeoutMs = DELIVERY_TIMEOUT_MS,
}) {
  const started = Date.now();
  const done = (status, httpCode = null) => ({ status, httpCode, durationMs: Date.now() - started });
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return done('too_large');

  const v = validateWebhookUrl(url);
  if (!v.ok) return done('blocked');
  const u = new URL(v.url);

  let addresses;
  try { addresses = await resolve(u.hostname); } catch { return done('blocked'); }
  // Defence in depth: whatever the resolver returned, ONE blocked (or non-IP) address refuses the target.
  if (!Array.isArray(addresses) || addresses.length === 0) return done('blocked');
  if (addresses.some(a => net.isIP(String(a)) === 0 || isBlockedAddress(a))) return done('blocked');
  const pinned = addresses[0];
  const family = net.isIP(pinned);

  const signature = signWebhook({ secret, body, timestamp: Math.floor(now / 1000) });
  const headers = {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(body, 'utf8'),
    'user-agent': '2J-Webhooks/1',
    [SIGNATURE_HEADER]: signature,
    '2j-event-id': String(eventId),
  };

  return new Promise(resolvePromise => {
    let settled = false;
    let timer = null;
    const finish = (status, httpCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolvePromise(done(status, httpCode));
    };
    let req = null;
    timer = setTimeout(() => { finish('timeout'); try { req?.destroy(); } catch { /* already closed */ } }, timeoutMs);
    try {
      req = transport({
        protocol: 'https:', method: 'POST', host: u.hostname, servername: u.hostname, port: 443,
        path: u.pathname + u.search, headers, agent: false,
        lookup: pinnedLookup(pinned, family),
      }, res => {
        const code = res.statusCode || 0;
        if (code >= 300 && code < 400) { res.destroy(); return finish('redirect', code); }
        let seen = 0;
        res.on('data', chunk => {
          seen += chunk.length;
          if (seen >= MAX_RESPONSE_BYTES) { res.destroy(); finish(code >= 200 && code < 300 ? 'ok' : 'http', code); }
        });
        res.on('end', () => finish(code >= 200 && code < 300 ? 'ok' : 'http', code));
        res.on('error', () => finish('network', code));
      });
    } catch { return finish('network'); }
    req.on('error', err => finish(err && err.code === 'ETIMEDOUT' ? 'timeout' : 'network'));
    req.end(body);
  });
}
