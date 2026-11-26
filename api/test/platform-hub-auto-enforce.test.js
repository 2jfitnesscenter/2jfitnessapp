// F9q · 2J Hub decision H-129: a member linked BY HAND from Admin joins the capability gates by themselves on their first Home SSO sign-in
// (legacy -> enforced, no manual step, no emergency account). Attack test: once suspended in Platform, the session they ALREADY had open gets
// 403 platform_access_blocked on their data (sync / history, chat, follow-up) and on writes, in well under a minute (H-127).
// A fake Platform that follows 2JHub docs/contracts/platform-training-v2.md + the real Training server, like platform-hub.test.js.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

const SECRET = 'a'.repeat(64);
const { signHubRequest } = await import('../platform-hub/service-auth.js');
const { baselineCapabilities } = await import('../platform-sso/capabilities.js');
const API_ROOT = path.resolve('.');
const HOME = 'http://127.0.0.1:5173';
const outbound = { keyId: 'bunker-out-1', secret: Buffer.alloc(32, 0x21) };
const CAP_RE = /^\/api\/internal\/platform\/v2\/persons\/([0-9a-f-]{36})\/training-capabilities$/;
/** How long Platform lets an answer be cached. Short, so "suspended" reaches the open session quickly in the test (production: up to 60 s). */
const TTL_MS = 1500;

function caps({ personId, trainingUserId, kind }) {
  const base = baselineCapabilities(), none = Object.fromEntries(Object.keys(base).map(n => [n, false]));
  const suspended = kind === 'suspended', now = Date.now();
  return {
    contract: '2J-CAPABILITIES-V2', version: 2, personId, trainingSubject: { linkStatus: 'active', trainingUserId },
    capabilityLevel: suspended ? 'blocked' : 'baseline', accessState: suspended ? 'suspended' : 'baseline', reasonCode: suspended ? 'ADMIN_SUSPENDED' : 'FREE_BASELINE',
    capabilities: suspended ? none : base, suspensionStatus: suspended ? 'suspended' : 'none',
    effectiveFrom: null, expiresAt: new Date(now + TTL_MS).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true },
  };
}
function startPlatform() {
  const state = { subjects: new Map(), codes: new Map() };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks), h = n => req.headers[n];
      const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); };
      const { signature } = signHubRequest({ keyId: outbound.keyId, secret: outbound.secret, timestamp: h('x-2j-timestamp') || '', requestId: h('x-2j-request-id') || '', method: req.method, target: req.url, body });
      if (h('x-2j-key-id') !== outbound.keyId || h('x-2j-signature') !== signature) return reply(401, { error: 'SERVICE_AUTH_INVALID' });
      const cap = req.method === 'GET' && CAP_RE.exec(req.url);
      if (cap) { const s = state.subjects.get(cap[1]); return s ? reply(200, caps({ personId: cap[1], ...s })) : reply(404, { error: 'not_found' }); }
      if (req.method === 'POST' && req.url === '/api/internal/platform/v2/training-sso/redeem') {
        const r = JSON.parse(body.toString('utf8')), entry = state.codes.get(r.code);
        if (!entry || entry.used || entry.correlationId !== r.correlationId) return reply(403, { error: 'SSO_REJECTED' });
        entry.used = true;
        return reply(200, { v: 1, issuer: '2j-platform', audience: '2j-training', personId: entry.personId, trainingUserId: entry.trainingUserId, linkStatus: 'active', displayName: 'Ana Socia', assurance: 'platform_sso', correlationId: r.correlationId });
      }
      reply(404, { error: 'not_found' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ state, server, port: server.address().port })));
}

