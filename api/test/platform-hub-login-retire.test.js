// F9d · Passkeys for 2J Hub (contract §8 of 2JHub docs/contracts/platform-training-v2.md) and Búnker's own sign-in retired for linked
// MEMBERS, against the REAL Training server and a fake Platform. With every F9d switch off, everything answers exactly like F9c.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

const { signHubRequest } = await import('../platform-hub/service-auth.js');
const { baselineCapabilities } = await import('../platform-sso/capabilities.js');
const API_ROOT = path.resolve('.');
const HOME = 'http://127.0.0.1:5174';
const SECRET = 'c'.repeat(64);
const outbound = { keyId: 'bunker-out-d', secret: Buffer.alloc(32, 0x41) };   // Training -> Platform
const inbound = { keyId: 'platform-out-d', secret: Buffer.alloc(32, 0x62) };   // Platform -> Training
const b64u = b => Buffer.from(b).toString('base64url');

/* ------------------------------------------------------------------ fake Platform: redeem + capabilities */
const codes = new Map();
const platform = await new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks), h = n => req.headers[n];
      const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      const { signature } = signHubRequest({ keyId: outbound.keyId, secret: outbound.secret, timestamp: h('x-2j-timestamp') || '', requestId: h('x-2j-request-id') || '', method: req.method, target: req.url, body });
      if (h('x-2j-key-id') !== outbound.keyId || h('x-2j-signature') !== signature) return reply(401, { error: 'SERVICE_AUTH_INVALID' });
      const cap = /^\/api\/internal\/platform\/v2\/persons\/([0-9a-f-]{36})\/training-capabilities$/.exec(req.url);
      if (cap) {
        const entry = [...codes.values()].find(c => c.personId === cap[1]);
        const now = Date.now();
        return reply(200, { contract: '2J-CAPABILITIES-V2', version: 2, personId: cap[1], trainingSubject: { linkStatus: 'active', trainingUserId: entry?.trainingUserId }, capabilityLevel: 'baseline', accessState: 'baseline', reasonCode: 'FREE_BASELINE', capabilities: baselineCapabilities(), suspensionStatus: 'none', effectiveFrom: null, expiresAt: new Date(now + 60_000).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true } });
      }
      if (req.url === '/api/internal/platform/v2/training-sso/redeem') {
        const r = JSON.parse(body.toString('utf8'));
        const entry = codes.get(r.code);
        if (!entry || entry.used) return reply(403, { error: 'SSO_REJECTED' });
        entry.used = true;
        return reply(200, { v: 1, issuer: '2j-platform', audience: '2j-training', personId: entry.personId, trainingUserId: entry.trainingUserId, linkStatus: 'active', displayName: 'Ana', assurance: 'platform_sso', correlationId: r.correlationId });
      }
      reply(404, { error: 'not_found' });
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

/* ------------------------------------------------------------------ Training under test */
const keyOf = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([Buffer.from('a50102032620012158' + '20', 'hex'), Buffer.from(jwk.x, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y, 'base64url')]);
  return { privateKey, cose: b64u(cose) };
};
const K = { a: keyOf(), free: keyOf(), staff: keyOf(), env: keyOf() };
const P = { a: randomUUID(), staff: randomUUID(), env: randomUUID() };
const linked = (id, personId, extra = {}) => ({ id, name: `Member ${id}`, username: id.replace(/[^a-z]/g, ''), created: '2026-05-01T08:00:00.000Z', personId, platformLink: { personId, state: 'active', origin: 'platform_admin' }, ...extra });
const cred = (id, userId, key, extra = {}) => ({ id, userId, publicKey: key.cose, counter: 4, transports: ['internal', 'hybrid', 'weird'], name: 'iPhone', createdAt: '2026-06-01T10:00:00.000Z', ...extra });
function seed(dir) {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [linked('u-a', P.a), { id: 'u-free', name: 'Free', username: 'free' }, linked('u-staff', P.staff, { trainer: true }), linked('u-env', P.env)],
    creds: [cred('cred-a', 'u-a', K.a), cred('cred-a2', 'u-a', K.a, { name: undefined, createdAt: undefined, counter: -1 }), cred('cred-free', 'u-free', K.free), cred('cred-staff', 'u-staff', K.staff), cred('cred-env', 'u-env', K.env)],
    subs: [], invites: [], recoveries: [],
  }));
}
const freePort = () => new Promise(resolve => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
async function startTraining(extraEnv, dir = null) {
  if (!dir) { dir = tempData(); seed(dir); }
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: API_ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: 'u-env', ...extraEnv }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  return { base, dir, stop: () => new Promise(r => { child.once('exit', r); child.kill(); }) };
}
const BRIDGE = {
  PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_HOME_URL: HOME,
  PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
  PLATFORM_HUB_INBOUND_KEYS: JSON.stringify({ [inbound.keyId]: inbound.secret.toString('base64url') }),
};
const F9D = { PLATFORM_HUB_CREDENTIALS_ENABLED: 'true', PLATFORM_LOGIN_RETIRED: 'true' };
const on = await startTraining({ ...BRIDGE, ...F9D });
const off = await startTraining(BRIDGE);
const stopped = [];
after(async () => { await on.stop(); await off.stop(); for (const s of stopped) await s.stop(); platform.server.close(); });

