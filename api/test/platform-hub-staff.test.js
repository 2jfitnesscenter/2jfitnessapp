// F9e · Staff (trainers and administration) with the identity and the ROLE decided by 2J Hub (2JHub H-82, H-104, H-105; contract §10,
// training-staff-v1), against the REAL Training server and a fake Platform. With the F9e switches off, everything answers exactly like F9d-2.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

const { signHubRequest } = await import('../platform-hub/service-auth.js');
const API_ROOT = path.resolve('.');
const HOME = 'http://127.0.0.1:5181';
const ADMIN = 'http://127.0.0.1:5182';
const SECRET = 'f'.repeat(64);
const outbound = { keyId: 'bunker-out-e', secret: Buffer.alloc(32, 0x45) };   // Training -> Platform
const inbound = { keyId: 'platform-out-e', secret: Buffer.alloc(32, 0x65) };   // Platform -> Training
const b64u = b => Buffer.from(b).toString('base64url');

/* ------------------------------------------------------------------ fake Platform: staff redeem + staff state */
const codes = new Map();
let stateItems = [];
const platform = await new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks), h = n => req.headers[n];
      const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      const { signature } = signHubRequest({ keyId: outbound.keyId, secret: outbound.secret, timestamp: h('x-2j-timestamp') || '', requestId: h('x-2j-request-id') || '', method: req.method, target: req.url, body });
      if (h('x-2j-key-id') !== outbound.keyId || h('x-2j-signature') !== signature) return reply(401, { error: 'SERVICE_AUTH_INVALID' });
      if (req.method === 'GET' && req.url === '/api/internal/platform/v2/training-staff') {
        return reply(200, { v: 1, contract: 'training-staff-v1', generatedAt: new Date().toISOString(), items: stateItems });
      }
      if (req.url === '/api/internal/platform/v2/training-staff-sso/redeem') {
        const r = JSON.parse(body.toString('utf8'));
        const entry = codes.get(r.code);
        if (r.audience !== '2j-training-staff' || !entry || entry.used) return reply(403, { error: 'STAFF_SSO_REJECTED' });
        entry.used = true;
        return reply(200, { v: 1, contract: 'training-staff-v1', issuer: '2j-platform', audience: '2j-training-staff', personId: entry.personId, trainingUserId: entry.trainingUserId, linkStatus: 'active', staffRole: entry.role, displayName: 'Equipo 2J', assurance: 'platform_sso', correlationId: r.correlationId, ...(entry.extra || {}) });
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
const K = { coach: keyOf(), boss: keyOf(), env: keyOf(), solo: keyOf(), loose: keyOf() };
const P = { coach: randomUUID(), boss: randomUUID(), member: randomUUID(), other: randomUUID(), solo: randomUUID() };
const cred = (id, userId, key) => ({ id, userId, publicKey: key.cose, counter: 1, transports: ['internal'], name: 'Móvil', createdAt: '2026-06-01T10:00:00.000Z' });
function seed(dir, { envAdmin = true } = {}) {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [
      { id: 'u-coach', name: 'Coach', username: 'coach', created: '2025-01-01T00:00:00.000Z', trainer: true },
      { id: 'u-boss', name: 'Boss', username: 'boss', created: '2025-01-01T00:00:00.000Z', admin: true },
      { id: 'u-loose', name: 'Loose', username: 'loose', created: '2025-01-01T00:00:00.000Z', trainer: true },
      ...(envAdmin ? [{ id: 'u-env', name: 'Juanjo', username: 'juanjo', created: '2025-01-01T00:00:00.000Z' }] : []),
      { id: 'u-member', name: 'Socio', username: 'socio', created: '2025-01-01T00:00:00.000Z', personId: P.member, platformLink: { personId: P.member, state: 'active', origin: 'platform_admin' }, assignedTrainers: ['u-coach'] },
    ],
    creds: [cred('c-coach', 'u-coach', K.coach), cred('c-boss', 'u-boss', K.boss), cred('c-env', 'u-env', K.env), cred('c-loose', 'u-loose', K.loose)],
    subs: [], invites: [], recoveries: [],
  }));
}
const freePort = () => new Promise(resolve => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
async function startTraining(extraEnv, { envAdmin = true } = {}) {
  const dir = tempData(); seed(dir, { envAdmin });
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: API_ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: envAdmin ? 'u-env' : '', ...extraEnv }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  return { base, dir, stop: () => new Promise(r => { child.once('exit', r); child.kill(); }) };
}
const BRIDGE = {
  PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_HOME_URL: HOME, PLATFORM_ADMIN_URL: ADMIN, PLATFORM_DIRECTORY_ENABLED: 'true',
  PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
  PLATFORM_HUB_INBOUND_KEYS: JSON.stringify({ [inbound.keyId]: inbound.secret.toString('base64url') }),
};
const ROLES = { PLATFORM_HUB_STAFF_ROLES_ENABLED: 'true' };
const on = await startTraining({ ...BRIDGE, ...ROLES });
const off = await startTraining(BRIDGE);
const stopped = [];
after(async () => { await on.stop(); await off.stop(); for (const s of stopped) await s.stop(); platform.server.close(); });
const readDb = t => JSON.parse(fs.readFileSync(path.join(t.dir, 'db.json'), 'utf8'));
const userOf = (t, id) => readDb(t).users.find(u => u.id === id);

