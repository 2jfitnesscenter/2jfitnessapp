// F9b · 2J Hub bridge end to end: a fake Platform that follows 2JHub docs/contracts/platform-training-v2.md (F9a) + the real Training server.
// Flow: provisioning -> Home form -> redemption -> capabilities -> Training session; then security, gates, staff and the "everything off" regression.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

const DIR = tempData();
const SECRET = 'a'.repeat(64);
const { signHubRequest } = await import('../platform-hub/service-auth.js');
const { baselineCapabilities } = await import('../platform-sso/capabilities.js');
const API_ROOT = path.resolve('.');
const HOME = 'http://127.0.0.1:5173';

/* ------------------------------------------------------------------ fake Platform (F9a contract) */
const outbound = { keyId: 'bunker-out-1', secret: Buffer.alloc(32, 0x21) };     // Training -> Platform (Platform's TRAINING_SERVICE_KEYS)
const inbound = { keyId: 'platform-out-1', secret: Buffer.alloc(32, 0x42) };    // Platform -> Training (our PLATFORM_HUB_INBOUND_KEYS)
const CAP_RE = /^\/api\/internal\/platform\/v2\/persons\/([0-9a-f-]{36})\/training-capabilities$/;
function caps({ personId, trainingUserId, kind }) {
  const base = baselineCapabilities(), none = Object.fromEntries(Object.keys(base).map(n => [n, false])), all = Object.fromEntries(Object.keys(base).map(n => [n, true]));
  const auto = { ...base, routineCreation: true, guidedTraining: true, premiumPrograms: true };
  const t = {
    baseline: ['baseline', 'baseline', 'FREE_BASELINE', base], autonomous: ['autonomous', 'active', 'ACTIVE_AUTONOMOUS', auto],
    provisional: ['autonomous', 'provisional', 'PROVISIONAL_AUTONOMOUS', auto], full: ['full', 'active', 'ACTIVE_FULL', all],
    suspended: ['blocked', 'suspended', 'ADMIN_SUSPENDED', none], revoked: ['blocked', 'ended', 'TRAINING_LINK_REVOKED', none],
  }[kind];
  const now = Date.now();
  return {
    contract: '2J-CAPABILITIES-V2', version: 2, personId,
    trainingSubject: kind === 'revoked' ? { linkStatus: 'revoked' } : { linkStatus: 'active', trainingUserId },
    capabilityLevel: t[0], accessState: t[1], reasonCode: t[2], capabilities: t[3], suspensionStatus: kind === 'suspended' ? 'suspended' : 'none',
    effectiveFrom: null, expiresAt: new Date(now + 60_000).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true },
  };
}
function startPlatform() {
  const state = { subjects: new Map(), codes: new Map(), redeems: 0, delayMs: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', async () => {
      const body = Buffer.concat(chunks), h = n => req.headers[n];
      const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); };
      const { signature } = signHubRequest({ keyId: outbound.keyId, secret: outbound.secret, timestamp: h('x-2j-timestamp') || '', requestId: h('x-2j-request-id') || '', method: req.method, target: req.url, body });
      if (h('x-2j-key-id') !== outbound.keyId || h('x-2j-signature') !== signature || Math.abs(Date.now() - Date.parse(h('x-2j-timestamp'))) > 30_000) return reply(401, { error: 'SERVICE_AUTH_INVALID' });
      const cap = req.method === 'GET' && CAP_RE.exec(req.url);
      if (cap) { const s = state.subjects.get(cap[1]); return s ? reply(200, caps({ personId: cap[1], ...s })) : reply(404, { error: 'not_found' }); }
      if (req.method === 'POST' && req.url === '/api/internal/platform/v2/training-sso/redeem') {
        let r;
        try { r = JSON.parse(body.toString('utf8')); } catch { return reply(400, { error: 'BAD' }); }
        const keys = Object.keys(r).sort().join(',');
        if (keys !== 'audience,code,correlationId,destination,v' || r.v !== 1 || r.audience !== '2j-training' || r.destination !== 'bunker') return reply(400, { error: 'VALIDATION' });
        state.redeems++;
        const entry = state.codes.get(r.code);
        if (entry?.down) return reply(503, { error: 'UNAVAILABLE' });
        if (!entry || entry.used || entry.expired) return reply(403, { error: 'SSO_REJECTED' });
        entry.used = true;                                              // atomic: same tick, before any await
        if (state.delayMs) await new Promise(resolve => setTimeout(resolve, state.delayMs));
        if (entry.correlationId !== r.correlationId) return reply(403, { error: 'SSO_REJECTED' });
        return reply(200, { v: 1, issuer: '2j-platform', audience: '2j-training', personId: entry.personId, trainingUserId: entry.trainingUserId, linkStatus: 'active', displayName: entry.displayName ?? 'Ana Socia', assurance: 'platform_sso', correlationId: entry.answerCorrelationId ?? r.correlationId, ...(entry.extra ?? {}) });
      }
      reply(404, { error: 'not_found' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ state, server, port: server.address().port })));
}

