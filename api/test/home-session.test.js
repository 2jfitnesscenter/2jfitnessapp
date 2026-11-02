import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveHomeSession, HOME_SESSION_COOKIE } from '../platform-sso/home-session.js';
import crypto from 'node:crypto';

const SECRET = crypto.randomBytes(32).toString('base64url');
const COOKIE = 'A'.repeat(43);
const config = { baseUrl: 'http://127.0.0.1:9', keyId: 'bunker-1', secret: Buffer.from(SECRET, 'base64url') };
const PERSON = '11111111-1111-4111-8111-111111111111';

function setup({ status = 200, body, throws = false } = {}) {
  let clock = Date.parse('2026-11-02T10:00:00Z');
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (throws) throw new Error('boom ' + COOKIE);
    const payload = body ?? { personId: PERSON, trainingUserId: 'u1', expiresAt: new Date(clock + 3_600_000).toISOString() };
    return { status, json: async () => payload };
  };
  const logs = [];
  const deps = { config, fetchImpl, now: () => clock, cache: new Map(), log: { error: (...a) => logs.push(a.join(' ')) } };
  return { deps, calls, logs, advance: ms => { clock += ms; } };
}
const header = `other=1; ${HOME_SESSION_COOKIE}=${COOKIE}; gymsid=zzz`;

test('no 2j_member cookie: null and Platform is not called (gymsid is ignored)', async () => {
  const s = setup();
  assert.equal(await resolveHomeSession(undefined, s.deps), null);
  assert.equal(await resolveHomeSession('gymsid=abc', s.deps), null);
  assert.equal(s.calls.length, 0);
});

test('valid cookie: returns uid/personId/expiresAt and sends a signed POST without the cookie in headers', async () => {
  const s = setup();
  const r = await resolveHomeSession(header, s.deps);
  assert.equal(r.personId, PERSON);
  assert.equal(r.uid, 'u1');
  assert.equal(typeof r.expiresAt, 'number');
  const { url, init } = s.calls[0];
  assert.ok(url.endsWith('/api/internal/platform/v2/member-session/verify'));
  assert.equal(JSON.parse(init.body.toString()).cookie, COOKIE);
  assert.ok(!JSON.stringify(init.headers).includes(COOKIE));
  assert.ok(init.headers['x-2j-signature'].length === 43);
});

test('null uid when the person has no active Training link', async () => {
  const s = setup({ body: { personId: PERSON, trainingUserId: null, expiresAt: '2026-11-02T11:00:00.000Z' } });
  assert.equal((await resolveHomeSession(header, s.deps)).uid, null);
});

test('two consecutive calls hit fetch once; after 60001 ms a second time', async () => {
  const s = setup();
  await resolveHomeSession(header, s.deps);
  await resolveHomeSession(header, s.deps);
  assert.equal(s.calls.length, 1);
  s.advance(60_001);
  await resolveHomeSession(header, s.deps);
  assert.equal(s.calls.length, 2);
});

test('cache key is a hash, never the raw cookie', async () => {
  const s = setup();
  await resolveHomeSession(header, s.deps);
  for (const k of s.deps.cache.keys()) assert.ok(!String(k).includes(COOKIE));
});

test('401 from Platform: null (cached briefly as invalid)', async () => {
  const s = setup({ status: 401, body: { error: 'session_invalid' } });
  assert.equal(await resolveHomeSession(header, s.deps), null);
  assert.equal(await resolveHomeSession(header, s.deps), null);
  assert.equal(s.calls.length, 1);
});

test('network error or bad payload: null, logged without secrets, not cached', async () => {
  const s = setup({ throws: true });
  assert.equal(await resolveHomeSession(header, s.deps), null);
  assert.equal(await resolveHomeSession(header, s.deps), null);
  assert.equal(s.calls.length, 2);
  assert.ok(s.logs.length >= 1);
  assert.ok(!s.logs.join('\n').includes(COOKIE));
  const bad = setup({ body: { nope: 1 } });
  assert.equal(await resolveHomeSession(header, bad.deps), null);
});

test('not configured: null without calling', async () => {
  const s = setup();
  assert.equal(await resolveHomeSession(header, { ...s.deps, config: null }), null);
  assert.equal(s.calls.length, 0);
});