async function service(t, method, route, body = undefined, { key = inbound, at = Date.now(), requestId = randomUUID() } = {}) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const timestamp = new Date(at).toISOString();
  const { signature } = signHubRequest({ keyId: key.keyId, secret: key.secret, timestamp, requestId, method, target: route, body: raw });
  const r = await fetch(t.base + route, { method, body: raw || undefined, headers: { 'x-2j-key-id': key.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature, ...(raw ? { 'content-type': 'application/json' } : {}) } });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}
let tick = Date.parse('2026-11-16T10:00:00.000Z');
const nextAt = () => new Date((tick += 1000)).toISOString();
const active = (uid, personId, staffRole, changedAt = nextAt()) => ({ personId, trainingUserId: uid, linkStatus: 'active', staffRole, changedAt });
const ended = (uid, personId, reason, changedAt = nextAt()) => ({ personId, trainingUserId: uid, linkStatus: 'ended', staffRole: null, reason, changedAt });
const event = (t, item, eventId = randomUUID()) => service(t, 'POST', '/api/internal/platform/v1/staff-events', { v: 1, contract: 'training-staff-v1', eventId, item });

async function entry(t, personId, trainingUserId, role, { origin = ADMIN, extra = null, cookie = null } = {}) {
  const code = crypto.randomBytes(32).toString('base64url');
  codes.set(code, { personId, trainingUserId, role, extra });
  const r = await fetch(t.base + '/api/platform/v1/staff-sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code, correlationId: randomUUID() }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) } });
  const set = r.headers.get('set-cookie');
  return { status: r.status, location: r.headers.get('location'), cookie: set ? set.split(';', 1)[0] : null, code };
}
const as = (t, cookie, method, p, body) => fetch(t.base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

/** The passkey sign-in exactly as the browser does it: options, then a real ES256 assertion. */
const counters = new Map();
async function passkeyLogin(t, credId, key) {
  const counter = (counters.get(t.base + credId) || 1) + 1; counters.set(t.base + credId, counter);
  const o = await (await fetch(t.base + '/api/login/options', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json();
  const authData = Buffer.concat([crypto.createHash('sha256').update('localhost').digest(), Buffer.from([0x05]), Buffer.from([0, 0, 0, counter])]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: o.options.challenge, origin: t.base, crossOrigin: false }));
  const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), key.privateKey);
  const credential = { id: credId, rawId: credId, type: 'public-key', response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(sig) }, clientExtensionResults: {} };
  const r = await fetch(t.base + '/api/login/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cid: o.cid, credential }) });
  let data = null; try { data = await r.json(); } catch { /* none */ }
  const set = r.headers.get('set-cookie');
  return { status: r.status, data, cookie: set ? set.split(';', 1)[0] : null };
}