/* ------------------------------------------------------------------ Training under test */
const P = Object.fromEntries(['prov', 'leg', 'taken', 'fubasic', 'fufull', 'staff', 'envadm', 'susp', 'other'].map(n => [n, randomUUID()]));
const dbFile = path.join(DIR, 'db.json');
const linked = (id, personId, extra = {}) => ({ id, name: `Member ${id}`, username: id, personId, platformLink: { personId, state: 'active', origin: 'platform_admin' }, ...extra });
fs.writeFileSync(dbFile, JSON.stringify({
  users: [
    { id: 'u-leg', name: 'Legacy Member', username: 'legacy' },
    { id: 'u-free', name: 'Free Member', username: 'free' },
    linked('u-taken', P.taken),
    linked('u-fubasic', P.fubasic, { platformEnforcement: 'enforced' }),
    linked('u-fufull', P.fufull, { platformEnforcement: 'enforced' }),
    linked('u-susp', P.susp, { platformEnforcement: 'enforced' }),
    { ...linked('u-staff', P.staff), name: 'Coach', admin: true, trainer: true },
    { id: 'u-envadm', name: 'Env admin', username: 'envadm' },
  ],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const platform = await startPlatform();
const freePort = () => new Promise(resolve => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
async function startTraining(extraEnv = {}) {
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: API_ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: DIR, SECRET_FILE: path.join(DIR, 'secret'), RP_ID: 'localhost', ORIGIN: base, ...extraEnv }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  return { base, port, stop: () => child.kill() };
}
const ON = {
  PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_DIRECTORY_ENABLED: 'true', PLATFORM_PROVISIONING_ENABLED: 'true', PLATFORM_ENFORCEMENT_ENABLED: 'true',
  PLATFORM_HOME_URL: HOME, PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
  PLATFORM_HUB_INBOUND_KEYS: JSON.stringify({ [inbound.keyId]: inbound.secret.toString('base64url') }), ADMIN_UIDS: 'u-envadm', PLATFORM_BREAKER_BASE_MS: '200',
};
const bunker = await startTraining(ON);
after(() => { bunker.stop(); platform.server.close(); });

/* ------------------------------------------------------------------ helpers */
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
const FORM = { 'content-type': 'application/x-www-form-urlencoded', origin: HOME };
const code = () => crypto.randomBytes(32).toString('base64url');
function issue(personId, trainingUserId, extra = {}) {
  const c = code(), correlationId = randomUUID();
  platform.state.codes.set(c, { personId, trainingUserId, correlationId, ...extra });
  return { code: c, correlationId };
}
const receive = (fields, headers = FORM) => raw(bunker, 'POST', '/api/platform/v1/sso/receive', { headers, body: new URLSearchParams(fields).toString() });
const ssoCookie = res => (res.headers['set-cookie'] ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('gymsid='));
const passkeyCookie = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
const db = () => JSON.parse(fs.readFileSync(dbFile, 'utf8'));
const liveSso = uid => db().deviceSessions.filter(s => s.userId === uid && s.via === 'sso' && !s.revokedAt);
async function service(method, route, payload, { key = inbound, at = Date.now(), requestId = randomUUID(), tamper = false } = {}) {
  const body = payload === undefined ? '' : JSON.stringify(payload);
  const timestamp = new Date(at).toISOString();
  const { signature } = signHubRequest({ keyId: key.keyId, secret: key.secret, timestamp, requestId, method, target: route, body });
  return raw(bunker, method, route, { headers: { ...(payload === undefined ? {} : { 'content-type': 'application/json' }), 'x-2j-key-id': key.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': tamper ? 'A'.repeat(43) : signature }, body: body || undefined });
}
async function signIn(personId, uid, kind = 'baseline') {
  platform.state.subjects.set(personId, { trainingUserId: uid, kind });
  const r = await receive(issue(personId, uid));
  assert.equal(r.status, 303); assert.equal(r.headers.location, '/', `sign-in ${uid}: ${r.headers.location}`);
  return ssoCookie(r);
}

/* ------------------------------------------------------------------ demonstrable flow */
let provisioned;
test('flow: automatic provisioning -> Home form -> redemption -> capabilities -> a Training session of its own (platform_sso, never passkey)', async () => {
  const req = { v: 1, personId: P.prov, idempotencyKey: 'prov-key-0001-abcdef', correlationId: randomUUID() };
  const created = await service('POST', '/api/platform/v1/provision', req);
  assert.equal(created.status, 201);
  assert.deepEqual(Object.keys(created.json).sort(), ['correlationId', 'linkStatus', 'personId', 'status', 'trainingUserId', 'v']);
  assert.equal(created.json.status, 'created'); assert.equal(created.json.linkStatus, 'active'); assert.equal(created.json.correlationId, req.correlationId);
  provisioned = created.json.trainingUserId;
  const user = db().users.find(u => u.id === provisioned);
  assert.equal(user.platformEnforcement, 'enforced', 'born through Platform: enforced');
  assert.equal(user.personId, P.prov);

  platform.state.subjects.set(P.prov, { trainingUserId: provisioned, kind: 'autonomous' });
  const r = await receive(issue(P.prov, provisioned, { displayName: 'Ana Socia' }));
  assert.equal(r.status, 303); assert.equal(r.headers.location, '/');
  assert.equal(r.headers['cache-control'], 'no-store'); assert.equal(r.headers['referrer-policy'], 'no-referrer');
  const cookie = ssoCookie(r); assert.ok(cookie, 'a session cookie');
  const me = await raw(bunker, 'GET', '/api/me', { headers: { cookie } });
  assert.equal(me.status, 200); assert.equal(me.json.user.authLevel, 'sso'); assert.equal(me.json.user.name, 'Ana Socia', 'the placeholder name became the Platform display name');
  const records = liveSso(provisioned);
  assert.equal(records.length, 1); assert.equal(records[0].assurance, 'platform_sso');
  const level = await raw(bunker, 'GET', '/api/platform/v1/me/training-level', { headers: { cookie } });
  assert.deepEqual([level.json.level, level.json.sso, level.json.homeUrl, level.json.notice], ['autonomous', true, HOME, null]);
  assert.equal((await raw(bunker, 'GET', '/api/config')).json.platformBridge, true);
  assert.equal((await raw(bunker, 'GET', '/api/guided', { headers: { cookie } })).status !== 403, true, 'Autónomo reaches Entrena con 2J');
  assert.equal((await raw(bunker, 'POST', '/api/coach/plan', { headers: { cookie, 'content-type': 'application/json' }, body: '{}' })).json?.code, 'capability_required', 'but not the Coach');
});

test('provisioning is idempotent and never creates a second profile', async () => {
  const req = { v: 1, personId: P.prov, idempotencyKey: 'prov-key-0001-abcdef' };
  const first = db().users.length;
  const original = db().platformHubProvisioning['prov-key-0001-abcdef'];
  assert.ok(original);
  const same = await service('POST', '/api/platform/v1/provision', { ...req, correlationId: 'a-different-correlation' });
  assert.equal(same.status, 409, 'same key, different body -> 409');
  const otherKey = await service('POST', '/api/platform/v1/provision', { v: 1, personId: P.prov, idempotencyKey: 'prov-key-0002-abcdef', correlationId: 'c-2' });
  assert.deepEqual([otherKey.status, otherKey.json.status, otherKey.json.trainingUserId, otherKey.json.correlationId], [200, 'already_provisioned', provisioned, 'c-2']);
  const replayKey = await service('POST', '/api/platform/v1/provision', { v: 1, personId: P.prov, idempotencyKey: 'prov-key-0002-abcdef', correlationId: 'c-2' });
  assert.deepEqual([replayKey.status, replayKey.json.status, replayKey.json.trainingUserId], [200, 'already_provisioned', provisioned], 'a lost answer retried with the SAME key');
  assert.equal((await service('POST', '/api/platform/v1/provision', { v: 1, personId: P.taken, idempotencyKey: 'prov-key-0003-abcdef', correlationId: 'c-3' })).status, 409, 'a person already linked to an account');
  assert.equal(db().users.length, first, 'no new profile');
});

test('service auth on the new routes: unsigned, tampered, stale (±30 s), replayed, other key, outside schema', async () => {
  const route = '/api/internal/platform/v1/training-users?query=member';
  const ok = await service('GET', route);
  assert.equal(ok.status, 200); assert.ok(ok.json.items.length >= 3); assert.ok(ok.json.items.every(i => Object.keys(i).every(k => ['trainingUserId', 'displayName', 'username'].includes(k))));
  assert.equal(ok.json.items.some(i => i.trainingUserId === 'u-envadm'), false);
  const one = await service('GET', '/api/internal/platform/v1/training-users/u-leg');
  assert.deepEqual(one.json, { v: 1, user: { trainingUserId: 'u-leg', displayName: 'Legacy Member', username: 'legacy' } });
  assert.equal((await service('GET', '/api/internal/platform/v1/training-users/nobody')).status, 404);
  assert.equal((await raw(bunker, 'GET', route)).status, 401);
  assert.equal((await service('GET', route, undefined, { tamper: true })).status, 401);
  assert.equal((await service('GET', route, undefined, { at: Date.now() - 31_000 })).status, 401);
  assert.equal((await service('GET', route, undefined, { at: Date.now() + 31_000 })).status, 401);
  const requestId = randomUUID();
  assert.equal((await service('GET', route, undefined, { requestId })).status, 200);
  assert.equal((await service('GET', route, undefined, { requestId })).status, 401, 'replay');
  assert.equal((await service('GET', route, undefined, { key: { keyId: 'stranger', secret: Buffer.alloc(32, 1) } })).status, 401);
  assert.equal((await service('GET', '/api/internal/platform/v1/training-users?query=a')).status, 400);
  assert.equal((await service('POST', '/api/platform/v1/provision', { v: 1, personId: 'nope', idempotencyKey: 'short', correlationId: 'c' })).status, 400);
  assert.equal((await service('POST', '/api/platform/v1/provision', { v: 1, personId: randomUUID(), idempotencyKey: 'prov-key-0009-abcdef', correlationId: 'c', displayName: 'PII' })).status, 400, 'strict: no extra fields');
});

/* ------------------------------------------------------------------ receiver security */
test('receiver: provenance and form shape are checked before anything is redeemed', async () => {
  const before = platform.state.redeems;
  const f = issue(P.prov, provisioned);
  for (const [why, headers] of [
    ['other origin', { ...FORM, origin: 'https://evil.example' }],
    ['null origin from fetch()', { ...FORM, origin: 'null', 'sec-fetch-mode': 'cors', 'sec-fetch-dest': 'empty' }],
    ['json body', { ...FORM, 'content-type': 'application/json' }],
  ]) {
    const r = await receive(f, headers);
    assert.equal(r.status, 303, why); assert.equal(r.headers.location, '/sso#error=denied', why); assert.equal(ssoCookie(r), undefined, why);
  }
  assert.equal((await receive({ ...f, extra: '1' })).headers.location, '/sso#error=denied', 'exactly two fields');
  assert.equal((await receive({ code: 'short', correlationId: f.correlationId })).headers.location, '/sso#error=denied');
  assert.equal(platform.state.redeems, before, 'nothing reached Platform');
  const nullOrigin = await receive(f, { 'content-type': 'application/x-www-form-urlencoded', origin: 'null', 'sec-fetch-site': 'cross-site', 'sec-fetch-mode': 'navigate', 'sec-fetch-dest': 'document' });
  assert.equal(nullOrigin.headers.location, '/', 'referrerpolicy=no-referrer navigation (Origin: null) from Home is accepted (see risk R1)');
});

test('receiver: code used, altered or expired; correlationId, issuer, audience or person mismatched -> generic error, no session, data intact', async () => {
  platform.state.subjects.set(P.prov, { trainingUserId: provisioned, kind: 'autonomous' });
  const snapshot = JSON.stringify(db().users);
  const used = issue(P.prov, provisioned);
  assert.equal((await receive(used)).headers.location, '/');
  const cases = [
    ['used', used],
    ['altered', { code: used.code.slice(0, -2) + 'AA', correlationId: used.correlationId }],
    ['expired', issue(P.prov, provisioned, { expired: true })],
    ['correlation sent differs', { ...issue(P.prov, provisioned), correlationId: randomUUID() }],
    ['correlation answered differs', issue(P.prov, provisioned, { answerCorrelationId: randomUUID() })],
    ['issuer', issue(P.prov, provisioned, { extra: { issuer: 'evil' } })],
    ['audience', issue(P.prov, provisioned, { extra: { audience: '2j-training-sso' } })],
    ['assurance passkey', issue(P.prov, provisioned, { extra: { assurance: 'passkey' } })],
    ['unknown field', issue(P.prov, provisioned, { extra: { capabilities: {} } })],
    ['unknown Training user', issue(P.prov, 'u-nobody')],
    ['person of another Training user', issue(P.prov, 'u-leg')],
    ['person already linked elsewhere', issue(P.taken, 'u-free')],
    ['environment administrator', issue(randomUUID(), 'u-envadm')],
  ];
  for (const [why, fields] of cases) {
    const r = await receive(fields);
    assert.equal(r.status, 303, why); assert.equal(r.headers.location, '/sso#error=denied', why); assert.equal(ssoCookie(r), undefined, why);
  }
  const after = JSON.parse(JSON.stringify(db().users)).map(u => { delete u.platformRestriction; return u; });
  assert.deepEqual(after.map(u => [u.id, u.personId ?? null, u.platformLink?.state ?? null]), JSON.parse(snapshot).map(u => [u.id, u.personId ?? null, u.platformLink?.state ?? null]), 'no link changed by a failure');
});

test('receiver: suspended, revoked or inconsistent capabilities never open a session; Platform down -> unavailable', async () => {
  for (const kind of ['suspended', 'revoked']) {
    platform.state.subjects.set(P.susp, { trainingUserId: 'u-susp', kind });
    const r = await receive(issue(P.susp, 'u-susp'));
    assert.equal(r.headers.location, '/sso#error=denied', kind); assert.equal(ssoCookie(r), undefined, kind);
  }
  platform.state.subjects.set(P.susp, { trainingUserId: 'u-other', kind: 'baseline' });     // capabilities about another Training user
  assert.equal((await receive(issue(P.susp, 'u-susp'))).headers.location, '/sso#error=denied');
  platform.state.subjects.delete(P.susp);                                                       // Platform does not know the person (404)
  assert.equal((await receive(issue(P.susp, 'u-susp'))).headers.location, '/sso#error=denied');
  const down = await receive(issue(P.susp, 'u-susp', { down: true }));
  assert.equal(down.headers.location, '/sso#error=unavailable'); assert.equal(ssoCookie(down), undefined);
  assert.equal(liveSso('u-susp').length, 0);
  assert.equal(db().users.find(u => u.id === 'u-susp').platformLink.state, 'active', 'a suspension never touches the link or the data');
});

test('two redemptions at the same time: at most one session', async () => {
  platform.state.subjects.set(P.prov, { trainingUserId: provisioned, kind: 'autonomous' });
  const f = issue(P.prov, provisioned);
  platform.state.delayMs = 150;
  const [a, b] = await Promise.all([receive(f), receive(f)]);
  platform.state.delayMs = 0;
  const cookies = [a, b].map(ssoCookie).filter(Boolean);
  assert.equal(cookies.length, 1, 'one code, one session');
  assert.equal(liveSso(provisioned).length, 1);
  const two = await Promise.all([receive(issue(P.prov, provisioned)), receive(issue(P.prov, provisioned))]);
  assert.equal(two.filter(ssoCookie).length, 2);
  assert.equal(liveSso(provisioned).length, 1, 'two codes: still one live session per person');
});

test('existing users: a legacy account is linked by the signed redemption (adoption), keeps legacy mode; another account session is never replaced', async () => {
  const cookie = await signIn(P.leg, 'u-leg', 'baseline');
  const user = db().users.find(u => u.id === 'u-leg');
  assert.deepEqual([user.personId, user.platformLink.state, user.platformLink.origin, user.platformEnforcement ?? 'legacy'], [P.leg, 'active', 'platform_admin', 'legacy']);
  assert.ok(cookie);
  const other = await receive(issue(P.leg, 'u-leg'), { ...FORM, cookie: passkeyCookie('u-free') });
  assert.equal(other.headers.location, '/sso#error=switch'); assert.equal(ssoCookie(other), undefined);
  const same = await receive(issue(P.leg, 'u-leg'), { ...FORM, cookie: passkeyCookie('u-leg') });
  assert.equal(same.headers.location, '/'); assert.equal(ssoCookie(same), undefined, 'a passkey session of the same account is kept (stronger)');
});

test('platform_sso is never a passkey: every strong-reauth / passkey-only / staff operation refuses an sso session', async () => {
  const cookie = await signIn(P.prov, provisioned, 'full');
  const sensitive = [
    ['GET', '/api/me/passkeys'], ['POST', '/api/me/passkeys/options'], ['POST', '/api/me/passkeys/revoke'], ['POST', '/api/me/delete'], ['POST', '/api/me/delete/options'], ['GET', '/api/me/export'],
    ['POST', '/api/logout/all'], ['POST', '/api/me/sessions/revoke'], ['POST', '/api/link/approve'], ['POST', '/api/me/step-up'], ['POST', '/api/coach/forget'],
    ['GET', '/api/webhooks'], ['POST', '/api/strava/disconnect'], ['GET', '/api/bunker/pin'], ['GET', '/api/admin/ops'], ['GET', '/api/trainer/members'], ['POST', '/api/guided/save'],
    ['POST', '/api/admin/platform-enforcement'], ['GET', '/api/bunker/admin/sessions'],
  ];
  for (const [method, route] of sensitive) {
    const r = await raw(bunker, method, route, { headers: { cookie, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
    assert.equal(r.status, 403, `${method} ${route}`); assert.equal(r.json?.code, 'passkey_required', `${method} ${route}`);
  }
  const me = await raw(bunker, 'GET', '/api/me', { headers: { cookie } });
  assert.equal(me.json.user.admin, false); assert.equal(me.json.user.trainer, false);
});

test('server-side gates per group (A–F) for a Basic member arriving by SSO: direct calls cannot bypass the UI', async () => {
  const cookie = await signIn(P.prov, provisioned, 'baseline');
  const call = (method, route) => raw(bunker, method, route, { headers: { cookie, 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
  assert.notEqual((await call('GET', '/api/data')).status, 403, 'A · own training stays open');
  assert.notEqual((await call('GET', '/api/sync')).status, 403, 'A · own sync (workoutHistory)');
  assert.notEqual((await call('GET', '/api/exercise-notes')).status, 403, 'A · own notes (autonomousTraining)');
  for (const [method, route, group] of [['GET', '/api/guided', 'C'], ['GET', '/api/premium', 'C'], ['GET', '/api/opposition', 'C'], ['POST', '/api/coach/plan', 'D'], ['GET', '/api/scan/status', 'D'], ['GET', '/api/followup', 'E'], ['GET', '/api/followup/records', 'E']]) {
    const r = await call(method, route);
    assert.equal(r.status, 403, `${group} ${route}`); assert.equal(r.json.code, 'capability_required', `${group} ${route}`);
  }
  assert.equal((await call('GET', '/api/trainer/members')).json.code, 'passkey_required', 'F · staff never reachable by sso');
  for (const route of ['/api/bunker/board', '/api/bunker/settings']) assert.notEqual((await call('GET', route)).json?.code, 'capability_required', `${route} is kiosk, not under a global gate`);
  const level = await raw(bunker, 'GET', '/api/platform/v1/me/training-level', { headers: { cookie } });
  assert.equal(level.json.level, 'baseline');
});

test('fee pending in grace (provisional): full level kept, notice shown, nothing blocked', async () => {
  const cookie = await signIn(P.prov, provisioned, 'provisional');
  const level = await raw(bunker, 'GET', '/api/platform/v1/me/training-level', { headers: { cookie } });
  assert.deepEqual([level.json.level, level.json.accessState, level.json.notice], ['autonomous', 'provisional', 'PAYMENT_PENDING']);
  assert.notEqual((await raw(bunker, 'GET', '/api/guided', { headers: { cookie } })).status, 403);
});

test('staff keep their role guards and never use their own right; acting FOR a member needs the member\'s professionalFollowUp', async () => {
  platform.state.subjects.set(P.staff, { trainingUserId: 'u-staff', kind: 'baseline' });          // the coach's own plan is Basic: irrelevant
  platform.state.subjects.set(P.fubasic, { trainingUserId: 'u-fubasic', kind: 'baseline' });
  platform.state.subjects.set(P.fufull, { trainingUserId: 'u-fufull', kind: 'full' });
  const cookie = passkeyCookie('u-staff');
  const start = id => raw(bunker, 'POST', '/api/trainer/followup/start', { headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ id }) });
  const basic = await start('u-fubasic');
  assert.equal(basic.status, 403); assert.equal(basic.json.code, 'member_capability_required');
  const full = await start('u-fufull');
  assert.equal(full.status, 200, JSON.stringify(full.json));
  const legacyMember = await start('u-free');
  assert.notEqual(legacyMember.json?.code, 'member_capability_required', 'legacy members are untouched');
  assert.equal((await raw(bunker, 'POST', '/api/trainer/followup/start', { headers: { cookie: passkeyCookie('u-free'), 'content-type': 'application/json' }, body: JSON.stringify({ id: 'u-fufull' }) })).status, 403, 'a member is not staff, whatever their plan');
});

/* ------------------------------------------------------------------ everything off */
test('regression: with every switch off nothing new answers and existing responses are unchanged', async () => {
  const plain = await startTraining({});
  try {
    for (const [method, route] of [['POST', '/api/platform/v1/sso/receive'], ['GET', '/api/platform/v1/me/training-level'], ['GET', '/api/internal/platform/v1/training-users?query=member'], ['GET', '/api/internal/platform/v1/training-users/u-leg']]) {
      const r = await raw(plain, method, route, { headers: method === 'POST' ? FORM : {}, body: method === 'POST' ? 'code=x&correlationId=y' : undefined });
      assert.deepEqual([r.status, r.json], [404, { error: 'no encontrado' }], `${method} ${route}`);
    }
    const config = await raw(plain, 'GET', '/api/config');
    assert.equal('platformBridge' in config.json, false);
    const legacyProvision = await raw(plain, 'POST', '/api/platform/v1/provision', { headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.deepEqual([legacyProvision.status, legacyProvision.json], [423, { error: 'platform_link_disabled' }], 'the old provisioning answer, unchanged');
    // Bridge on but enforcement off: the staff-for-member gate does not exist.
    const noEnforcement = await startTraining({ ...ON, PLATFORM_ENFORCEMENT_ENABLED: 'false' });
    try {
      const r = await raw(noEnforcement, 'POST', '/api/trainer/followup/start', { headers: { cookie: passkeyCookie('u-staff'), 'content-type': 'application/json' }, body: JSON.stringify({ id: 'u-fubasic' }) });
      assert.notEqual(r.json?.code, 'member_capability_required');
    } finally { noEnforcement.stop(); }
  } finally { plain.stop(); }
});
