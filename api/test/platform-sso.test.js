import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();                       // also sets DATA_DIR for the in-process proof store used to seed link evidence
const SECRET = 'a'.repeat(64);
const { createPlatformProofStore } = await import('../platform-proof/store.js');
const { signPlatformServiceRequest } = await import('../platform-proof/service-auth.js');
const { classifyRoute } = await import('../platform-sso/route-policy.js');
const { createCapabilitiesService, degradedView, baselineCapabilities } = await import('../platform-sso/capabilities.js');
const { transitionAllowed, userMode, parsePlatformIntegrationEnv } = await import('../platform-sso/index.js');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const API_ROOT = path.resolve('.');

/* ------------------------------------------------------------------ route policy: every real route is classified */
test('every real API route is classified and sso sessions are limited to member routes', () => {
  const found = new Set();
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'scripts'].includes(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.js')) {
        for (const match of fs.readFileSync(full, 'utf8').matchAll(/['"`](GET|POST|PUT|PATCH|DELETE) (\/api\/[A-Za-z0-9_/:.\-]*)['"`]/g)) found.add(`${match[1]} ${match[2]}`);
      }
    }
  };
  walk(API_ROOT);
  assert.ok(found.size > 250, `route scan looks wrong (${found.size})`);
  const unclassified = [...found].filter(key => classifyRoute(key).kind === 'unclassified');
  assert.deepEqual(unclassified, [], 'new routes must be added to platform-sso/route-policy.js');
  for (const key of found) {
    const policy = classifyRoute(key);
    if (['staff', 'kiosk'].includes(policy.kind)) assert.equal(policy.ssoAllowed, false, `${key} must not be reachable from an sso session`);
    if (policy.kind === 'gated') assert.ok(policy.capabilities.length > 0, key);
  }
  for (const key of ['POST /api/me/delete', 'GET /api/me/passkeys', 'POST /api/me/passkeys/verify', 'POST /api/logout/all', 'GET /api/me/export', 'POST /api/me/step-up', 'POST /api/admin/user/role', 'POST /api/trainer/member-program', 'POST /api/shared-staff/login', 'POST /api/guided/save', 'POST /api/premium/feature', 'POST /api/link/create', 'POST /api/whoop/connect']) {
    if (found.has(key)) assert.equal(classifyRoute(key).ssoAllowed, false, `${key} stays passkey-only`);
  }
  assert.deepEqual(classifyRoute('GET /api/guided').capabilities, ['guidedTraining']);
  assert.deepEqual(classifyRoute('POST /api/coach/plan').capabilities, ['aiCoach']);
  assert.deepEqual(classifyRoute('GET /api/premium').capabilities, ['premiumPrograms']);
  assert.deepEqual(classifyRoute('GET /api/followup').capabilities, ['professionalFollowUp']);
  assert.equal(classifyRoute('GET /api/me/export').kind, 'identity', 'the owner can always export their own data (never capability-gated)');
});

test('enforcement transitions are explicit, per user and reversible only through shadow', () => {
  assert.equal(userMode({}), 'legacy'); assert.equal(userMode({ platformEnforcement: 'bogus' }), 'legacy');
  for (const pair of [['legacy', 'shadow'], ['shadow', 'enforced'], ['shadow', 'legacy'], ['enforced', 'shadow']]) assert.equal(transitionAllowed(...pair), true, pair.join('>'));
  for (const pair of [['legacy', 'enforced'], ['enforced', 'legacy']]) assert.equal(transitionAllowed(...pair), false, pair.join('>'));
  const off = parsePlatformIntegrationEnv({});
  assert.equal(off.ssoEnabled, false); assert.equal(off.client, null);
  const bad = parsePlatformIntegrationEnv({ PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: 'http://platform.example.com', PLATFORM_API_KEY_ID: 'k', PLATFORM_API_KEY_SECRET: Buffer.alloc(32, 1).toString('base64url') });
  assert.equal(bad.client, null, 'plain http is only accepted for loopback');
});