/* ------------------------------------------------------------------ switches off */
test('roles switch OFF: no receiver, no events, no role guard; the staff directory follows the directory switch; staff log in as today', async () => {
  const e = await entry(off, P.coach, 'u-coach', 'trainer');
  assert.equal(e.status, 404);
  assert.equal((await event(off, active('u-coach', P.coach, 'admin'))).status, 404);
  const dir = await service(off, 'GET', '/api/internal/platform/v1/training-staff');
  assert.equal(dir.status, 200);
  const login = await passkeyLogin(off, 'c-coach', K.coach);
  assert.equal(login.status, 200, JSON.stringify(login.data));
  assert.equal(userOf(off, 'u-coach').platformStaffLink, undefined);
  // Without the directory switch the staff directory does not exist either.
  const bare = await startTraining({ ...BRIDGE, PLATFORM_DIRECTORY_ENABLED: 'false' });
  stopped.push(bare);
  assert.equal((await service(bare, 'GET', '/api/internal/platform/v1/training-staff')).status, 404);
});

/* ------------------------------------------------------------------ staff directory */
test('staff directory: only staff accounts and ADMIN_UIDS (flagged), signed, single use; never members', async () => {
  const r = await service(on, 'GET', '/api/internal/platform/v1/training-staff');
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const ids = r.json.items.map(i => i.trainingUserId).sort();
  assert.deepEqual(ids, ['u-boss', 'u-coach', 'u-env', 'u-loose']);
  assert.deepEqual(r.json.items.find(i => i.trainingUserId === 'u-env'), { trainingUserId: 'u-env', displayName: 'Juanjo', username: 'juanjo', role: 'admin', adminByConfig: true, disabled: false, staffPersonId: null });
  assert.equal(r.json.items.find(i => i.trainingUserId === 'u-coach').role, 'trainer');
  const rid = randomUUID();
  assert.equal((await service(on, 'GET', '/api/internal/platform/v1/training-staff', undefined, { requestId: rid })).status, 200);
  assert.equal((await service(on, 'GET', '/api/internal/platform/v1/training-staff', undefined, { requestId: rid })).status, 401, 'replay');
  assert.equal((await service(on, 'GET', '/api/internal/platform/v1/training-staff', undefined, { key: { ...inbound, secret: Buffer.alloc(32, 1) } })).status, 401, 'bad signature');
  assert.equal((await service(on, 'GET', '/api/internal/platform/v1/training-staff', undefined, { at: Date.now() - 31_000 })).status, 401, 'clock skew');
});