const platform = await startPlatform();
const freePort = () => new Promise(resolve => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
const live = new Set();
after(() => { for (const child of live) child.kill(); platform.server.close(); });

/** One Training server with its own data: the members of the scenario, all with a routine of their own to read. */
const P = Object.fromEntries(['hand', 'old', 'shadow', 'off'].map(n => [n, randomUUID()]));
const adopted = (id, personId, extra = {}) => ({ id, name: `Member ${id}`, username: id, personId, platformLink: { personId, state: 'active', origin: 'platform_admin' }, ...extra });
async function startTraining(enforcement) {
  const dir = tempData(), dbFile = path.join(dir, 'db.json');
  fs.writeFileSync(dbFile, JSON.stringify({
    users: [
      { id: 'u-hand', name: 'Linked by hand today', username: 'hand' },   // Admin has just linked them in Platform; Training does not know yet
      adopted('u-old', P.old),                                           // linked by hand before this change: still `legacy`
      adopted('u-shadow', P.shadow, { platformEnforcement: 'shadow' }),   // an administrator chose `shadow`: it is kept
      { id: 'u-off', name: 'Switch off', username: 'off' },
    ],
    creds: [], subs: [], invites: [], recoveries: [],
  }, null, 2));
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_ROOT, stdio: 'ignore', windowsHide: true,
    env: {
      ...process.env, PORT: String(port), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base,
      PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_ENFORCEMENT_ENABLED: enforcement,
      PLATFORM_HOME_URL: HOME, PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
    },
  });
  live.add(child);
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  const db = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
  return { base, db, user: id => db().users.find(u => u.id === id), stop: () => new Promise(r => { live.delete(child); child.once('exit', r); child.kill(); }) };
}