/* ------------------------------------------------------------------ capability payloads */
function v2({ personId, trainingUserId, kind = 'baseline', ttlMs = 60_000, now = Date.now() }) {
  const base = baselineCapabilities();
  const none = Object.fromEntries(Object.keys(base).map(name => [name, false]));
  const table = {
    baseline: { level: 'baseline', state: 'baseline', reason: 'FREE_BASELINE', caps: base },
    autonomous: { level: 'autonomous', state: 'active', reason: 'ACTIVE_AUTONOMOUS', caps: { ...base, routineCreation: true, guidedTraining: true, premiumPrograms: true } },
    full: { level: 'full', state: 'active', reason: 'ACTIVE_FULL', caps: Object.fromEntries(Object.keys(base).map(name => [name, true])) },
    suspended: { level: 'blocked', state: 'suspended', reason: 'ADMIN_SUSPENDED', caps: none, suspension: 'suspended' },
    revoked: { level: 'blocked', state: 'ended', reason: 'TRAINING_LINK_REVOKED', caps: none, link: 'revoked' },
  }[kind];
  return {
    contract: '2J-CAPABILITIES-V2', version: 2, personId,
    trainingSubject: table.link ? { linkStatus: table.link } : { linkStatus: 'active', trainingUserId },
    capabilityLevel: table.level, accessState: table.state, capabilities: table.caps, reasonCode: table.reason,
    suspensionStatus: table.suspension ?? 'none', effectiveFrom: null,
    expiresAt: new Date(now + ttlMs).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true },
  };
}

/* ------------------------------------------------------------------ safe degradation (unit) */
test('safe degradation never grants paid rights, keeps baseline and respects known suspension/revocation', async () => {
  const personId = randomUUID(), user = { id: 'u-deg', personId };
  let clock = Date.now(), down = false, kind = 'full', calls = 0;
  const persisted = [];
  const fetchImpl = async () => {
    calls++;
    if (down) throw new Error('network down');
    return { ok: true, status: 200, json: async () => v2({ personId, trainingUserId: user.id, kind, ttlMs: 5000, now: clock }) };
  };
  const config = { baseUrl: 'http://127.0.0.1:9', keyId: 'k', secret: Buffer.alloc(32, 3) };
  const service = createCapabilitiesService({ config, now: () => clock, fetchImpl, onRestriction: (u, r) => { persisted.push(r); if (r) u.platformRestriction = r; else delete u.platformRestriction; } });

  let view = await service.evaluate(user, { mode: 'enforced' });
  assert.equal(view.source, 'fresh'); assert.equal(view.level, 'full'); assert.equal(service.allows(view, ['aiCoach']), true);
  await service.evaluate(user, { mode: 'enforced' }); assert.equal(calls, 1, 'fresh answers are cached until expiresAt');

  clock += 6000; down = true;                                              // cache expired AND Platform unreachable
  view = await service.evaluate(user, { mode: 'enforced' });
  assert.equal(view.source, 'degraded'); assert.equal(view.level, 'baseline');
  assert.equal(service.allows(view, ['workoutRecording', 'workoutHistory', 'personalRoutineManagement']), true, 'free baseline is preserved');
  for (const name of ['aiCoach', 'professionalFollowUp', 'guidedTraining', 'premiumPrograms', 'routineCreation']) assert.equal(view.capabilities[name], false, `${name} is never granted without verification`);

  down = false; kind = 'suspended'; clock += 100;
  view = await service.evaluate(user, { mode: 'enforced' });
  assert.equal(view.level, 'blocked'); assert.equal(view.reasonCode, 'ADMIN_SUSPENDED'); assert.equal(user.platformRestriction.reasonCode, 'ADMIN_SUSPENDED');
  clock += 6000; down = true;
  view = await service.evaluate(user, { mode: 'enforced' });
  assert.equal(view.level, 'blocked', 'a known suspension keeps blocking while Platform is unreachable');
  assert.equal(service.allows(view, ['workoutHistory']), false);

  const afterRestart = createCapabilitiesService({ config, now: () => clock, fetchImpl });          // empty memory, restriction persisted on the user
  assert.equal((await afterRestart.evaluate(user, { mode: 'enforced' })).level, 'blocked', 'the restriction survives a restart');

  down = false; kind = 'baseline'; clock += 100;
  view = await service.evaluate(user, { mode: 'enforced' });
  assert.equal(view.level, 'baseline'); assert.equal(user.platformRestriction, undefined, 'lifting the suspension clears the persisted restriction');
  assert.equal(persisted.at(-1), null);

  const stranger = { id: 'u-new', personId: randomUUID() };
  down = true;
  assert.equal(await service.evaluate(stranger, { mode: 'shadow' }), null, 'no history + shadow/legacy: no verdict, so current access is untouched');
  assert.equal((await service.evaluate(stranger, { mode: 'enforced' })).level, 'baseline', 'no history + enforced: baseline only');
  assert.equal(await service.evaluate({ id: 'u-unlinked' }, { mode: 'enforced' }), null, 'an unlinked user is never evaluated');
  assert.equal(degradedView({ lastPayload: null, restriction: null, mode: 'legacy' }), null);
});