/* ------------------------------------------------------------------ entry */
test('entry from 2J Hub Admin: exact Origin, one-use code, the role Platform says; platform_sso never counts as a passkey', async () => {
  const e = await entry(on, P.coach, 'u-coach', 'trainer');
  assert.equal(e.status, 303); assert.equal(e.location, '/');
  assert.match(e.cookie || '', /^gymsid=/);
  const { user: me } = await (await as(on, e.cookie, 'GET', '/api/me')).json();
  assert.equal(me.trainer, true); assert.equal(me.admin, false);
  assert.equal((await as(on, e.cookie, 'GET', '/api/trainer/members')).status, 200);
  assert.equal((await as(on, e.cookie, 'GET', '/api/admin/users')).status, 403);
  // Strong-auth staff operations still need a Búnker passkey (left as they are; question for Juanjo).
  const strong = await as(on, e.cookie, 'POST', '/api/logout/all', {});
  assert.equal(strong.status, 403); assert.equal((await strong.json()).code, 'passkey_required');
  const u = userOf(on, 'u-coach');
  assert.deepEqual({ personId: u.platformStaffLink.personId, state: u.platformStaffLink.state, role: u.platformStaffLink.role }, { personId: P.coach, state: 'active', role: 'trainer' });
  const rec = readDb(on).deviceSessions.findLast(s => s.userId === 'u-coach' && s.via === 'sso');
  assert.equal(rec.staff, true); assert.equal(rec.assurance, 'platform_sso');
  // Re-using the code → refused, no session.
  const again = await fetch(on.base + '/api/platform/v1/staff-sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code: e.code, correlationId: randomUUID() }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ADMIN } });
  assert.equal(again.headers.get('location'), '/sso#error=denied'); assert.equal(again.headers.get('set-cookie'), null);
});

test('entry refused: foreign Origin, Home Origin, no Origin, ADMIN_UIDS, a field more, an answer outside the contract, another account\'s session', async () => {
  for (const origin of ['https://evil.example', HOME, null]) {
    const r = await entry(on, P.coach, 'u-coach', 'trainer', { origin });
    assert.equal(r.status, 303); assert.equal(r.location, '/sso#error=denied'); assert.equal(r.cookie, null, String(origin));
  }
  assert.equal((await entry(on, randomUUID(), 'u-env', 'admin')).cookie, null, 'ADMIN_UIDS keep their passkey only');
  assert.equal((await entry(on, P.coach, 'u-coach', 'trainer', { extra: { staffRole: 'superadmin' } })).cookie, null, 'role outside the contract');
  assert.equal((await entry(on, P.coach, 'u-coach', 'trainer', { extra: { audience: '2j-training' } })).cookie, null, 'member audience');
  const form = await fetch(on.base + '/api/platform/v1/staff-sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code: 'a'.repeat(43), correlationId: 'x', role: 'admin' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ADMIN } });
  assert.equal(form.headers.get('location'), '/sso#error=denied');
  const boss = await entry(on, P.boss, 'u-boss', 'admin');
  assert.match(boss.cookie || '', /^gymsid=/, JSON.stringify(boss));
  const swap = await entry(on, P.coach, 'u-coach', 'trainer', { cookie: boss.cookie });
  assert.equal(swap.status, 303, JSON.stringify(swap));
  assert.equal(swap.location, '/sso#error=switch'); assert.equal(swap.cookie, null);
  // A member code (member audience) is refused by the fake Platform here; the member receiver keeps answering as in F9b (no staff role).
  assert.ok(readDb(on).securityEvents.some(ev => ev.event === 'platform_staff_sso_refused' && ev.meta?.reason === 'origin_rejected'));
});

test('one person ↔ one account: another person on a linked account, or a person already on another account → kept, no session', async () => {
  const on = await startTraining({ ...BRIDGE, ...ROLES });
  stopped.push(on);
  await entry(on, P.coach, 'u-coach', 'trainer');
  assert.equal((await entry(on, P.other, 'u-coach', 'trainer')).cookie, null);
  assert.equal((await entry(on, P.coach, 'u-loose', 'trainer')).cookie, null);
  assert.equal((await entry(on, P.other, 'u-member', 'trainer')).cookie, null, 'member account of another person');
  assert.ok(readDb(on).securityEvents.some(ev => ev.event === 'platform_staff_kept' && ev.meta?.reason === 'link_conflict'));
  assert.equal(userOf(on, 'u-loose').platformStaffLink, undefined);
});

/* ------------------------------------------------------------------ role changes, pause, departure */
test('events: role change applied within the event; duplicate and stale events change nothing; the panel cannot override Platform', async () => {
  await entry(on, P.coach, 'u-coach', 'trainer');
  const id = randomUUID();
  const up = await event(on, active('u-coach', P.coach, 'admin'), id);
  assert.deepEqual(up.json, { v: 1, eventId: id, result: 'applied' });
  assert.equal(userOf(on, 'u-coach').admin, true);
  assert.equal((await event(on, active('u-coach', P.coach, 'trainer'), id)).json.result, 'duplicate');
  assert.equal(userOf(on, 'u-coach').admin, true);
  const old = await event(on, active('u-coach', P.coach, 'trainer', '2020-01-01T00:00:00.000Z'));
  assert.equal(old.json.result, 'applied'); assert.equal(userOf(on, 'u-coach').admin, true, 'an older state never wins');
  // Búnker's admin panel (a real passkey session of an ADMIN_UIDS account) cannot change a role Platform governs.
  const env = await passkeyLogin(on, 'c-env', K.env);
  assert.equal(env.status, 200, JSON.stringify(env.data));
  const r = await as(on, env.cookie, 'POST', '/api/admin/user/role', { id: 'u-coach', role: 'member' });
  assert.equal(r.status, 409); assert.equal((await r.json()).code, 'role_from_platform');
  // …but it still can for an unlinked staff account (today's behaviour).
  const loose = await as(on, env.cookie, 'POST', '/api/admin/user/role', { id: 'u-loose', role: 'trainer' });
  assert.equal(loose.status, 200, await loose.clone().text());
  assert.equal((await event(on, active('u-coach', P.coach, 'trainer'))).json.result, 'applied');
  assert.equal(userOf(on, 'u-coach').admin, undefined); assert.equal(userOf(on, 'u-coach').trainer, true);
  // Bad signature / replay / bad body.
  assert.equal((await service(on, 'POST', '/api/internal/platform/v1/staff-events', { v: 1, contract: 'training-staff-v1', eventId: randomUUID(), item: active('u-coach', P.coach, 'admin') }, { key: { ...inbound, secret: Buffer.alloc(32, 9) } })).status, 401);
  assert.equal((await event(on, { ...active('u-coach', P.coach, 'admin'), staffRole: 'owner' })).status, 400);
});

test('paused (no staff role in Platform now): no staff powers at once, flags and members\' assignments kept; resuming restores everything', async () => {
  const e = await entry(on, P.coach, 'u-coach', 'trainer');
  assert.equal((await as(on, e.cookie, 'GET', '/api/trainer/members')).status, 200);
  assert.equal((await event(on, active('u-coach', P.coach, null))).json.result, 'applied');
  // The staff sso session is revoked and a passkey session is member-level while paused.
  assert.equal((await as(on, e.cookie, 'GET', '/api/trainer/members')).status, 401);
  const pk = await passkeyLogin(on, 'c-coach', K.coach);
  assert.equal(pk.status, 200);
  assert.equal((await as(on, pk.cookie, 'GET', '/api/trainer/members')).status, 403);
  assert.equal(userOf(on, 'u-coach').trainer, true, 'flag kept');
  assert.deepEqual(userOf(on, 'u-member').assignedTrainers, ['u-coach'], 'assignments kept');
  assert.equal((await event(on, active('u-coach', P.coach, 'trainer'))).json.result, 'applied');
  assert.equal((await as(on, pk.cookie, 'GET', '/api/trainer/members')).status, 200);
});

test('departure (archived in Platform) → link ended and member role; a hand revocation keeps the role and gives the account back to the panel', async () => {
  await entry(on, P.boss, 'u-boss', 'admin');
  assert.equal((await event(on, ended('u-boss', P.boss, 'revoked'))).json.result, 'applied');
  const b = userOf(on, 'u-boss');
  assert.equal(b.platformStaffLink.state, 'ended'); assert.equal(b.admin, true, 'revocation keeps the role');
  assert.equal(b.platformStaffLink.reason, 'revoked');
  // Re-linked and then a departure.
  await entry(on, P.boss, 'u-boss', 'admin');
  assert.equal(userOf(on, 'u-boss').platformStaffLink.state, 'active');
  assert.equal((await event(on, ended('u-boss', P.boss, 'staff_departed'))).json.result, 'applied');
  const gone = userOf(on, 'u-boss');
  assert.equal(gone.admin, undefined); assert.equal(gone.trainer, undefined);
  assert.equal(gone.platformStaffLink.reason, 'staff_departed');
  // An ended item for ANOTHER person never touches this account.
  assert.equal((await event(on, ended('u-coach', P.other, 'staff_departed'))).json.result, 'applied');
  assert.equal(userOf(on, 'u-coach').trainer, true);
  // History is kept: same account id, its passkeys and its data.
  assert.ok(readDb(on).creds.some(c => c.userId === 'u-boss'));
});

test('last administrator: without ADMIN_UIDS, Platform can neither demote, pause nor remove the only admin (kept and audited)', async () => {
  const t = await startTraining({ ...BRIDGE, ...ROLES, PLATFORM_STAFF_LOGIN_RETIRED: 'true' }, { envAdmin: false });
  stopped.push(t);
  assert.equal((await entry(t, P.boss, 'u-boss', 'admin')).status, 303);
  assert.equal((await event(t, active('u-boss', P.boss, 'trainer'))).json.result, 'kept');
  assert.equal((await event(t, active('u-boss', P.boss, null))).json.result, 'kept');
  assert.equal((await event(t, ended('u-boss', P.boss, 'staff_departed'))).json.result, 'kept');
  assert.equal(userOf(t, 'u-boss').admin, true);
  assert.ok(readDb(t).securityEvents.some(ev => ev.event === 'platform_staff_kept' && ev.meta?.reason === 'last_admin'));
  // And, with no ADMIN_UIDS able to sign in, the linked admin keeps its Búnker login even with the staff login retired.
  const login = await passkeyLogin(t, 'c-boss', K.boss);
  assert.equal(login.status, 200, JSON.stringify(login.data));
});

/* ------------------------------------------------------------------ staff login retired */
test('PLATFORM_STAFF_LOGIN_RETIRED: linked staff → "Entra desde 2J Hub" (Admin); ADMIN_UIDS and unlinked staff sign in as today; off → today', async () => {
  const t = await startTraining({ ...BRIDGE, ...ROLES, PLATFORM_STAFF_LOGIN_RETIRED: 'true' });
  stopped.push(t);
  await entry(t, P.coach, 'u-coach', 'trainer');
  await entry(t, P.boss, 'u-boss', 'admin');
  const coach = await passkeyLogin(t, 'c-coach', K.coach);
  assert.equal(coach.status, 403); assert.deepEqual(coach.data, { error: 'Entra desde 2J Hub', code: 'login_retired', homeUrl: ADMIN, audience: 'staff' }); assert.equal(coach.cookie, null);
  const boss = await passkeyLogin(t, 'c-boss', K.boss);
  assert.equal(boss.status, 403, 'an admin is retired too while an ADMIN_UIDS account can sign in');
  assert.equal((await passkeyLogin(t, 'c-env', K.env)).status, 200, 'ADMIN_UIDS: always');
  assert.equal((await passkeyLogin(t, 'c-loose', K.loose)).status, 200, 'unlinked staff: as today (H-105.4)');
  assert.ok(readDb(t).securityEvents.some(ev => ev.event === 'platform_staff_login_retired_refused' && ev.userId === 'u-coach'));
  // The same linked accounts with the switch off (the `on` instance) sign in as today.
  await entry(on, P.coach, 'u-coach', 'trainer');
  assert.equal((await passkeyLogin(on, 'c-coach', K.coach)).status, 200);
});

/* ------------------------------------------------------------------ refresh */
test('the staff state is re-read from Platform (at start and every minute): adopts links, applies roles, ends never by absence', async () => {
  stateItems = [active('u-loose', P.solo, 'admin'), ended('u-boss', randomUUID(), 'staff_departed')];
  const t = await startTraining({ ...BRIDGE, ...ROLES });
  stopped.push(t);
  let loose;
  for (let i = 0; i < 50; i++) { loose = userOf(t, 'u-loose'); if (loose.platformStaffLink) break; await new Promise(r => setTimeout(r, 100)); }
  assert.equal(loose.platformStaffLink?.state, 'active'); assert.equal(loose.admin, true);
  assert.equal(userOf(t, 'u-boss').admin, true, 'an ended item for an unknown link changes nothing');
  assert.equal(userOf(t, 'u-coach').trainer, true, 'absent from the state ≠ ended');
  stateItems = [];
});

/* ------------------------------------------------------------------ F9m: deep link to a member (2JHub contract F9m, H-122 / H-123) */
const deep = await startTraining({ ...BRIDGE, ...ROLES, PLATFORM_HUB_STAFF_DEEPLINK_ENABLED: 'true' });
stopped.push(deep);
const member = (id, extra = {}) => ({ next: 'member', memberTrainingUserId: id, ...extra });
const securityEvents = (t, name) => readDb(t).securityEvents.filter(ev => ev.event === name);

test('F9m deep link ON: the staff entry lands on #/trainer/<member id>, built by Búnker; the session is the same platform_sso staff session', async () => {
  const e = await entry(deep, P.coach, 'u-coach', 'trainer', { extra: member('u-member') });
  assert.equal(e.status, 303); assert.equal(e.location, '/#/trainer/u-member');
  assert.match(e.cookie || '', /^gymsid=/);
  const rec = readDb(deep).deviceSessions.findLast(s => s.userId === 'u-coach' && s.via === 'sso');
  assert.equal(rec.staff, true); assert.equal(rec.assurance, 'platform_sso');
  assert.equal((await as(deep, e.cookie, 'GET', '/api/admin/users')).status, 403, 'still only the role Platform decided');
  const ev = securityEvents(deep, 'platform_staff_sso_deeplink').at(-1);
  assert.deepEqual({ userId: ev.userId, next: ev.meta.next, memberId: ev.meta.memberId, landed: ev.meta.landed }, { userId: 'u-coach', next: 'member', memberId: 'u-member', landed: true });
  assert.equal(JSON.stringify(readDb(deep).securityEvents).includes(e.code), false, 'the code is never stored');
});

test('F9m deep link ON: unknown member or own account → plain entry to "/" (never refused, never a free route)', async () => {
  for (const id of ['u-nobody', 'u-coach']) {
    const e = await entry(deep, P.coach, 'u-coach', 'trainer', { extra: member(id) });
    assert.equal(e.status, 303); assert.equal(e.location, '/', id); assert.match(e.cookie || '', /^gymsid=/);
  }
  // The route is built by one pure function: it must never turn a path-like or reserved id into a route.
  const { staffDeeplinkLocation } = await import('../platform-hub/config.js');
  assert.equal(staffDeeplinkLocation('member', 'u-ana'), '/#/trainer/u-ana');
  for (const bad of ['../admin', 'a/b', '/trainer/x', 'a?b', 'a#b', 'seguimiento', 'blocks', 'guided', 'library-quality', '', 'x'.repeat(201), null, undefined, 42]) {
    assert.equal(staffDeeplinkLocation('member', bad), '/', String(bad));
  }
  for (const next of ['home', '/trainer/u-ana', '#/trainer/u-ana', undefined]) assert.equal(staffDeeplinkLocation(next, 'u-ana'), '/', String(next));
});

test('F9m: a destination that is a route, a member without id (or the reverse) or a field more is outside the contract → entry refused', async () => {
  for (const extra of [{ next: '/trainer/u-member', memberTrainingUserId: 'u-member' }, { next: 'member' }, { memberTrainingUserId: 'u-member' }, member('u-member', { route: '/#/trainer/u-member' }), { next: 'home', memberTrainingUserId: 'u-member' }]) {
    const e = await entry(deep, P.coach, 'u-coach', 'trainer', { extra });
    assert.equal(e.cookie, null, JSON.stringify(extra)); assert.equal(e.location, '/sso#error=denied');
  }
});

test('F9m deep link OFF (default): Platform may send next, it is ignored and the entry goes to "/" exactly as in F9e; nothing audited', async () => {
  const before = securityEvents(on, 'platform_staff_sso_deeplink').length;
  const e = await entry(on, P.coach, 'u-coach', 'trainer', { extra: member('u-member') });
  assert.equal(e.status, 303); assert.equal(e.location, '/'); assert.match(e.cookie || '', /^gymsid=/);
  assert.equal(securityEvents(on, 'platform_staff_sso_deeplink').length, before);
});

test('F9m backwards compatible both ways: an F9e answer (no next) goes to "/" with the switch on; the switch needs the roles switch and is off by default', async () => {
  const e = await entry(deep, P.coach, 'u-coach', 'trainer');
  assert.equal(e.location, '/'); assert.match(e.cookie || '', /^gymsid=/);
  const { parseHubEnv } = await import('../platform-hub/config.js');
  const base = { PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_SSO_ENABLED: 'true' };
  assert.equal(parseHubEnv({ ...base, PLATFORM_HUB_STAFF_ROLES_ENABLED: 'true' }).staffDeeplinkEnabled, false, 'off by default');
  assert.equal(parseHubEnv({ ...base, PLATFORM_HUB_STAFF_DEEPLINK_ENABLED: 'true' }).staffDeeplinkEnabled, false, 'needs the roles switch');
  assert.equal(parseHubEnv({ ...base, PLATFORM_HUB_STAFF_ROLES_ENABLED: 'true', PLATFORM_HUB_STAFF_DEEPLINK_ENABLED: 'true' }).staffDeeplinkEnabled, true);
  assert.equal(parseHubEnv({ PLATFORM_HUB_STAFF_DEEPLINK_ENABLED: 'true' }).staffDeeplinkEnabled, false, 'needs the bridge and SSO');
});