function raw(server, method, route, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(server.base + route, { method, headers }, res => {
      const chunks = []; res.on('data', c => chunks.push(c));
      res.on('end', () => { const text = Buffer.concat(chunks).toString('utf8'); let json = null; try { json = JSON.parse(text); } catch { /* not json */ } resolve({ status: res.statusCode, headers: res.headers, json, text }); });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}
/** What Home's auto-submitted form does: a one-use code from Platform, POSTed with Home's exact Origin. */
async function signIn(server, personId, uid, kind = 'baseline') {
  platform.state.subjects.set(personId, { trainingUserId: uid, kind });
  const code = crypto.randomBytes(32).toString('base64url'), correlationId = randomUUID();
  platform.state.codes.set(code, { personId, trainingUserId: uid, correlationId });
  const r = await raw(server, 'POST', '/api/platform/v1/sso/receive', { headers: { 'content-type': 'application/x-www-form-urlencoded', origin: HOME }, body: new URLSearchParams({ code, correlationId }).toString() });
  return { status: r.status, location: r.headers.location, cookie: (r.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('gymsid=')) };
}
const as = (server, cookie, method, route, body) => raw(server, method, route, { headers: { cookie, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const events = (server, type) => (server.db().securityEvents ?? server.db().events ?? []).filter(e => e.event === type);
/** The member's own data: state + history (sync), chat and the professional follow-up. */
const READS = uid => [`/api/sync?owner=${uid}`, '/api/chat/threads'];
/** Also closed once suspended (the Básico level never had it, so it is only checked on the blocked side). */
const FOLLOW_UP = '/api/followup';

const on = await startTraining('true');

test('H-129: linked by hand from Admin -> `enforced` by themselves on the first Home SSO sign-in (nothing manual)', async () => {
  assert.equal(on.user('u-hand').platformEnforcement, undefined, 'starts as a plain legacy account');
  const s = await signIn(on, P.hand, 'u-hand');
  assert.equal(s.status, 303); assert.equal(s.location, '/'); assert.ok(s.cookie, 'a Training session of its own');
  const user = on.user('u-hand');
  assert.equal(user.personId, P.hand);
  assert.deepEqual({ state: user.platformLink.state, origin: user.platformLink.origin }, { state: 'active', origin: 'platform_admin' });
  assert.equal(user.platformEnforcement, 'enforced');
  // While in good standing nothing is taken away: they read and write as before.
  for (const route of READS('u-hand')) assert.equal((await as(on, s.cookie, 'GET', route)).status, 200, route);
});

test('ATTACK (H-127): suspended in Platform with the session ALREADY open -> 403 platform_access_blocked on sync/history, chat and follow-up, and on writes', async () => {
  const s = await signIn(on, P.hand, 'u-hand');
  for (const route of READS('u-hand')) assert.equal((await as(on, s.cookie, 'GET', route)).status, 200, `before: ${route}`);

  // Administration suspends the member in Platform. Nobody touches Training: no admin action, no emergency account, no new sign-in.
  platform.state.subjects.set(P.hand, { trainingUserId: 'u-hand', kind: 'suspended' });
  const t0 = Date.now();
  let blocked = null;
  while (Date.now() - t0 < 10_000) {
    const r = await as(on, s.cookie, 'GET', `/api/sync?owner=u-hand`);
    if (r.status === 403) { blocked = r; break; }
    await new Promise(r2 => setTimeout(r2, 200));
  }
  assert.ok(blocked, 'the open session must stop reading once the cached answer expires');
  assert.ok(Date.now() - t0 < TTL_MS + 3000, `blocked ${Date.now() - t0} ms after the suspension (the cache lifetime, never more)`);
  assert.equal(blocked.json.code, 'platform_access_blocked'); assert.equal(blocked.json.reasonCode, 'ADMIN_SUSPENDED');
  for (const route of READS('u-hand')) {
    const r = await as(on, s.cookie, 'GET', route);
    assert.equal(r.status, 403, route); assert.equal(r.json.code, 'platform_access_blocked', route);
  }
  const followUp = await as(on, s.cookie, 'GET', FOLLOW_UP);
  assert.equal(followUp.status, 403); assert.equal(followUp.json.code, 'platform_access_blocked');
  const write = await as(on, s.cookie, 'POST', '/api/sync', {});
  assert.equal(write.status, 403); assert.equal(write.json.code, 'platform_access_blocked');
  // And a new sign-in from Home is refused too (as before).
  const again = await signIn(on, P.hand, 'u-hand', 'suspended');
  assert.equal(again.cookie, undefined); assert.notEqual(again.location, '/');

  // Suspension lifted in Platform: the same account comes back by itself.
  const back = await signIn(on, P.hand, 'u-hand', 'baseline');
  assert.ok(back.cookie);
  assert.equal((await as(on, back.cookie, 'GET', '/api/sync?owner=u-hand')).status, 200);
  assert.equal(on.user('u-hand').platformEnforcement, 'enforced');
});

test('a member linked by hand BEFORE this change (still `legacy`) joins on their next Home SSO sign-in', async () => {
  assert.equal(on.user('u-old').platformEnforcement, undefined);
  const s = await signIn(on, P.old, 'u-old');
  assert.ok(s.cookie);
  assert.equal(on.user('u-old').platformEnforcement, 'enforced');
});

test('a `shadow` chosen by an administrator is a decision: the sign-in does not change it', async () => {
  const s = await signIn(on, P.shadow, 'u-shadow');
  assert.ok(s.cookie);
  assert.equal(on.user('u-shadow').platformEnforcement, 'shadow');
});

test('the audit says which members joined by themselves, and nothing else changed for the rest', async () => {
  const auto = events(on, 'platform_enforcement_auto');
  assert.deepEqual(auto.map(e => e.userId).sort(), ['u-hand', 'u-old']);
  for (const e of auto) assert.deepEqual(e.meta, { from: 'legacy', to: 'enforced', via: 'hub_sso' });
  assert.equal(on.user('u-off').platformEnforcement, undefined, 'an account without a Platform link is never touched');
});

test('POST /api/admin/platform-enforcement is untouched: a Platform SSO session still cannot use it', async () => {
  const s = await signIn(on, P.old, 'u-old');
  const r = await as(on, s.cookie, 'POST', '/api/admin/platform-enforcement', { userId: 'u-old', mode: 'shadow' });
  assert.ok(r.status === 401 || r.status === 403, `status ${r.status}`);
  assert.equal(on.user('u-old').platformEnforcement, 'enforced');
});

test('with PLATFORM_ENFORCEMENT_ENABLED off the sign-in writes no mode (everything as before)', async () => {
  const off = await startTraining('false');
  try {
    const s = await signIn(off, P.hand, 'u-hand');
    assert.ok(s.cookie, 'the SSO itself still works');
    assert.equal(off.user('u-hand').platformLink.state, 'active');
    assert.equal(off.user('u-hand').platformEnforcement, undefined);
    assert.equal(events(off, 'platform_enforcement_auto').length, 0);
    // Suspended with the switch off: not limited (documented rollback behaviour, F9l).
    platform.state.subjects.set(P.hand, { trainingUserId: 'u-hand', kind: 'suspended' });
    await new Promise(r => setTimeout(r, TTL_MS + 300));
    assert.equal((await as(off, s.cookie, 'GET', '/api/sync?owner=u-hand')).status, 200);
  } finally {
    platform.state.subjects.set(P.hand, { trainingUserId: 'u-hand', kind: 'baseline' });
    await off.stop();
  }
});