test('capability answers that do not match the contract, the person or the clock are rejected', async () => {
  const personId = randomUUID(), user = { id: 'u-val', personId };
  const mk = mutate => createCapabilitiesService({
    config: { baseUrl: 'http://127.0.0.1:9', keyId: 'k', secret: Buffer.alloc(32, 3) }, now: () => 1_800_000_000_000,
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => mutate(v2({ personId, trainingUserId: user.id, kind: 'full', now: 1_800_000_000_000 })) }),
  });
  const cases = {
    'other person': p => ({ ...p, personId: randomUUID() }),
    'other training user': p => ({ ...p, trainingSubject: { linkStatus: 'active', trainingUserId: 'someone-else' } }),
    'unknown field': p => ({ ...p, extra: true }),
    'unknown version': p => ({ ...p, version: 3 }),
    'ttl above 60s': p => ({ ...p, expiresAt: new Date(1_800_000_000_000 + 120_000).toISOString() }),
    'issued in the future': p => ({ ...p, generatedAt: new Date(1_800_000_000_000 + 600_000).toISOString(), expiresAt: new Date(1_800_000_000_000 + 640_000).toISOString() }),
    'already expired': p => ({ ...p, expiresAt: new Date(1_800_000_000_000 - 1).toISOString(), generatedAt: new Date(1_800_000_000_000 - 30_000).toISOString() }),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const view = await mk(mutate).evaluate(user, { mode: 'enforced' });
    assert.notEqual(view?.source, 'fresh', name);
    assert.equal(view.capabilities.aiCoach, false, `${name}: no paid right from an invalid answer`);
  }
});

/* ------------------------------------------------------------------ fake Platform + real Training server */
function startPlatform() {
  const state = { caps: new Map(), codes: new Map(), calls: [], down: false, keyId: 'qa-bunker-v1', secret: Buffer.alloc(32, 9) };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const h = name => req.headers[name];
      const { signature } = signPlatformServiceRequest({ keyId: h('x-2j-key-id'), secret: state.secret, timestamp: h('x-2j-timestamp'), requestId: h('x-2j-request-id'), method: req.method, path: req.url, body });
      const authentic = h('x-2j-key-id') === state.keyId && signature === h('x-2j-signature') && Math.abs(Date.now() - Date.parse(h('x-2j-timestamp'))) < 30_000;
      state.calls.push({ method: req.method, path: req.url, authentic });
      const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(payload)); };
      if (state.down) return req.socket.destroy();
      if (!authentic) return reply(401, { error: 'service_auth_rejected' });
      const caps = req.method === 'GET' && /^\/api\/internal\/platform\/v2\/persons\/([0-9a-f-]{36})\/training-capabilities$/.exec(req.url);
      if (caps) { const make = state.caps.get(caps[1]); return make ? reply(200, make()) : reply(404, { error: 'person_not_found' }); }
      if (req.method === 'POST' && req.url === '/api/internal/platform/v2/sso/redeem') {
        const request = JSON.parse(body.toString('utf8'));
        const entry = state.codes.get(request.code);
        if (!entry) return reply(404, { error: 'sso_code_not_found' });
        if (entry.used) return reply(409, { error: 'sso_code_already_used' });
        if (entry.status && entry.status !== 200) { entry.used = true; return reply(entry.status, entry.body ?? { error: 'x' }); }
        entry.used = true;
        return reply(200, { v: 1, personId: entry.personId, trainingUserId: entry.trainingUserId, capabilities: state.caps.get(entry.personId)() });
      }
      reply(404, { error: 'not_found' });
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ state, server, port: server.address().port })));
}