async function service(t, method, route, { key = inbound, at = Date.now(), requestId = randomUUID() } = {}) {
  const timestamp = new Date(at).toISOString();
  const { signature } = signHubRequest({ keyId: key.keyId, secret: key.secret, timestamp, requestId, method, target: route, body: '' });
  const r = await fetch(t.base + route, { method, headers: { 'x-2j-key-id': key.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature } });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}
const credsPath = (uid, personId) => `/api/internal/platform/v1/training-users/${uid}/credentials?personId=${personId}`;
const readDb = t => JSON.parse(fs.readFileSync(path.join(t.dir, 'db.json'), 'utf8'));

/** The passkey sign-in exactly as the browser does it: options, then a real ES256 assertion. */
async function passkeyLogin(t, credId, key, counter) {
  const o = await (await fetch(t.base + '/api/login/options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  const authData = Buffer.concat([crypto.createHash('sha256').update('localhost').digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: o.options.challenge, origin: t.base, crossOrigin: false }));
  const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), key.privateKey);
  const credential = { id: credId, rawId: credId, type: 'public-key', response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(sig) }, clientExtensionResults: {} };
  const r = await fetch(t.base + '/api/login/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid: o.cid, credential }) });
  let data = null; try { data = await r.json(); } catch { /* none */ }
  return { status: r.status, data, cookie: r.headers.get('set-cookie') };
}
async function ssoEntry(t, personId, trainingUserId) {
  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(code, { personId, trainingUserId });
  const r = await fetch(t.base + '/api/platform/v1/sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code, correlationId: randomUUID() }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: HOME } });
  return { status: r.status, location: r.headers.get('location'), cookie: r.headers.get('set-cookie') };
}

/* ------------------------------------------------------------------ credentials (contract §8) */
test('credentials: only the PUBLIC parts of a linked member\'s passkeys, for THAT person; audited with a count', async () => {
  const r = await service(on, 'GET', credsPath('u-a', P.a));
  assert.equal(r.status, 200, JSON.stringify(r.json));
  assert.deepEqual(Object.keys(r.json).sort(), ['credentials', 'v']);
  assert.equal(r.json.credentials.length, 2);
  const [first, second] = r.json.credentials;
  assert.deepEqual(first, { credentialId: 'cred-a', publicKey: K.a.cose, counter: 4, transports: ['internal', 'hybrid'], createdAt: '2026-06-01T10:00:00.000Z', label: 'iPhone' });
  // Missing data is filled safely: no label, the account's creation time, counter 0.
  assert.deepEqual(second, { credentialId: 'cred-a2', publicKey: K.a.cose, counter: 0, transports: ['internal', 'hybrid'], createdAt: '2026-05-01T08:00:00.000Z' });
  const text = JSON.stringify(r.json);
  for (const secret of ['u-a', 'userId', 'userHandle', SECRET]) assert.equal(text.includes(secret), false, secret);
  const ev = readDb(on).securityEvents.filter(e => e.event === 'platform_hub_credentials_read' && e.userId === 'u-a');
  assert.equal(ev.length, 1); assert.equal(ev[0].meta.count, 2);
  assert.equal(JSON.stringify(ev).includes(K.a.cose), false);
  // Búnker's passkeys are untouched by a read.
  assert.equal(readDb(on).creds.filter(c => c.userId === 'u-a').length, 2);
});

test('credentials: other person, unlinked, staff, ADMIN_UIDS, unknown → 404; bad query → 400', async () => {
  assert.equal((await service(on, 'GET', credsPath('u-a', randomUUID()))).status, 404, 'linked to someone else');
  assert.equal((await service(on, 'GET', credsPath('u-free', randomUUID()))).status, 404, 'no link');
  assert.equal((await service(on, 'GET', credsPath('u-staff', P.staff))).status, 404, 'staff (F9e)');
  assert.equal((await service(on, 'GET', credsPath('u-env', P.env))).status, 404, 'ADMIN_UIDS');
  assert.equal((await service(on, 'GET', credsPath('u-nobody', P.a))).status, 404);
  assert.equal((await service(on, 'GET', '/api/internal/platform/v1/training-users/u-a/credentials')).status, 400, 'personId required');
  assert.equal((await service(on, 'GET', `${credsPath('u-a', P.a)}&extra=1`)).status, 400);
  assert.equal((await service(on, 'GET', credsPath('u-a', 'not-a-uuid'))).status, 400);
});

test('credentials: signature, replay, ±30 s, unknown key → generic 401', async () => {
  const route = credsPath('u-a', P.a);
  const requestId = randomUUID();
  assert.equal((await service(on, 'GET', route, { requestId })).status, 200);
  assert.equal((await service(on, 'GET', route, { requestId })).status, 401, 'replay');
  assert.equal((await service(on, 'GET', route, { at: Date.now() - 31_000 })).status, 401);
  assert.equal((await service(on, 'GET', route, { at: Date.now() + 31_000 })).status, 401);
  assert.equal((await service(on, 'GET', route, { key: { keyId: inbound.keyId, secret: Buffer.alloc(32, 1) } })).status, 401);
  // Signed for one person, asked for another.
  const timestamp = new Date().toISOString(), rid = randomUUID();
  const { signature } = signHubRequest({ keyId: inbound.keyId, secret: inbound.secret, timestamp, requestId: rid, method: 'GET', target: credsPath('u-a', randomUUID()), body: '' });
  const r = await fetch(on.base + route, { headers: { 'x-2j-key-id': inbound.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': rid, 'x-2j-signature': signature } });
  assert.equal(r.status, 401);
  const unsigned = await fetch(on.base + route);
  assert.equal(unsigned.status, 401);
});

/* ------------------------------------------------------------------ login retired for linked members */
test('retired: a linked member gets "Entra desde 2J Home" (no session) and enters by SSO from Home', async () => {
  const r = await passkeyLogin(on, 'cred-a', K.a, 10);
  assert.equal(r.status, 403);
  assert.deepEqual(r.data, { error: 'Entra desde 2J Home', code: 'login_retired', homeUrl: HOME });
  assert.equal(r.cookie, null, 'no session cookie');
  const ev = readDb(on).securityEvents.filter(e => e.event === 'platform_login_retired_refused' && e.userId === 'u-a');
  assert.equal(ev.length, 1); assert.equal(ev[0].meta.kind, 'passkey');
  // The SSO entry from Home still works and is the way in.
  const sso = await ssoEntry(on, P.a, 'u-a');
  assert.equal(sso.status, 303, sso.location);
  assert.equal(sso.location, '/');
  assert.match(sso.cookie || '', /gymsid=/);
  // Búnker's passkeys are kept.
  assert.equal(readDb(on).creds.filter(c => c.userId === 'u-a').length, 2);
});

test('retired: members without a link, staff and ADMIN_UIDS keep signing in here', async () => {
  for (const [id, key, uid] of [['cred-free', K.free, 'u-free'], ['cred-staff', K.staff, 'u-staff'], ['cred-env', K.env, 'u-env']]) {
    const r = await passkeyLogin(on, id, key, 10);
    assert.equal(r.status, 200, `${uid}: ${JSON.stringify(r.data)}`);
    assert.equal(r.data.user.id, uid);
    assert.match(r.cookie || '', /gymsid=/);
  }
});

test('retired: the QR device link does not give a linked member a session either', async () => {
  const hmac = payload => `${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
  const post = (p, body, headers = {}) => fetch(on.base + p, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  // Device A starts; device B (the member's existing passkey session, e.g. from before the switch) approves with a step-up and the code.
  const start = await (await post('/api/link/start', {})).json();
  const sessionB = hmac(`u-a:${Date.now() + 86400000}:0`);
  const stepUp = hmac(`stepup.u-a:${Date.now() + 60_000}:device-link`);
  const approve = await post('/api/link/approve', { id: start.id, code: start.code }, { cookie: `gymsid=${sessionB}`, 'x-step-up': stepUp });
  assert.equal(approve.status, 200, await approve.clone().text());
  const claim = await post('/api/link/claim', { id: start.id, secret: start.secret });
  assert.equal(claim.status, 403);
  assert.deepEqual(await claim.json(), { error: 'Entra desde 2J Home', code: 'login_retired', homeUrl: HOME });
  assert.equal(claim.headers.get('set-cookie'), null);
  assert.ok(readDb(on).securityEvents.some(e => e.event === 'platform_login_retired_refused' && e.meta?.kind === 'qr'));
});

test('switches off: credentials do not exist and the linked member signs in exactly as in F9c', async () => {
  assert.equal((await service(off, 'GET', credsPath('u-a', P.a))).status, 404);
  const r = await passkeyLogin(off, 'cred-a', K.a, 10);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.user.id, 'u-a');
  assert.equal(r.data.user.authLevel, 'passkey');
});

test('PLATFORM_LOGIN_RETIRED without the SSO receiver is inert (nobody is locked out)', async () => {
  const t = await startTraining({ ...BRIDGE, PLATFORM_SSO_ENABLED: 'false', PLATFORM_LOGIN_RETIRED: 'true' });
  stopped.push(t);
  assert.equal((await passkeyLogin(t, 'cred-a', K.a, 10)).status, 200);
});

test('round trip: switch on → refused; switch off on the same data → today\'s login back, no data lost', async () => {
  const first = await startTraining({ ...BRIDGE, ...F9D });
  assert.equal((await passkeyLogin(first, 'cred-a', K.a, 20)).status, 403);
  const before = readDb(first);
  await first.stop();
  const second = await startTraining(BRIDGE, first.dir);
  stopped.push(second);
  const r = await passkeyLogin(second, 'cred-a', K.a, 21);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const now = readDb(second);
  assert.deepEqual(now.creds.map(c => c.id).sort(), before.creds.map(c => c.id).sort(), 'passkeys never removed');
  assert.deepEqual(now.users.find(u => u.id === 'u-a').platformLink, before.users.find(u => u.id === 'u-a').platformLink);
});

test('retired: export/erasure (F9c) — an SSO session still cannot (F9b rule); a passkey session opened before the switch still can', async () => {
  const t = await startTraining({ ...BRIDGE, ...F9D });
  stopped.push(t);
  const sso = await ssoEntry(t, P.a, 'u-a');
  const ssoCookie = (sso.cookie || '').split(';', 1)[0];
  const as = (cookie, m, p, body) => fetch(t.base + p, { method: m, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const exp = await as(ssoCookie, 'GET', '/api/me/export');
  assert.equal(exp.status, 403);
  assert.equal((await exp.json()).code, 'passkey_required');
  // Signing in with the Búnker passkey from that SSO browser is not possible either (F9b gate), so no passkey session can be created.
  assert.equal((await as(ssoCookie, 'POST', '/api/login/options', {})).status, 403);
  // A passkey session that already existed before the switch is not revoked: export and erasure keep working there.
  const payload = `u-a:${Date.now() + 86400000}:0`;
  const old = `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
  assert.equal((await as(old, 'GET', '/api/me/export')).status, 200);
  const d = await (await as(old, 'POST', '/api/me/delete/options', {})).json();
  assert.ok(d.cid, 'erasure still asks for a fresh Búnker passkey');
});
