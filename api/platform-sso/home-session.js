import crypto from 'node:crypto';
import { z } from 'zod';
import { signPlatformServiceRequest } from '../platform-proof/service-auth.js';
import { MAX_CAPABILITY_CACHE_MS } from './capabilities.js';

// Resolves the Home member session (cookie `2j_member`) to a person by asking Platform, server to server.
// Read-only and asynchronous: it runs BEFORE the dispatcher, so the synchronous readSession is untouched.
// Only `2j_member` is read here; `gymsid` is never looked at. Neither the cookie value nor a signature is logged or used as a cache key.

export const HOME_SESSION_COOKIE = '2j_member';
export const HOME_SESSION_VERIFY_PATH = '/api/internal/platform/v2/member-session/verify';
const COOKIE_VALUE = /^[A-Za-z0-9_-]{1,256}$/;
const MAX_CACHE_ENTRIES = 1000;
const responseSchema = z.object({ personId: z.string().min(1).max(200), trainingUserId: z.string().min(1).max(200).nullable().optional(), expiresAt: z.string() }).passthrough();

const cookieValue = header => {
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === HOME_SESSION_COOKIE) { const value = part.slice(i + 1).trim(); return COOKIE_VALUE.test(value) ? value : null; }
  }
  return null;
};

/** deps: { config: { baseUrl, keyId, secret }, fetchImpl, now, cache: Map, log } */
export async function resolveHomeSession(cookieHeader, { config, fetchImpl = globalThis.fetch, now = Date.now, cache = new Map(), log = console } = {}) {
  const cookie = cookieValue(cookieHeader);
  if (!cookie || !config) return null;
  const key = crypto.createHash('sha256').update(cookie).digest('hex');
  const t = now();
  const hit = cache.get(key);
  if (hit && hit.expiresAtMs > t) return hit.session;
  if (hit) cache.delete(key);
  const remember = (session, ttl) => {
    if (cache.size >= MAX_CACHE_ENTRIES) { for (const [k, v] of cache) if (v.expiresAtMs <= t) cache.delete(k); if (cache.size >= MAX_CACHE_ENTRIES) cache.clear(); }
    cache.set(key, { session, expiresAtMs: t + Math.min(ttl, MAX_CAPABILITY_CACHE_MS) });
  };
  const body = Buffer.from(JSON.stringify({ cookie }), 'utf8');
  const timestamp = new Date(t).toISOString(), requestId = crypto.randomUUID();
  const { signature } = signPlatformServiceRequest({ keyId: config.keyId, secret: config.secret, timestamp, requestId, method: 'POST', path: HOME_SESSION_VERIFY_PATH, body });
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetchImpl(new URL(HOME_SESSION_VERIFY_PATH, config.baseUrl), {
      method: 'POST', redirect: 'error', signal: controller.signal,
      headers: { 'content-type': 'application/json', 'x-2j-key-id': config.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, body,
    });
    if (response.status === 401) { remember(null, MAX_CAPABILITY_CACHE_MS); return null; }   // Platform says: not a live session
    if (response.status !== 200) { log.error?.(`home session: platform answered ${response.status}`); return null; }
    const parsed = responseSchema.safeParse(await response.json().catch(() => null));
    const expiresAt = parsed.success ? Date.parse(parsed.data.expiresAt) : NaN;
    if (!parsed.success || !Number.isFinite(expiresAt) || expiresAt <= t) { log.error?.('home session: unusable platform response'); return null; }
    const session = { uid: parsed.data.trainingUserId ?? null, personId: parsed.data.personId, expiresAt };
    remember(session, expiresAt - t);
    return session;
  } catch (error) {
    log.error?.(`home session: platform unreachable (${error?.name === 'AbortError' ? 'timeout' : 'network'})`);   // never the error message: it may echo the request
    return null;
  } finally { clearTimeout(timer); }
}