async function freePort() {
  return new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}

const people = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'staff', 'admin', 'legacy', 'orphan', 'conflict', 'envadmin'].map(name => [name, { uid: `uid-${name}`, personId: randomUUID() }]));
const dbFile = path.join(DIR, 'db.json');
fs.writeFileSync(dbFile, JSON.stringify({
  users: [
    ...['a', 'b', 'c', 'd', 'e', 'legacy', 'orphan', 'conflict', 'envadmin'].map(name => ({ id: people[name].uid, name: `Member ${name}`, username: name })),
    { id: people.staff.uid, name: 'Staff member', username: 'staffy', admin: true, trainer: true },
    { id: people.admin.uid, name: 'Admin', username: 'admin1', admin: true, trainer: true },
  ],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));

const platform = await startPlatform();
const platformSecret = platform.state.secret.toString('base64url');
const store = createPlatformProofStore({ dataDir: DIR });
function seedReceipt(personId, uid) {
  const context = { transactionId: randomUUID(), personId, audience: '2j-training-account-link', purpose: 'training-account-link', challengeDigest: 'b'.repeat(64) };
  const { code } = store.issue({ ...context, platformExpiresAtMs: Date.now() + 300_000 }, uid);
  const result = store.exchange({ codeHash: sha256(Buffer.from(code, 'utf8')), requestId: randomUUID(), context, isTrainingUserActive: () => true });
  assert.equal(result.status, 'exchanged');
}
for (const name of ['a', 'b', 'c', 'd', 'e', 'staff', 'admin', 'envadmin']) seedReceipt(people[name].personId, people[name].uid);
seedReceipt(people.conflict.personId, people.conflict.uid);
seedReceipt(people.conflict.personId, people.orphan.uid);       // the same person tied to two Training users: a conflict

async function startTraining(extraEnv = {}) {
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR, SECRET_FILE: path.join(DIR, 'secret'), RP_ID: 'localhost', ORIGIN: base, ...extraEnv },
    stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  return { base, port, stop: () => child.kill() };
}
const training = await startTraining({ PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: platform.state.keyId, PLATFORM_API_KEY_SECRET: platformSecret });
const plain = await startTraining();            // no Platform configuration at all
after(() => { training.stop(); plain.stop(); platform.server.close(); });

const cookieFor = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
async function call(server, method, route, { cookie, body, origin } = {}) {
  const response = await fetch(server.base + route, { method, headers: { ...(cookie ? { cookie } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, headers: response.headers };
}
const setCaps = (who, kind, extra = {}) => platform.state.caps.set(people[who].personId, () => v2({ personId: people[who].personId, trainingUserId: people[who].uid, kind, ...extra }));
const dbUser = uid => JSON.parse(fs.readFileSync(dbFile, 'utf8')).users.find(user => user.id === uid);
async function redeem(who, { code = randomBytes(32).toString('base64url'), origin = training.base, entry } = {}) {
  platform.state.codes.set(code, { personId: people[who].personId, trainingUserId: people[who].uid, ...entry });
  const response = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, origin });
  return { ...response, code, cookie: (response.headers.get('set-cookie') || '').split(';')[0] };
}

/* ------------------------------------------------------------------ SSO redemption */
test('SSO is off unless explicitly configured and requires the same-origin page', async () => {
  const off = await call(plain, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: randomBytes(32).toString('base64url') }, origin: plain.base });
  assert.equal(off.status, 423); assert.equal(off.json.error, 'platform_sso_disabled');
  setCaps('a', 'baseline');
  const foreign = await redeem('a', { origin: 'https://evil.example' });
  assert.equal(foreign.status, 403); assert.equal(foreign.json.error, 'origin_rejected');
  assert.equal(platform.state.calls.filter(item => item.method === 'POST').length, 0, 'no Platform call is made for a rejected origin');
  assert.equal((await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: 'short' }, origin: training.base })).status, 400);
});

test('a valid code opens a member-level sso session, and replay, expiry and unknown codes are refused', async () => {
  setCaps('a', 'baseline');
  const ok = await redeem('a');
  assert.equal(ok.status, 200, JSON.stringify(ok.json));
  assert.equal(ok.json.user.id, people.a.uid); assert.equal(ok.json.user.authLevel, 'sso'); assert.equal(ok.json.capabilityLevel, 'baseline');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/); assert.equal(ok.headers.get('cache-control'), 'no-store');
  assert.ok(platform.state.calls.every(item => item.authentic), 'every call to Platform was correctly signed');
  const me = await call(training, 'GET', '/api/me', { cookie: ok.cookie });
  assert.equal(me.status, 200); assert.equal(me.json.user.id ?? me.json.id ?? people.a.uid, people.a.uid);
  const stored = dbUser(people.a.uid);
  assert.equal(stored.personId, people.a.personId); assert.equal(stored.platformLink.state, 'active');
  assert.ok(!JSON.stringify(fs.readFileSync(dbFile, 'utf8')).includes(ok.code), 'the code is never stored');

  const replay = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: ok.code }, origin: training.base });
  assert.equal(replay.status, 400); assert.equal(replay.json.error, 'sso_code_invalid');
  const expired = await redeem('a', { entry: { status: 410 } });
  assert.equal(expired.status, 400); assert.equal(expired.json.error, 'sso_code_invalid');
  const unknown = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: randomBytes(32).toString('base64url') }, origin: training.base });
  assert.equal(unknown.status, 400);
  const suspended = await redeem('a', { entry: { status: 403, body: { error: 'training_access_blocked', reasonCode: 'ADMIN_SUSPENDED' } } });
  assert.equal(suspended.status, 403); assert.equal(suspended.json.reasonCode, 'ADMIN_SUSPENDED');
});

test('Training requires its own link evidence and refuses conflicts instead of trusting Platform alone', async () => {
  setCaps('legacy', 'baseline'); setCaps('conflict', 'baseline'); setCaps('orphan', 'baseline');
  const noEvidence = await redeem('legacy');
  assert.equal(noEvidence.status, 409); assert.equal(noEvidence.json.error, 'link_not_confirmed');
  assert.equal(dbUser(people.legacy.uid).personId, undefined, 'nothing is linked or inferred');
  const conflict = await redeem('conflict');
  assert.equal(conflict.status, 409); assert.equal(conflict.json.error, 'link_conflict');
  platform.state.codes.set('mismatch'.padEnd(43, 'x'), { personId: people.a.personId, trainingUserId: 'uid-does-not-exist' });
  setCaps('a', 'baseline');
  const missing = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: 'mismatch'.padEnd(43, 'x') }, origin: training.base });
  assert.ok([400, 403].includes(missing.status));
  assert.equal(JSON.parse(fs.readFileSync(dbFile, 'utf8')).users.filter(user => user.personId === people.a.personId).length, 1, 'a person maps to at most one Training user');
});

test('an sso session can never reach staff, passkey, deletion or export routes, whatever the account flags', async () => {
  setCaps('staff', 'full');
  const sso = await redeem('staff');
  assert.equal(sso.status, 200, JSON.stringify(sso.json));
  assert.equal(sso.json.user.admin, false); assert.equal(sso.json.user.trainer, false);
  for (const [method, route] of [['GET', '/api/admin/users'], ['POST', '/api/admin/user/role'], ['GET', '/api/trainer/members'], ['POST', '/api/trainer/member-program'], ['GET', '/api/me/passkeys'], ['POST', '/api/me/passkeys/options'], ['POST', '/api/me/delete'], ['POST', '/api/logout/all'], ['GET', '/api/me/export'], ['POST', '/api/me/step-up/options'], ['POST', '/api/guided/save'], ['POST', '/api/platform/v1/link-proofs'], ['POST', '/api/admin/platform-enforcement']]) {
    const response = await call(training, method, route, { cookie: sso.cookie, body: method === 'POST' ? {} : undefined });
    assert.equal(response.status, 403, `${method} ${route} -> ${response.status}`);
    assert.equal(response.json?.code, 'passkey_required', `${method} ${route}`);
  }
  const passkey = await call(training, 'GET', '/api/me', { cookie: cookieFor(people.staff.uid) });
  assert.equal(passkey.status, 200); assert.equal(passkey.json.user?.admin ?? passkey.json.admin, true, 'the same account keeps its staff powers with a passkey session');
  const forged = sso.cookie.replace(/^gymsid=/, 'gymsid=x');
  assert.equal((await call(training, 'GET', '/api/me', { cookie: forged })).status, 401);
  const logout = await call(training, 'POST', '/api/logout', { cookie: sso.cookie, body: {} });
  assert.ok(logout.status < 400);
});

/* ------------------------------------------------------------------ gates, modes, degradation (real routes) */
async function adminSetMode(uid, mode) {
  return call(training, 'POST', '/api/admin/platform-enforcement', { cookie: cookieFor(people.admin.uid), body: { userId: uid, mode } });
}

test('legacy users never call Platform and keep full current access; transitions are per user and verified', async () => {
  writeState(DIR, people.b.uid, sampleState());
  const callsBefore = platform.state.calls.length;
  const cookie = cookieFor(people.b.uid);
  assert.equal((await call(training, 'GET', '/api/data', { cookie })).status, 200);
  assert.equal((await call(training, 'GET', '/api/guided', { cookie })).json?.code, undefined);
  assert.equal(platform.state.calls.length, callsBefore, 'legacy mode performs no Platform call');

  assert.equal((await adminSetMode(people.b.uid, 'shadow')).status, 409, 'cannot leave legacy without a link');
  assert.equal((await call(training, 'POST', '/api/admin/platform-enforcement', { cookie, body: { userId: people.b.uid, mode: 'shadow' } })).status, 403, 'only an admin can move a user');
  setCaps('b', 'baseline', { ttlMs: 1500 });
  const linked = await redeem('b'); assert.equal(linked.status, 200);
  assert.equal((await adminSetMode(people.b.uid, 'enforced')).json.error, 'transition_not_allowed', 'legacy -> enforced is not allowed directly');
  assert.equal((await adminSetMode(people.b.uid, 'shadow')).status, 200);
  assert.equal(dbUser(people.b.uid).platformEnforcement, 'shadow');
  assert.equal(dbUser(people.c.uid).platformEnforcement, undefined, 'other users are untouched: there is no global switch');
});

test('shadow mode logs but never blocks; enforced mode applies the V2 capabilities in the API', async () => {
  const cookie = cookieFor(people.b.uid);
  setCaps('b', 'baseline', { ttlMs: 1500 });
  const shadow = await call(training, 'GET', '/api/guided', { cookie });

  assert.notEqual(shadow.json?.code, 'capability_required', 'shadow never blocks');

  setCaps('b', 'baseline', { ttlMs: 1500 });
  assert.equal((await adminSetMode(people.b.uid, 'enforced')).status, 200);

  const state = JSON.parse(JSON.stringify(sampleState()));
  const stateFile = path.join(DIR, `state-${people.b.uid}.json`);
  const before = fs.readFileSync(stateFile, 'utf8');
  const deny = async (method, route, needs) => { const r = await call(training, method, route, { cookie, body: method === 'POST' ? {} : undefined }); assert.equal(r.status, 403, `${method} ${route}`); assert.equal(r.json.code, 'capability_required'); assert.ok(needs.every(n => r.json.capabilities.includes(n))); };
  // FREE BASELINE: own training allowed, commercial / professional / AI denied.
  assert.equal((await call(training, 'GET', '/api/data', { cookie })).status, 200);
  await deny('GET', '/api/guided', ['guidedTraining']);
  await deny('GET', '/api/premium', ['premiumPrograms']);
  await deny('GET', '/api/opposition', ['premiumPrograms']);
  await deny('POST', '/api/coach/plan', ['aiCoach']);
  await deny('POST', '/api/scan/start', ['aiCoach']);
  await deny('GET', '/api/followup', ['professionalFollowUp']);
  assert.equal((await call(training, 'GET', '/api/me/export', { cookie })).status, 200, 'owner data export is never capability-gated');
  assert.equal((await call(training, 'GET', '/api/me', { cookie })).status, 200);

  // Other membership: guided + premium, still no AI / professional follow-up.
  await new Promise(resolve => setTimeout(resolve, 1600)); setCaps('b', 'autonomous', { ttlMs: 1500 });
  assert.notEqual((await call(training, 'GET', '/api/guided', { cookie })).json?.code, 'capability_required', 'autonomous: guided');
  assert.notEqual((await call(training, 'GET', '/api/premium', { cookie })).json?.code, 'capability_required', 'autonomous: premium');
  await deny('POST', '/api/coach/plan', ['aiCoach']);
  await deny('GET', '/api/followup', ['professionalFollowUp']);

  // Fuerza: everything.
  await new Promise(resolve => setTimeout(resolve, 1600)); setCaps('b', 'full', { ttlMs: 1500 });
  for (const route of ['/api/guided', '/api/premium', '/api/followup']) assert.notEqual((await call(training, 'GET', route, { cookie })).json?.code, 'capability_required', route);
  assert.notEqual((await call(training, 'POST', '/api/coach/plan', { cookie, body: {} })).json?.code, 'capability_required', 'full: coach');

  // Administrative suspension blocks operations but removes nothing.
  await new Promise(resolve => setTimeout(resolve, 1600)); setCaps('b', 'suspended', { ttlMs: 1500 });
  await deny('GET', '/api/data', ['workoutHistory']);
  await deny('POST', '/api/activity', ['workoutRecording']);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before, 'routines and history are untouched while suspended');
  assert.equal(dbUser(people.b.uid).platformRestriction.reasonCode, 'ADMIN_SUSPENDED');

  // Platform goes down while suspended: still blocked. Then it is lifted and the baseline returns with all data.
  await new Promise(resolve => setTimeout(resolve, 1600)); platform.state.down = true;
  await deny('GET', '/api/data', ['workoutHistory']);
  platform.state.down = false; setCaps('b', 'baseline', { ttlMs: 1500 });
  const restored = await call(training, 'GET', '/api/data', { cookie });
  assert.equal(restored.status, 200);
  assert.equal(JSON.stringify(restored.json).includes('Full body A'), true, 'existing routines are still there after the suspension is lifted');
  assert.equal(dbUser(people.b.uid).platformRestriction, undefined);
  assert.ok(state);

  // Cache expired + Platform unreachable: free functions survive, paid ones are never granted.
  await new Promise(resolve => setTimeout(resolve, 1600)); platform.state.down = true;
  assert.equal((await call(training, 'GET', '/api/data', { cookie })).status, 200, 'an expired cache is not a block of free functions');
  await deny('GET', '/api/guided', ['guidedTraining']);
  await deny('POST', '/api/coach/plan', ['aiCoach']);
  platform.state.down = false;
});

test('enforcement requires a fresh Platform verification, never a degraded guess', async () => {
  setCaps('e', 'baseline', { ttlMs: 1500 });
  const linked = await redeem('e'); assert.equal(linked.status, 200);
  assert.equal((await adminSetMode(people.e.uid, 'shadow')).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1700));
  platform.state.down = true;
  try {
    const refused = await adminSetMode(people.e.uid, 'enforced');
    assert.equal(refused.status, 409); assert.equal(refused.json.error, 'platform_verification_required');
    assert.equal(dbUser(people.e.uid).platformEnforcement, 'shadow', 'the mode did not change');
  } finally { platform.state.down = false; }
  setCaps('e', 'suspended', { ttlMs: 1500 });
  assert.equal((await adminSetMode(people.e.uid, 'enforced')).json.error, 'platform_verification_required', 'a blocked person cannot be enforced either');
  await new Promise(resolve => setTimeout(resolve, 1700)); setCaps('e', 'baseline', { ttlMs: 1500 });
  assert.equal((await adminSetMode(people.e.uid, 'enforced')).status, 200);
  assert.equal((await adminSetMode(people.e.uid, 'legacy')).json.error, 'transition_not_allowed', 'enforced goes back through shadow');
  assert.equal((await adminSetMode(people.e.uid, 'shadow')).status, 200);
});

test('a revoked link closes the sso sessions and blocks the account until Platform says otherwise', async () => {
  setCaps('c', 'baseline', { ttlMs: 1500 });
  const sso = await redeem('c'); assert.equal(sso.status, 200);
  assert.equal((await call(training, 'GET', '/api/data', { cookie: sso.cookie })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1600));
  setCaps('c', 'revoked', { ttlMs: 1500 });
  const blocked = await call(training, 'GET', '/api/data', { cookie: sso.cookie });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.code, 'platform_access_blocked');
  const afterRevocation = await call(training, 'GET', '/api/me', { cookie: sso.cookie });
  assert.equal(afterRevocation.status, 401, 'the sso session record was revoked');
  assert.equal((await call(training, 'GET', '/api/me', { cookie: cookieFor(people.c.uid) })).status, 200, 'the account itself, its passkey login and its data are untouched');
  const again = await redeem('c', { entry: { status: 403, body: { error: 'training_access_blocked', reasonCode: 'TRAINING_LINK_REVOKED' } } });
  assert.equal(again.status, 403);
});

test('an sso session is always strict, even for a user left in legacy mode', async () => {
  setCaps('d', 'baseline', { ttlMs: 1500 });
  const sso = await redeem('d'); assert.equal(sso.status, 200);
  assert.equal(userMode(dbUser(people.d.uid)), 'legacy');
  const guided = await call(training, 'GET', '/api/guided', { cookie: sso.cookie });
  assert.equal(guided.status, 403); assert.equal(guided.json.code, 'capability_required');
  assert.equal((await call(training, 'GET', '/api/data', { cookie: sso.cookie })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1600)); platform.state.down = true;
  assert.equal((await call(training, 'GET', '/api/data', { cookie: sso.cookie })).status, 200, 'baseline survives an outage');
  assert.equal((await call(training, 'GET', '/api/guided', { cookie: sso.cookie })).status, 403, 'paid rights are not granted without verification');
  platform.state.down = false;
});

test('staff keep their role functions regardless of their own capabilities', async () => {
  const cookie = cookieFor(people.admin.uid);
  setCaps('admin', 'suspended');
  assert.equal((await adminSetMode(people.admin.uid, 'shadow')).status, 409, 'link is required first (unlinked staff stay legacy)');
  assert.equal((await call(training, 'GET', '/api/admin/users', { cookie })).status !== 403, true);
  assert.equal((await call(training, 'GET', '/api/me', { cookie })).status, 200);
});

test('accounts listed in ADMIN_UIDS never get an sso session', async () => {
  const withEnvAdmin = await startTraining({ ADMIN_UIDS: people.envadmin.uid, PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: platform.state.keyId, PLATFORM_API_KEY_SECRET: platformSecret });
  try {
    setCaps('envadmin', 'baseline');
    const code = randomBytes(32).toString('base64url');
    platform.state.codes.set(code, { personId: people.envadmin.personId, trainingUserId: people.envadmin.uid });
    const response = await call(withEnvAdmin, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, origin: withEnvAdmin.base });
    assert.equal(response.status, 403); assert.equal(response.json.error, 'platform_access_blocked');
    assert.equal(response.headers.get('set-cookie'), null, 'no session cookie is issued');
  } finally { withEnvAdmin.stop(); }
});
