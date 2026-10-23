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
test('every route of the EFFECTIVE router (and every literal found in the sources) is classified, and sso sessions are limited to member routes', async () => {
  const { effectiveRoutes, scannedRoutes } = await import('../scripts/route-matrix.mjs');
  const effective = effectiveRoutes();                                   // the keys of the `routes` table server.js really builds
  const found = new Set([...effective, ...scannedRoutes()]);
  for (const computed of ['POST /api/platform/v1/link/activate', 'POST /api/platform/v1/link/revoke', 'POST /api/platform/v1/provision', 'POST /api/platform/v1/sso/confirm']) assert.ok(effective.includes(computed), `${computed} is in the effective router (a source scan cannot see computed keys)`);
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

  down = false; kind = 'suspended'; clock += 6000;
  view = await service.evaluate(user, { mode: 'enforced' });
  assert.equal(view.level, 'blocked'); assert.equal(view.reasonCode, 'ADMIN_SUSPENDED'); assert.equal(user.platformRestriction.reasonCode, 'ADMIN_SUSPENDED');
  clock += 6000; down = true;
  view = await service.evaluate(user, { mode: 'enforced' });
  assert.equal(view.level, 'blocked', 'a known suspension keeps blocking while Platform is unreachable');
  assert.equal(service.allows(view, ['workoutHistory']), false);

  const afterRestart = createCapabilitiesService({ config, now: () => clock, fetchImpl });          // empty memory, restriction persisted on the user
  assert.equal((await afterRestart.evaluate(user, { mode: 'enforced' })).level, 'blocked', 'the restriction survives a restart');

  down = false; kind = 'baseline'; clock += 6000;
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
  const state = { caps: new Map(), forced: new Map(), codes: new Map(), calls: [], down: false, keyId: 'qa-bunker-v1', secret: Buffer.alloc(32, 9) };
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
      if (caps && state.forced.has(caps[1])) { const f = state.forced.get(caps[1]); return reply(f.status, f.body); }
      if (caps) { const make = state.caps.get(caps[1]); return make ? reply(200, make()) : reply(404, { error: 'person_not_found' }); }
      if (req.method === 'POST' && req.url === '/api/internal/platform/v2/sso/redeem') {
        const request = JSON.parse(body.toString('utf8'));
        if (request.v !== 2 || !/^[A-Za-z0-9_-]{43,128}$/.test(request.verifier || '')) return reply(400, { error: 'invalid_sso_request' });
        state.lastRedeem = request;
        const entry = state.codes.get(request.code);
        if (!entry) return reply(404, { error: 'sso_code_not_found' });
        if (entry.used) return reply(409, { error: 'sso_code_already_used' });
        // The real Platform compares the PKCE S256 challenge it stored at issuance; a mismatch neither consumes nor reveals anything.
        if (!entry.challenge || challengeOf(request.verifier) !== entry.challenge) return reply(403, { error: 'sso_binding_mismatch' });
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

const people = Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'staff', 'admin', 'legacy', 'orphan', 'conflict', 'envadmin', 'kiosk', 'keep', 'sfull', 'sother', 'sfree', 'swrite', 'lnk'].map(name => [name, { uid: `uid-${name}`, personId: randomUUID() }]));
const dbFile = path.join(DIR, 'db.json');
fs.writeFileSync(dbFile, JSON.stringify({
  users: [
    ...['a', 'b', 'c', 'd', 'e', 'legacy', 'orphan', 'conflict', 'envadmin', 'kiosk', 'keep', 'sfull', 'sother', 'sfree', 'swrite', 'lnk'].map(name => ({ id: people[name].uid, name: `Member ${name}`, username: name })),
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
for (const name of ['a', 'b', 'c', 'd', 'e', 'staff', 'admin', 'envadmin', 'kiosk', 'keep', 'sfull', 'sother', 'sfree', 'swrite', 'lnk']) seedReceipt(people[name].personId, people[name].uid);
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
const linkKey = { id: 'platform-link-fixture', secret: Buffer.alloc(32, 0x55) };
const training = await startTraining({ PLATFORM_LINK_LIFECYCLE_ENABLED: 'true', PLATFORM_PROVISIONING_ENABLED: 'true', PLATFORM_SERVICE_AUTH_KEYS: JSON.stringify({ [linkKey.id]: linkKey.secret.toString('base64url') }), PLATFORM_SSO_ENABLED: 'true', PLATFORM_HOME_URL: 'http://127.0.0.1:5173', PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: platform.state.keyId, PLATFORM_API_KEY_SECRET: platformSecret, PLATFORM_BREAKER_BASE_MS: '200' });
const plain = await startTraining();            // no Platform configuration at all

/** Signed Platform -> Training lifecycle call (2J-SERVICE-AUTH-V1). */
async function platformCall(server, route, payload, { key = linkKey, requestId = randomUUID(), timestamp = new Date().toISOString(), tamper } = {}) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const { signature } = signPlatformServiceRequest({ keyId: key.id, secret: key.secret, timestamp, requestId, method: 'POST', path: route, body });
  const response = await fetch(server.base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-2j-key-id': key.id, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': tamper ? 'A'.repeat(43) : signature }, body });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: response.status, json };
}
const ACTIVATE = '/api/platform/v1/link/activate', REVOKE = '/api/platform/v1/link/revoke', PROVISION = '/api/platform/v1/provision';
const activateBody = (name, extra = {}) => ({ v: 1, linkId: randomUUID(), linkVersion: 1, personId: people[name].personId, trainingUserId: people[name].uid, origin: 'proof', ...extra });
// Every seeded person that proved ownership gets its link acknowledged by Training, exactly as Platform's activation does.
for (const name of ['a', 'b', 'c', 'd', 'e', 'staff', 'envadmin', 'kiosk', 'keep', 'sfull', 'sother', 'sfree', 'swrite']) {
  const ack = await platformCall(training, ACTIVATE, activateBody(name));
  assert.equal(ack.status, 200, `activate ${name}: ${JSON.stringify(ack.json)}`);
}
after(() => { training.stop(); plain.stop(); platform.server.close(); });

const cookieFor = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
const sessionCookies = headers => (headers.getSetCookie?.() ?? []).filter(item => item.startsWith('gymsid='));
const challengeOf = verifier => crypto.createHash('sha256').update(verifier, 'utf8').digest('base64url');
/** The start of the flow in ONE browser: GET /sso/start without following the redirect. Returns what that browser now holds. */
async function startBrowser(server, headers = {}) {
  const response = await fetch(server.base + '/api/platform/v1/sso/start', { redirect: 'manual', headers });
  const setCookie = response.headers.getSetCookie?.() ?? [];
  const bind = setCookie.find(item => item.startsWith('j2ssob='));
  const location = response.headers.get('location') || '';
  return { status: response.status, location, setCookie, cookie: bind ? bind.split(';')[0] : null, verifier: bind ? bind.split(';')[0].slice('j2ssob='.length) : null, challenge: /#sso_challenge=([A-Za-z0-9_-]{43})$/.exec(location)?.[1] ?? null, response };
}
/**
 * `binding` decides which browser redeems: 'own' (default) — the browser that started the flow, whose challenge Home would have used for the code;
 * 'none' — a browser that never started it (no binding cookie); 'foreign' — a browser that started its own flow, unrelated to the code.
 */
async function call(server, method, route, { cookie, body, origin, binding = 'own', headers = {} } = {}) {
  const redeeming = method === 'POST' && route === '/api/platform/v1/sso/redeem';
  let cookies = cookie ? [cookie] : [];
  if (redeeming && binding !== 'none') {
    const browser = await startBrowser(server, headers);
    if (browser.cookie) {
      cookies.push(browser.cookie);
      const entry = body?.code ? platform.state.codes.get(body.code) : null;
      if (entry && !entry.challenge) entry.challenge = binding === 'foreign' ? challengeOf(randomBytes(32).toString('base64url')) : browser.challenge;
    }
  }
  const response = await fetch(server.base + route, { method, headers: { ...headers, ...(cookies.length ? { cookie: cookies.join('; ') } : {}), ...(body ? { 'content-type': 'application/json' } : {}), ...(origin ? { origin } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json, headers: response.headers };
}
const setCaps = (who, kind, extra = {}) => platform.state.caps.set(people[who].personId, () => v2({ personId: people[who].personId, trainingUserId: people[who].uid, kind, ...extra }));
const dbUser = uid => JSON.parse(fs.readFileSync(dbFile, 'utf8')).users.find(user => user.id === uid);
async function redeem(who, { code = randomBytes(32).toString('base64url'), origin = training.base, entry, headers } = {}) {
  platform.state.codes.set(code, { personId: people[who].personId, trainingUserId: people[who].uid, ...entry });
  const response = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, origin, headers });
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
  assert.equal(conflict.status, 409); assert.equal(conflict.json.error, 'link_not_confirmed', 'a link that Training never acknowledged cannot sign anyone in');
  const refused = await platformCall(training, ACTIVATE, activateBody('conflict'));
  assert.equal(refused.status, 409); assert.equal(refused.json.error, 'link_conflict', 'the same person proven for two Training users is never activated');
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

/** Moves ONE user to enforced the way an administrator does (legacy > shadow > enforced). Sessions follow the user's mode, so capability tests need it. */
async function enforce(who) {
  const uid = people[who].uid;
  const shadow = await adminSetMode(uid, 'shadow'); assert.equal(shadow.status, 200, JSON.stringify(shadow.json));
  const enforced = await adminSetMode(uid, 'enforced'); assert.equal(enforced.status, 200, JSON.stringify(enforced.json));
}

test('legacy users never call Platform and keep full current access; transitions are per user and verified', async () => {
  writeState(DIR, people.b.uid, sampleState());
  const callsBefore = platform.state.calls.length;
  const cookie = cookieFor(people.b.uid);
  assert.equal((await call(training, 'GET', '/api/data', { cookie })).status, 200);
  assert.equal((await call(training, 'GET', '/api/guided', { cookie })).json?.code, undefined);
  assert.equal(platform.state.calls.length, callsBefore, 'legacy mode performs no Platform call');

  assert.equal((await adminSetMode(people.legacy.uid, 'shadow')).status, 409, 'cannot leave legacy without an acknowledged link');
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
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('b', 'autonomous', { ttlMs: 1500 });
  assert.notEqual((await call(training, 'GET', '/api/guided', { cookie })).json?.code, 'capability_required', 'autonomous: guided');
  assert.notEqual((await call(training, 'GET', '/api/premium', { cookie })).json?.code, 'capability_required', 'autonomous: premium');
  await deny('POST', '/api/coach/plan', ['aiCoach']);
  await deny('GET', '/api/followup', ['professionalFollowUp']);

  // Fuerza: everything.
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('b', 'full', { ttlMs: 1500 });
  for (const route of ['/api/guided', '/api/premium', '/api/followup']) assert.notEqual((await call(training, 'GET', route, { cookie })).json?.code, 'capability_required', route);
  assert.notEqual((await call(training, 'POST', '/api/coach/plan', { cookie, body: {} })).json?.code, 'capability_required', 'full: coach');

  // Administrative suspension blocks operations but removes nothing.
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('b', 'suspended', { ttlMs: 1500 });
  await deny('GET', '/api/data', ['workoutHistory']);
  await deny('POST', '/api/activity', ['workoutRecording']);
  assert.equal(fs.readFileSync(stateFile, 'utf8'), before, 'routines and history are untouched while suspended');
  assert.equal(dbUser(people.b.uid).platformRestriction.reasonCode, 'ADMIN_SUSPENDED');

  // Platform goes down while suspended: still blocked. Then it is lifted and the baseline returns with all data.
  await new Promise(resolve => setTimeout(resolve, 1900)); platform.state.down = true;
  await deny('GET', '/api/data', ['workoutHistory']);
  platform.state.down = false; setCaps('b', 'baseline', { ttlMs: 1500 });
  await new Promise(resolve => setTimeout(resolve, 400));          // the circuit breaker (200 ms in tests) lets one probe through again
  const restored = await call(training, 'GET', '/api/data', { cookie });
  assert.equal(restored.status, 200);
  assert.equal(JSON.stringify(restored.json).includes('Full body A'), true, 'existing routines are still there after the suspension is lifted');
  assert.equal(dbUser(people.b.uid).platformRestriction, undefined);
  assert.ok(state);

  // Cache expired + Platform unreachable: free functions survive, paid ones are never granted.
  await new Promise(resolve => setTimeout(resolve, 1900)); platform.state.down = true;
  assert.equal((await call(training, 'GET', '/api/data', { cookie })).status, 200, 'an expired cache is not a block of free functions');
  await deny('GET', '/api/guided', ['guidedTraining']);
  await deny('POST', '/api/coach/plan', ['aiCoach']);
  platform.state.down = false;
});

test('enforcement requires a fresh Platform verification, never a degraded guess', async () => {
  setCaps('e', 'baseline', { ttlMs: 1500 });
  const linked = await redeem('e'); assert.equal(linked.status, 200);
  assert.equal((await adminSetMode(people.e.uid, 'shadow')).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1900));
  platform.state.down = true;
  try {
    const refused = await adminSetMode(people.e.uid, 'enforced');
    assert.equal(refused.status, 409); assert.equal(refused.json.error, 'platform_verification_required');
    assert.equal(dbUser(people.e.uid).platformEnforcement, 'shadow', 'the mode did not change');
  } finally { platform.state.down = false; }
  setCaps('e', 'suspended', { ttlMs: 1500 });
  assert.equal((await adminSetMode(people.e.uid, 'enforced')).json.error, 'platform_verification_required', 'a blocked person cannot be enforced either');
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('e', 'baseline', { ttlMs: 1500 });
  assert.equal((await adminSetMode(people.e.uid, 'enforced')).status, 200);
  assert.equal((await adminSetMode(people.e.uid, 'legacy')).json.error, 'transition_not_allowed', 'enforced goes back through shadow');
  assert.equal((await adminSetMode(people.e.uid, 'shadow')).status, 200);
});

test('a revoked link closes the sso sessions and blocks the account until Platform says otherwise', async () => {
  setCaps('c', 'baseline', { ttlMs: 1500 });
  const sso = await redeem('c'); assert.equal(sso.status, 200);
  await enforce('c');
  assert.equal((await call(training, 'GET', '/api/data', { cookie: sso.cookie })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1900));
  setCaps('c', 'revoked', { ttlMs: 1500 });
  const blocked = await call(training, 'GET', '/api/data', { cookie: sso.cookie });
  assert.equal(blocked.status, 403); assert.equal(blocked.json.code, 'platform_access_blocked');
  const afterRevocation = await call(training, 'GET', '/api/me', { cookie: sso.cookie });
  assert.equal(afterRevocation.status, 401, 'the sso session record was revoked');
  assert.equal((await call(training, 'GET', '/api/me', { cookie: cookieFor(people.c.uid) })).status, 200, 'the account itself, its passkey login and its data are untouched');
  const again = await redeem('c', { entry: { status: 403, body: { error: 'training_access_blocked', reasonCode: 'TRAINING_LINK_REVOKED' } } });
  assert.equal(again.status, 403);
});

test('an sso session follows the mode of the user (H1): legacy keeps its current access, shadow only logs, enforced applies the contract; the route limits of sso never depend on the mode', async () => {
  setCaps('d', 'baseline', { ttlMs: 1500 });
  const sso = await redeem('d'); assert.equal(sso.status, 200);
  assert.equal(userMode(dbUser(people.d.uid)), 'legacy');
  const before = platform.state.calls.length;
  // Legacy: what Búnker gave this user with a passkey is exactly what the Platform sign-in gives; no Platform call at all.
  for (const route of ['/api/guided', '/api/premium', '/api/data']) assert.notEqual((await call(training, 'GET', route, { cookie: sso.cookie })).json?.code, 'capability_required', route);
  assert.equal(platform.state.calls.length, before, 'legacy never calls Platform');
  // The route limits of an sso session hold in every mode: no passkey-only, staff or destructive route.
  for (const route of ['/api/me/passkeys', '/api/me/export', '/api/admin/users']) { const r = await call(training, 'GET', route, { cookie: sso.cookie }); assert.equal(r.status, 403, route); assert.equal(r.json.code, 'passkey_required'); }
  // Shadow: nothing is blocked either.
  assert.equal((await adminSetMode(people.d.uid, 'shadow')).status, 200);
  assert.notEqual((await call(training, 'GET', '/api/guided', { cookie: sso.cookie })).json?.code, 'capability_required');
  // Enforced: the same session becomes strict, and safely degrades during an outage.
  assert.equal((await adminSetMode(people.d.uid, 'enforced')).status, 200);
  const guided = await call(training, 'GET', '/api/guided', { cookie: sso.cookie });
  assert.equal(guided.status, 403); assert.equal(guided.json.code, 'capability_required');
  assert.equal((await call(training, 'GET', '/api/data', { cookie: sso.cookie })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1900)); platform.state.down = true;
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
  const withEnvAdmin = await startTraining({ ADMIN_UIDS: people.envadmin.uid, PLATFORM_SSO_ENABLED: 'true', PLATFORM_HOME_URL: 'http://127.0.0.1:5173', PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: platform.state.keyId, PLATFORM_API_KEY_SECRET: platformSecret, PLATFORM_BREAKER_BASE_MS: '200' });
  try {
    setCaps('envadmin', 'baseline');
    const code = randomBytes(32).toString('base64url');
    platform.state.codes.set(code, { personId: people.envadmin.personId, trainingUserId: people.envadmin.uid });
    const response = await call(withEnvAdmin, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, origin: withEnvAdmin.base });
    assert.equal(response.status, 403); assert.equal(response.json.error, 'platform_access_blocked');
    assert.equal(sessionCookies(response.headers).length, 0, 'no session cookie is issued');
  } finally { withEnvAdmin.stop(); }
});

test('redeeming again with a live sso cookie works and leaves exactly one live sso session', async () => {
  setCaps('keep', 'baseline');
  const first = await redeem('keep'); assert.equal(first.status, 200);
  const live = () => JSON.parse(fs.readFileSync(dbFile, 'utf8')).deviceSessions.filter(item => item.userId === people.keep.uid && item.via === 'sso' && !item.revokedAt).length;
  assert.equal(live(), 1);
  const code = 'again'.padEnd(43, 'y');
  platform.state.codes.set(code, { personId: people.keep.personId, trainingUserId: people.keep.uid });
  const again = await call(training, 'POST', '/api/platform/v1/sso/redeem', { cookie: first.cookie, body: { v: 1, code }, origin: training.base });
  assert.equal(again.status, 200, JSON.stringify(again.json));
  const cookie = (again.headers.get('set-cookie') || '').split(';')[0];
  assert.ok(cookie && cookie !== first.cookie);
  assert.equal(live(), 1, 'the previous sso session was retired');
  assert.equal((await call(training, 'GET', '/api/me', { cookie: first.cookie })).status, 401);
  assert.equal((await call(training, 'GET', '/api/me', { cookie })).status, 200);
});

test('redeeming while holding a passkey session of the same account keeps the passkey session', async () => {
  setCaps('keep', 'baseline');
  const passkey = cookieFor(people.keep.uid), code = 'keepp'.padEnd(43, 'z');
  platform.state.codes.set(code, { personId: people.keep.personId, trainingUserId: people.keep.uid });
  const response = await call(training, 'POST', '/api/platform/v1/sso/redeem', { cookie: passkey, body: { v: 1, code }, origin: training.base });
  assert.equal(response.status, 200); assert.equal(response.json.sessionKept, true); assert.equal(response.json.user.authLevel, 'passkey');
  assert.equal(sessionCookies(response.headers).length, 0, 'the stronger cookie is not replaced');
  assert.equal((await call(training, 'GET', '/api/me', { cookie: passkey })).json.user.authLevel, 'passkey');
  // A session of ANOTHER account is NOT replaced silently any more (H3): it needs an explicit confirmation.
  const otherCode = 'other'.padEnd(43, 'w');
  platform.state.codes.set(otherCode, { personId: people.keep.personId, trainingUserId: people.keep.uid });
  const other = await call(training, 'POST', '/api/platform/v1/sso/redeem', { cookie: cookieFor(people.a.uid), body: { v: 1, code: otherCode }, origin: training.base });
  assert.equal(other.status, 409); assert.equal(other.json.error, 'session_switch_confirmation_required'); assert.equal(sessionCookies(other.headers).length, 0);
});

test('SSO sign-ins leave a Búnker-side security event and an sso session cannot revoke passkey sessions', async () => {
  setCaps('keep', 'baseline');
  const sso = await redeem('keep'); assert.equal(sso.status, 200);
  const events = (await call(training, 'GET', '/api/me/security-events', { cookie: cookieFor(people.keep.uid) })).json.events;
  assert.ok(events.some(item => item.event === 'platform_sso_login'), JSON.stringify(events).slice(0, 300));
  const revoke = await call(training, 'POST', '/api/me/sessions/revoke', { cookie: sso.cookie, body: { id: 'whatever' } });
  assert.equal(revoke.status, 403); assert.equal(revoke.json.code, 'passkey_required');
});

test('SSO failures use their own limiter: they never block passkey login', async () => {
  const limited = await startTraining({ PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: platform.state.keyId, PLATFORM_API_KEY_SECRET: platformSecret, PLATFORM_BREAKER_BASE_MS: '200' });
  try {
    const statuses = [];
    for (let index = 0; index < 24; index += 1) statuses.push((await call(limited, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: randomBytes(32).toString('base64url') }, origin: limited.base })).status);
    assert.ok(statuses.includes(429), 'repeated failures are limited');
    const login = await call(limited, 'POST', '/api/login/verify', { body: { cid: 'none', credential: {} } });
    assert.notEqual(login.status, 429, 'the login limiter is untouched by SSO failures');
  } finally { limited.stop(); }
});

test('session-authenticated Búnker routes (pin, pin reset, handoff) and kiosk check-in follow the capability gate', async () => {
  const uid = people.kiosk.uid, cookie = cookieFor(uid);
  setCaps('kiosk', 'baseline', { ttlMs: 1500 });
  assert.equal((await redeem('kiosk')).status, 200);
  assert.equal((await adminSetMode(uid, 'shadow')).status, 200);
  assert.equal((await adminSetMode(uid, 'enforced')).status, 200);
  const pin = await call(training, 'GET', '/api/bunker/pin', { cookie });
  assert.equal(pin.status, 200, JSON.stringify(pin.json));
  const checkin = value => call(training, 'POST', '/api/bunker/checkin', { body: { pin: value } });
  assert.equal((await checkin(pin.json.pin)).status, 200, 'baseline can check in at the kiosk');
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('kiosk', 'suspended', { ttlMs: 1500 });
  const denied = await checkin(pin.json.pin);
  assert.equal(denied.status, 403); assert.equal(denied.json.code, 'capability_required'); assert.equal(denied.json.reasonCode, 'ADMIN_SUSPENDED');
  for (const [method, route] of [['GET', '/api/bunker/pin'], ['POST', '/api/bunker/pin/reset'], ['POST', '/api/bunker/handoff']]) {
    const r = await call(training, method, route, { cookie, body: method === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, `${method} ${route}`); assert.equal(r.json.code, 'capability_required');
  }
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('kiosk', 'baseline', { ttlMs: 1500 });
  assert.equal((await checkin(pin.json.pin)).status, 200, 'lifting restores kiosk access with the same PIN');
});

/* ---- content-level authorization of the synced member state (same route, different operations) ---- */
const consentValue = { agreedAt: '2026-10-01T00:00:00.000Z', version: 1 };
async function readSync(cookie) { return (await call(training, 'GET', '/api/sync', { cookie })).json; }
async function syncSave(cookie, change, extra = {}) {
  const envelope = await readSync(cookie), state = JSON.parse(JSON.stringify(envelope.state || {}));
  change(state);
  return call(training, 'POST', '/api/sync', { cookie, body: { operationId: randomUUID(), revision: envelope.meta.revision, generation: envelope.meta.generation, type: 'save', state, ...extra } });
}
const guided = (id, extra = {}) => ({ id, name: `Guiada ${id}`, source: 'guided-v2', catalogId: `cat-${id}`, status: 'assigned', routineIds: [], ...extra });

test('free users keep saving personal content through /api/sync while paid subtrees and guided programs are ignored, not erased', async () => {
  setCaps('sfull', 'full', { ttlMs: 1500 });
  const fullSession = await redeem('sfull'); assert.equal(fullSession.status, 200);
  await enforce('sfull');
  // Fuerza writes everything, including paid subtrees and a guided program.
  const seeded = await syncSave(fullSession.cookie, state => {
    state.routines = [{ id: 'r-own', name: 'Mi rutina', ex: [] }];
    state.programs = [guided('g1')];
    state.premium = { v: 1, active: { id: 'inst', week: 2 }, history: [] };
    state.opposition = { v: 1, plan: { id: 'plan-1' }, history: [] };
    state.coach = { consent: consentValue, profile: { goal: 'muscle' } };
    state.workouts = [{ id: 'w1', d: '2026-09-01' }];
  });
  assert.equal(seeded.status, 200, JSON.stringify(seeded.json));
  assert.equal(seeded.json.platformStripped, undefined, 'a paid user is not touched');
  const stored = (await readSync(fullSession.cookie)).state;
  assert.ok(stored.premium && stored.opposition && stored.coach && stored.programs.some(p => p.id === 'g1'));

  // The same person later has no fee: wait for the cached Fuerza answer to expire and Platform to say baseline.
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('sfull', 'baseline', { ttlMs: 1500 });
  const result = await syncSave(fullSession.cookie, state => {
    state.routines.push({ id: 'r-new', name: 'Nueva gratis', ex: [] });          // free: personal creation
    state.routines[0].name = 'Renombrada';                                         // free: personal edit
    state.workouts.push({ id: 'w2', d: '2026-10-22' });                            // free: recording
    state.premium.active = { id: 'forged', week: 9 };                              // paid: not allowed
    state.coach.profile.goal = 'forged';                                           // paid: not allowed
    state.programs.push(guided('g2'));                                             // paid: not allowed
    state.activeProgramId = 'g2';                                                  // paid: not allowed
  });
  assert.equal(result.status, 200, JSON.stringify(result.json));
  assert.deepEqual([...result.json.platformStripped].sort(), ['programs.guided.activated', 'programs.guided.added', 'state.coach', 'state.premium']);
  const after = (await readSync(fullSession.cookie)).state;
  assert.equal(after.routines.find(r => r.id === 'r-new').name, 'Nueva gratis'); assert.equal(after.routines.find(r => r.id === 'r-own').name, 'Renombrada');
  assert.equal(after.workouts.length, 2, 'the new workout was recorded and the old one is still there');
  assert.deepEqual(after.premium.active, { id: 'inst', week: 2 }, 'the paid subtree kept what the server had');
  assert.equal(after.coach.profile.goal, 'muscle'); assert.equal(after.programs.some(p => p.id === 'g2'), false); assert.ok(after.programs.some(p => p.id === 'g1'), 'the existing guided program is preserved');
  assert.ok(after.opposition, 'nothing was erased');

  // Reducing is always allowed for a free user: withdraw the Coach consent, clear Premium, delete the guided program.
  const reduced = await syncSave(fullSession.cookie, state => { state.coach.consent = null; state.premium = null; delete state.opposition; state.programs = state.programs.filter(p => p.id !== 'g1'); }, { deletes: { programs: ['g1'] } });
  assert.equal(reduced.status, 200, JSON.stringify(reduced.json));
  const cleared = (await readSync(fullSession.cookie)).state;
  assert.equal(cleared.coach.consent, null); assert.ok(!cleared.premium); assert.ok(!cleared.opposition); assert.equal(cleared.programs.some(p => p.id === 'g1'), false);
  assert.ok(cleared.routines.length === 2 && cleared.workouts.length === 2, 'personal routines and history are untouched');
});

test('the other fee unlocks guided and Premium content but not the AI Coach; Fuerza unlocks all', async () => {
  setCaps('sother', 'autonomous', { ttlMs: 1500 });
  const other = await redeem('sother'); assert.equal(other.status, 200);
  await enforce('sother');
  const result = await syncSave(other.cookie, state => {
    state.premium = { v: 1, active: { id: 'inst' }, history: [] };
    state.programs = [guided('g1', { status: 'active' })]; state.activeProgramId = 'g1';
    state.coach = { consent: consentValue, profile: { goal: 'muscle' } };
  });
  assert.equal(result.status, 200); assert.deepEqual(result.json.platformStripped, ['state.coach']);
  const stored = (await readSync(other.cookie)).state;
  assert.ok(stored.premium); assert.equal(stored.activeProgramId, 'g1'); assert.equal(stored.coach, undefined);
});

test('legacy users and staff are not subject to the state policy, and Coach withdrawal routes never depend on a fee', async () => {
  const cookie = cookieFor(people.legacy.uid);
  const saved = await syncSave(cookie, state => { state.premium = { v: 1, active: { id: 'legacy' } }; state.programs = [guided('gl')]; state.coach = { consent: consentValue, profile: {} }; });
  assert.equal(saved.status, 200); assert.equal(saved.json.platformStripped, undefined);
  const stored = (await readSync(cookie)).state;
  assert.ok(stored.premium && stored.coach && stored.programs.some(p => p.id === 'gl'), 'historical users keep today\'s behaviour');
  // An enforced baseline user can still forget Coach data and read the disclosure.
  setCaps('sfree', 'baseline', { ttlMs: 1500 });
  const free = await redeem('sfree'); assert.equal(free.status, 200);
  assert.equal((await adminSetMode(people.sfree.uid, 'shadow')).status, 200); assert.equal((await adminSetMode(people.sfree.uid, 'enforced')).status, 200);
  const disclosure = await call(training, 'GET', '/api/coach/disclosure', { cookie: free.cookie });
  assert.notEqual(disclosure.json?.code, 'capability_required');
  const forget = await call(training, 'POST', '/api/coach/forget', { cookie: cookieFor(people.sfree.uid), body: {} });
  assert.notEqual(forget.json?.code, 'capability_required', 'withdrawing consent is never fee-gated');
  const plan = await call(training, 'POST', '/api/coach/plan', { cookie: free.cookie, body: {} });
  assert.equal(plan.status, 403); assert.equal(plan.json.code, 'capability_required');
});

/* ---- bilateral link lifecycle: activation needs the owner's own proof, one link per side, safe revocation ---- */
test('lifecycle calls are off without their flag and need a valid, single-use Platform signature', async () => {
  const body = activateBody('lnk');
  assert.equal((await platformCall(plain, ACTIVATE, body)).status, 423, 'flag off');
  assert.equal((await platformCall(training, ACTIVATE, body, { tamper: true })).status, 401, 'bad signature');
  assert.equal((await platformCall(training, ACTIVATE, body, { key: { id: 'unknown-key', secret: Buffer.alloc(32, 1) } })).status, 401, 'unknown key');
  assert.equal((await platformCall(training, ACTIVATE, body, { timestamp: new Date(Date.now() - 120_000).toISOString() })).status, 401, 'stale timestamp');
  assert.equal((await platformCall(training, ACTIVATE, { ...body, extra: true })).status, 400, 'unknown field');
  assert.equal((await call(training, 'POST', ACTIVATE, { body })).status, 401, 'no signature at all');
  const requestId = randomUUID();
  const first = await platformCall(training, ACTIVATE, body, { requestId });
  assert.equal(first.status, 200, JSON.stringify(first.json));
  const replay = await platformCall(training, ACTIVATE, body, { requestId });
  assert.equal(replay.status, 409); assert.equal(replay.json.error, 'service_request_replayed', 'a captured request cannot be replayed');
  const again = await platformCall(training, ACTIVATE, body);
  assert.equal(again.status, 200); assert.equal(again.json.replay, true); assert.equal(again.json.ackId, first.json.ackId, 'a retry of the same link is idempotent');
});

test('activation needs the account owner\'s own proof, and a person or a Training user can only hold one link', async () => {
  // A historical account with no receipt cannot be linked by anyone, whatever Platform says.
  const historical = await platformCall(training, ACTIVATE, activateBody('legacy'));
  assert.equal(historical.status, 409); assert.equal(historical.json.error, 'proof_required');
  assert.equal(dbUser(people.legacy.uid).platformLink, undefined); assert.equal(dbUser(people.legacy.uid).personId, undefined);
  // 'provisioned' origin is only for accounts created by the provisioning call.
  assert.equal((await platformCall(training, ACTIVATE, activateBody('legacy', { origin: 'provisioned' }))).json.error, 'not_provisioned');
  // Unknown account, and a wrong receipt id.
  assert.equal((await platformCall(training, ACTIVATE, activateBody('lnk', { trainingUserId: 'does-not-exist' }))).status, 404);
  assert.equal((await platformCall(training, ACTIVATE, activateBody('lnk', { receiptId: randomUUID() }))).json.error, 'proof_required');
  // The same person can not take a second Training user, and a Training user can not take a second person.
  const secondUser = await platformCall(training, ACTIVATE, activateBody('a', { trainingUserId: people.b.uid }));
  assert.equal(secondUser.status, 409); assert.equal(secondUser.json.error, 'link_conflict');
  const secondPerson = await platformCall(training, ACTIVATE, activateBody('a', { personId: people.b.personId }));
  assert.equal(secondPerson.status, 409); assert.equal(secondPerson.json.error, 'link_conflict');
  assert.equal(dbUser(people.a.uid).platformLink.personId, people.a.personId, 'the existing links are untouched');
});

test('revocation closes the sso sessions, frees the person, never relaxes enforcement, and an old receipt cannot silently re-link', async () => {
  setCaps('lnk', 'baseline', { ttlMs: 1500 });
  assert.equal((await platformCall(training, ACTIVATE, activateBody('lnk'))).status, 200);
  const linkId = dbUser(people.lnk.uid).platformLink.linkId;
  const sso = await redeem('lnk'); assert.equal(sso.status, 200);
  assert.equal((await adminSetMode(people.lnk.uid, 'shadow')).status, 200);
  const revoke = await platformCall(training, REVOKE, { v: 1, linkId, linkVersion: 2, personId: people.lnk.personId, trainingUserId: people.lnk.uid, reason: 'member' });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.json)); assert.equal(revoke.json.status, 'revoked');
  const stored = dbUser(people.lnk.uid);
  assert.equal(stored.platformLink.state, 'revoked'); assert.equal(stored.personId, undefined); assert.equal(stored.platformEnforcement, 'shadow', 'enforcement is never relaxed');
  assert.equal((await call(training, 'GET', '/api/me', { cookie: sso.cookie })).status, 401, 'sso sessions are closed');
  assert.equal((await call(training, 'GET', '/api/me', { cookie: cookieFor(people.lnk.uid) })).status, 200, 'the account, its passkey login and its data remain');
  assert.equal((await platformCall(training, REVOKE, { v: 1, linkId, linkVersion: 2, personId: people.lnk.personId, trainingUserId: people.lnk.uid })).json.status, 'revoked', 'revoking twice is harmless');
  assert.equal((await platformCall(training, REVOKE, { v: 1, linkId: randomUUID(), linkVersion: 2, personId: people.lnk.personId, trainingUserId: people.lnk.uid })).status, 404, 'a different link id is refused');
  assert.equal((await redeem('lnk')).json.error, 'link_not_confirmed', 'a revoked link cannot sign in');
  // The OLD receipt cannot silently re-link the account: a new proof, made after the revocation, is required.
  const old = await platformCall(training, ACTIVATE, activateBody('lnk'));
  assert.equal(old.status, 409); assert.equal(old.json.error, 'proof_required');
  await new Promise(resolve => setTimeout(resolve, 20));
  seedReceipt(people.lnk.personId, people.lnk.uid);
  const relinked = await platformCall(training, ACTIVATE, activateBody('lnk'));
  assert.equal(relinked.status, 200, JSON.stringify(relinked.json));
  assert.equal(dbUser(people.lnk.uid).platformLink.state, 'active');
});

test('provisioning is idempotent, creates one enforced profile without credentials, and its link needs the acknowledgement', async () => {
  const personId = randomUUID(), key = randomUUID();
  const body = { v: 1, idempotencyKey: key, correlationId: randomUUID(), personId, displayName: 'Nuevo Socio' };
  assert.equal((await platformCall(plain, PROVISION, body)).status, 423, 'flag off');
  const created = await platformCall(training, PROVISION, body);
  assert.equal(created.status, 201, JSON.stringify(created.json)); assert.equal(created.json.linkState, 'pending');
  const uid = created.json.trainingUserId;
  const user = dbUser(uid);
  assert.equal(user.name, 'Nuevo Socio'); assert.equal(user.personId, personId); assert.equal(user.platformEnforcement, 'enforced');
  assert.equal(user.platformLink.origin, 'provisioned'); assert.equal(user.platformLink.state, 'pending');
  assert.equal(JSON.parse(fs.readFileSync(dbFile, 'utf8')).creds.filter(c => c.userId === uid).length, 0, 'no passkey is invented');
  const replay = await platformCall(training, PROVISION, { ...body, correlationId: randomUUID() });
  assert.equal(replay.status, 200); assert.equal(replay.json.replay, true); assert.equal(replay.json.trainingUserId, uid, 'a retry returns the same profile');
  assert.equal((await platformCall(training, PROVISION, { ...body, displayName: 'Otro Nombre' })).json.error, 'idempotency_conflict');
  assert.equal((await platformCall(training, PROVISION, { ...body, idempotencyKey: randomUUID() })).json.error, 'link_conflict', 'the same person never gets a second profile');
  assert.equal((await platformCall(training, PROVISION, { ...body, idempotencyKey: randomUUID(), personId: people.a.personId })).json.error, 'link_conflict', 'a person already linked to a historical account is refused');
  assert.equal((await platformCall(training, PROVISION, { ...body, idempotencyKey: randomUUID(), personId: randomUUID(), displayName: '<script>' })).status, 400);
  assert.equal(JSON.parse(fs.readFileSync(dbFile, 'utf8')).users.filter(u => u.personId === personId).length, 1, 'exactly one profile');
  // Until Platform's activation is acknowledged, nothing can sign in.
  platform.state.caps.set(personId, () => v2({ personId, trainingUserId: uid, kind: 'baseline' }));
  platform.state.codes.set('prov0'.padEnd(43, 'p'), { personId, trainingUserId: uid });
  assert.equal((await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: 'prov0'.padEnd(43, 'p') }, origin: training.base })).json.error, 'link_not_confirmed');
  const activated = await platformCall(training, ACTIVATE, { v: 1, linkId: randomUUID(), linkVersion: 1, personId, trainingUserId: uid, origin: 'provisioned' });
  assert.equal(activated.status, 200, JSON.stringify(activated.json));
  platform.state.codes.set('prov1'.padEnd(43, 'p'), { personId, trainingUserId: uid });
  const session = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code: 'prov1'.padEnd(43, 'p') }, origin: training.base });
  assert.equal(session.status, 200, JSON.stringify(session.json));
  assert.equal(session.json.user.authLevel, 'sso'); assert.equal(session.json.user.admin, false);
  // Revoking a provisioned account keeps it enforced: it never falls back to the open legacy behaviour.
  const revoked = await platformCall(training, REVOKE, { v: 1, linkId: dbUser(uid).platformLink.linkId, linkVersion: 2, personId, trainingUserId: uid });
  assert.equal(revoked.status, 200);
  assert.equal(dbUser(uid).platformEnforcement, 'enforced'); assert.equal(dbUser(uid).platformLink.state, 'revoked');
  const cookie = (session.headers.get('set-cookie') || '').split(';')[0];
  assert.equal((await call(training, 'GET', '/api/me', { cookie })).status, 401);
  assert.equal((await platformCall(training, ACTIVATE, { v: 1, linkId: randomUUID(), linkVersion: 3, personId, trainingUserId: uid, origin: 'provisioned' })).json.error, 'not_provisioned', 'a revoked provisioned account is not re-activated without a new provisioning decision');
});

test('an enforced account whose link is not active is blocked everywhere, never opened', async () => {
  const uid = people.kiosk.uid, cookie = cookieFor(uid);
  const stored = JSON.parse(fs.readFileSync(dbFile, 'utf8')).users.find(user => user.id === uid);
  assert.equal(stored.platformEnforcement, 'enforced');
  assert.equal((await platformCall(training, REVOKE, { v: 1, linkId: stored.platformLink.linkId, linkVersion: 2, personId: people.kiosk.personId, trainingUserId: uid })).status, 200);
  const data = await call(training, 'GET', '/api/data', { cookie });
  assert.equal(data.status, 403); assert.equal(data.json.code, 'platform_link_inactive');
  const pin = await call(training, 'GET', '/api/bunker/pin', { cookie });
  assert.equal(pin.status, 403);
  assert.equal((await call(training, 'GET', '/api/me', { cookie })).status, 200, 'the account itself stays reachable');
});

/* ---- security closure: EVERY route that writes member state, attacked by an enforced no-fee session ---- */
// Inventory of writers (grep of writeState / mutate, see docs/security/2J-INT-CLOSURE-state-write-routes.md):
//   POST /api/sync (save|replace|reset|delete)   PUT /api/data   POST /api/workouts/delete   POST /api/active/activity   POST /api/active/clear
//   POST /api/active/finish-inactive   POST /api/bunker/finish (kiosk token)   POST /api/bunker/handoff   plus Coach / Premium / follow-up routes (route gate)
const paidSeed = () => ({
  ...sampleState(),
  routines: [{ id: 'r-own', name: 'Mi rutina', ex: [] }],
  programs: [guided('g1'), { id: 'p-own', name: 'Mi programa', routineIds: [] }],
  premium: { v: 1, active: { id: 'inst', week: 2 }, history: [] },
  opposition: { v: 1, plan: { id: 'plan-1' }, history: [] },
  coach: { consent: consentValue, profile: { goal: 'muscle' } },
  workouts: [{ id: 'w1', d: '2026-09-01', entries: [] }],
});
const paidView = state => JSON.stringify({ premium: state.premium, opposition: state.opposition, coach: state.coach, guided: (state.programs || []).filter(p => p.source === 'guided-v2'), activeProgramId: state.activeProgramId ?? null });
const forgedPaid = state => {
  state.premium = { v: 1, active: { id: 'forged', week: 9 }, history: [] };
  state.opposition = { v: 1, plan: { id: 'forged' }, history: [] };
  state.coach = { consent: consentValue, profile: { goal: 'forged' } };
  state.programs = [...(state.programs || []).map(p => (p.source === 'guided-v2' ? { ...p, name: 'forged' } : p)), guided('g-forged')];
  state.activeProgramId = 'g-forged';
};
const stateOf = async cookie => (await call(training, 'GET', '/api/data', { cookie })).json.state;

test('PUT /api/data, /api/workouts/delete and the active-session routes cannot add or alter paid content for a no-fee enforced account', async () => {
  const uid = people.swrite.uid;
  writeState(DIR, uid, paidSeed());
  setCaps('swrite', 'baseline', { ttlMs: 1500 });
  const session = await redeem('swrite'); assert.equal(session.status, 200); await enforce('swrite');
  const before = paidView(await stateOf(session.cookie));
  const attacked = async (label, run) => { const r = await run(); assert.equal(paidView(await stateOf(session.cookie)), before, `${label} left paid content untouched (${r.status})`); return r; };

  // PUT: forged paid content plus a legitimate personal change in the same request.
  const put = await attacked('PUT /api/data', async () => {
    const state = JSON.parse(JSON.stringify(await stateOf(session.cookie))); forgedPaid(state); state.routines.push({ id: 'r-new', name: 'Nueva gratis', ex: [] });
    return call(training, 'PUT', '/api/data', { cookie: session.cookie, body: { state } });
  });
  assert.equal(put.status, 200); assert.ok((await stateOf(session.cookie)).routines.some(r => r.id === 'r-new'), 'the free part of the same request was saved');
  assert.ok(!(await stateOf(session.cookie)).programs.some(p => p.id === 'g-forged'));
  // Route-shape tricks do not reach the writer: trailing slash, duplicate slash, encoded dots, query, lowercase method.
  for (const [method, route] of [['PUT', '/api/data/'], ['PUT', '//api/data'], ['PUT', '/api/data/..%2fdata'], ['put', '/api/data?x=1']]) {
    const r = await attacked(`${method} ${route}`, async () => {
      const state = JSON.parse(JSON.stringify(await stateOf(session.cookie))); forgedPaid(state);
      const response = await fetch(training.base + route, { method, headers: { cookie: session.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ state }) });
      return { status: response.status };
    });
    assert.ok(r.status !== 500, `${method} ${route}`);
  }
  // Extra fields riding on routes that only take a workout or an id are never merged into the state.
  await attacked('POST /api/workouts/delete', () => call(training, 'POST', '/api/workouts/delete', { cookie: session.cookie, body: { id: 'w1', premium: { forged: true }, coach: { forged: true }, state: { premium: { forged: true } } } }));
  assert.ok(!(await stateOf(session.cookie)).workouts.some(w => w.id === 'w1'), 'the personal workout delete itself works');
  const active = { id: 'act-1', d: '2026-10-23', name: 'Sesión', start: Date.now() - 60_000, entries: [], premium: { forged: true }, coach: { forged: true } };
  await attacked('POST /api/active/clear', () => call(training, 'POST', '/api/active/clear', { cookie: session.cookie, body: { id: 'none', premium: { forged: true } } }));
  await attacked('POST /api/active/activity', () => call(training, 'POST', '/api/active/activity', { cookie: session.cookie, body: { id: 'act-1', at: Date.now(), premium: { forged: true } } }));
  await attacked('POST /api/active/finish-inactive', () => call(training, 'POST', '/api/active/finish-inactive', { cookie: session.cookie, body: { workout: { id: 'wf-1', d: '2026-10-23', entries: [], premium: { forged: true }, coach: { forged: true } }, candidate: active, state: { premium: { forged: true } } } }));
  // Hand-off (passkey session in enforced mode) and kiosk finish (bunker token) with extra commercial fields.
  assert.equal((await adminSetMode(uid, 'shadow')).status, 200); assert.equal((await adminSetMode(uid, 'enforced')).status, 200);
  const passkey = cookieFor(uid);
  await attacked('POST /api/bunker/handoff', () => call(training, 'POST', '/api/bunker/handoff', { cookie: passkey, body: { active, state: { premium: { forged: true } }, coach: { forged: true } } }));
  const pin = await call(training, 'GET', '/api/bunker/pin', { cookie: passkey }); assert.equal(pin.status, 200, JSON.stringify(pin.json));
  const checkin = await call(training, 'POST', '/api/bunker/checkin', { body: { pin: pin.json.pin } }); assert.equal(checkin.status, 200);
  await attacked('POST /api/bunker/finish', async () => {
    const response = await fetch(training.base + '/api/bunker/finish', { method: 'POST', headers: { authorization: `Bearer ${checkin.json.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ workout: { id: 'act-1', d: '2026-10-23', entries: [], premium: { forged: true }, coach: { forged: true }, programId: 'g-forged' }, state: { premium: { forged: true } } }) });
    return { status: response.status };
  });
});

test('every sync operation type (save, replace, reset, delete) is authorized by content; unknown types and malformed bodies write nothing', async () => {
  const uid = people.swrite.uid;
  writeState(DIR, uid, paidSeed());                                         // fresh server state with paid content a past fee created
  setCaps('swrite', 'baseline', { ttlMs: 1500 });
  const session = await redeem('swrite'); assert.equal(session.status, 200); await enforce('swrite');
  const view = async () => paidView((await readSync(session.cookie)).state);
  const before = await view();
  for (const type of ['save', 'replace', 'reset']) {
    const envelope = await readSync(session.cookie), state = JSON.parse(JSON.stringify(envelope.state)); forgedPaid(state);
    const r = await call(training, 'POST', '/api/sync', { cookie: session.cookie, body: { operationId: randomUUID(), revision: envelope.meta.revision, generation: envelope.meta.generation, type, state } });
    assert.equal(r.status, 200, `${type}: ${JSON.stringify(r.json)}`);
    assert.ok(r.json.platformStripped.includes('state.premium') && r.json.platformStripped.includes('state.coach'), `${type} strips paid subtrees`);
    assert.equal(await view(), before, `${type} left paid content untouched`);
  }
  const clean = await readSync(session.cookie);
  const unknown = await call(training, 'POST', '/api/sync', { cookie: session.cookie, body: { operationId: randomUUID(), revision: clean.meta.revision, generation: clean.meta.generation, type: 'merge', state: { premium: { forged: true } } } });
  assert.equal(unknown.status, 400);
  const malformed = await call(training, 'POST', '/api/sync', { cookie: session.cookie, body: { operationId: randomUUID(), revision: clean.meta.revision, generation: clean.meta.generation, type: 'save', state: [] } });
  assert.ok([400, 403].includes(malformed.status));
  assert.equal(await view(), before);
  // Once Sync V2 is on, the legacy full-file PUT cannot be used as a side door.
  const state = JSON.parse(JSON.stringify((await readSync(session.cookie)).state)); forgedPaid(state);
  const put = await call(training, 'PUT', '/api/data', { cookie: session.cookie, body: { state } });
  assert.equal(put.status, 409); assert.equal(await view(), before);
  // A delete operation only ever removes; deleting the guided program is a reduction and is allowed, nothing else changes.
  const envelope = await readSync(session.cookie);
  const del = await call(training, 'POST', '/api/sync', { cookie: session.cookie, body: { operationId: randomUUID(), revision: envelope.meta.revision, generation: envelope.meta.generation, type: 'delete', kind: 'programs', id: 'g1' } });
  assert.equal(del.status, 200);
  const after = (await readSync(session.cookie)).state;
  assert.ok(!after.programs.some(p => p.id === 'g1') && after.premium && after.coach, 'only the requested entity was removed');
});

test('commercial feature routes refuse an enforced no-fee account (Coach, Premium, Opposition, follow-up)', async () => {
  setCaps('swrite', 'baseline', { ttlMs: 1500 });
  const session = await redeem('swrite'); assert.equal(session.status, 200); await enforce('swrite');
  for (const [method, route] of [['POST', '/api/coach/plan'], ['POST', '/api/coach/review'], ['POST', '/api/coach/pending/resolve'], ['POST', '/api/premium/started'], ['POST', '/api/opposition/started'], ['POST', '/api/followup/questionnaire/submit'], ['POST', '/api/followup/photo'], ['GET', '/api/guided'], ['GET', '/api/premium'], ['GET', '/api/opposition']]) {
    const r = await call(training, method, route, { cookie: session.cookie, body: method === 'POST' ? { forged: true } : undefined });
    assert.equal(r.status, 403, `${method} ${route} -> ${r.status}`); assert.equal(r.json.code, 'capability_required', `${method} ${route}`);
  }
});

test('a suspended (blocked) account cannot write state through any route', async () => {
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('swrite', 'suspended', { ttlMs: 1500 });
  const session = await redeem('swrite');
  const cookie = session.status === 200 ? session.cookie : cookieFor(people.swrite.uid);
  for (const [method, route, body] of [['PUT', '/api/data', { state: { routines: [] } }], ['POST', '/api/sync', { operationId: randomUUID(), revision: 0, generation: 0, type: 'save', state: {} }], ['POST', '/api/workouts/delete', { id: 'w1' }], ['POST', '/api/active/clear', { id: 'x' }]]) {
    const r = await call(training, method, route, { cookie, body });
    assert.equal(r.status, 403, `${method} ${route} -> ${r.status}`);
  }
});

test('a non-object state is rejected before it can replace or wipe the stored state', async () => {
  setCaps('swrite', 'baseline', { ttlMs: 1500 });
  await new Promise(resolve => setTimeout(resolve, 1900));
  const session = await redeem('swrite'); assert.equal(session.status, 200); await enforce('swrite');
  const before = JSON.stringify((await readSync(session.cookie)).state);
  const envelope = await readSync(session.cookie);
  for (const bad of [[], 'x', 5]) {
    const r = await call(training, 'POST', '/api/sync', { cookie: session.cookie, body: { operationId: randomUUID(), revision: envelope.meta.revision, generation: envelope.meta.generation, type: 'save', state: bad } });
    assert.equal(r.status, 400, JSON.stringify(bad));
  }
  assert.equal(JSON.stringify((await readSync(session.cookie)).state), before);
});

test('the staff-only writers of a member state (admin/trainer assignment and editing) refuse a member, with an sso session and with a passkey session', async () => {
  const uid = people.swrite.uid;
  writeState(DIR, uid, paidSeed());
  setCaps('swrite', 'baseline', { ttlMs: 1500 });
  const sso = await redeem('swrite'); assert.equal(sso.status, 200);
  const before = JSON.stringify(await stateOf(sso.cookie));
  const routes = ['/api/admin/user/profile', '/api/admin/user/features', '/api/admin/user/measurements', '/api/admin/user/routine-cycle', '/api/admin/user/routine-reviewed', '/api/admin/user/apply-starter-plan',
    '/api/trainer/assign-routine', '/api/trainer/assign-program', '/api/trainer/member-routine', '/api/trainer/member-routine-duplicate', '/api/trainer/member-routine-delete', '/api/trainer/member-program'];
  for (const cookie of [sso.cookie, cookieFor(uid)]) {
    for (const route of routes) {
      const r = await call(training, 'POST', route, { cookie, body: { userId: uid, memberId: uid, uid, routine: { id: 'x' }, program: guided('g-staff'), premium: { forged: true } } });
      assert.ok([401, 403].includes(r.status), `${route} -> ${r.status} ${JSON.stringify(r.json)}`);
    }
  }
  assert.equal(JSON.stringify(await stateOf(sso.cookie)), before, 'nothing was written');
});

/* ---- kiosk tokens follow the account: an administrative suspension reaches an already-open kiosk without waiting for the token to expire ---- */
const kioskCall = (token, method, route, body) => fetch(training.base + route, { method, headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, json: await r.json().catch(() => null) }));

test('kiosk tokens are re-checked on every use: suspension and link loss end the kiosk session at once, legacy users are untouched, and lifting restores access', async () => {
  const uid = people.swrite.uid, passkey = cookieFor(uid);
  writeState(DIR, uid, paidSeed());
  setCaps('swrite', 'baseline', { ttlMs: 1500 });
  await new Promise(resolve => setTimeout(resolve, 1900));
  await adminSetMode(uid, 'shadow'); assert.equal((await adminSetMode(uid, 'enforced')).status, 200);
  const pin = await call(training, 'GET', '/api/bunker/pin', { cookie: passkey }); assert.equal(pin.status, 200, JSON.stringify(pin.json));
  const checkin = await call(training, 'POST', '/api/bunker/checkin', { body: { pin: pin.json.pin } }); assert.equal(checkin.status, 200);
  const token = checkin.json.token;
  assert.equal((await kioskCall(token, 'GET', '/api/bunker/session')).status, 200, 'baseline keeps the kiosk');
  const active = { id: 'k-act-1', d: '2026-10-23', name: 'Kiosco', start: Date.now() - 60_000, entries: [] };
  assert.equal((await kioskCall(token, 'POST', '/api/bunker/active', { active, exName: 'x', setIdx: 0, setsTotal: 1 })).status, 200, 'baseline can log');

  // Platform now says ADMIN_SUSPENDED. The same token (valid for hours) stops working on every kiosk route as soon as the cached answer lapses.
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('swrite', 'suspended', { ttlMs: 1500 });
  for (const [method, route, body] of [['GET', '/api/bunker/session'], ['POST', '/api/bunker/active', { active, exName: 'x', setIdx: 0, setsTotal: 1 }], ['POST', '/api/bunker/rest', { sec: 30 }], ['POST', '/api/bunker/finish', { workout: { id: 'k-act-1', d: '2026-10-23', entries: [] } }]]) {
    const r = await kioskCall(token, method, route, body);
    assert.equal(r.status, 403, `${method} ${route}`); assert.equal(r.json.code, 'capability_required'); assert.equal(r.json.reasonCode, 'ADMIN_SUSPENDED');
  }
  assert.equal((await kioskCall(token, 'GET', '/api/bunker/board')).json?.sessions?.some?.(s => s.uid === uid) ?? false, false, 'the room presence ended');
  const { readState: readStoredState } = await import('../lib/state-store.js');
  assert.equal(readStoredState(uid)?.active?.id, 'k-act-1', 'the in-progress workout is kept, never discarded by the suspension');
  assert.equal((await call(training, 'POST', '/api/bunker/checkin', { body: { pin: pin.json.pin } })).status, 403, 'no new check-in while suspended');

  // Lifting the suspension restores access (same token, because nothing was destroyed).
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('swrite', 'baseline', { ttlMs: 1500 });
  assert.equal((await kioskCall(token, 'GET', '/api/bunker/session')).status, 200);
  assert.equal((await call(training, 'POST', '/api/bunker/checkin', { body: { pin: pin.json.pin } })).status, 200);
});

test('legacy members never call Platform from the kiosk and keep every route', async () => {
  const legacyPin = await call(training, 'GET', '/api/bunker/pin', { cookie: cookieFor(people.legacy.uid) }); assert.equal(legacyPin.status, 200, JSON.stringify(legacyPin.json));
  const before = platform.state.calls.length;
  const checkin = await call(training, 'POST', '/api/bunker/checkin', { body: { pin: legacyPin.json.pin } }); assert.equal(checkin.status, 200);
  for (const [method, route, body] of [['GET', '/api/bunker/session'], ['POST', '/api/bunker/rest', { sec: 20 }]]) assert.equal((await kioskCall(checkin.json.token, method, route, body)).status, 200, route);
  assert.equal(platform.state.calls.length, before, 'no Platform call for a legacy account');
});

/* ---- guided programs: keeping them and their history is free; continuing them is a paid function ---- */
test('finishing a workout of a guided program records it for everyone, but only advances/closes the program with the guided right; legacy is unchanged', async () => {
  const { readState: readStoredState } = await import('../lib/state-store.js');
  const program = () => ({ ...guided('gk'), status: 'active', weeks: [{ sessions: [{ day: 1 }] }] });
  const seed = uid => writeState(DIR, uid, { ...paidSeed(), programs: [program()], activeProgramId: 'gk', workouts: [{ id: 'old-1', d: '2026-09-01', entries: [], src2j: { program: { programId: 'gk', sessionId: 'earlier' } } }] });
  const workout = id => ({ id, d: '2026-10-23', entries: [], src2j: { program: { programId: 'gk', sessionId: '1:1:0' } } });
  const kioskToken = async uid => { const pin = await call(training, 'GET', '/api/bunker/pin', { cookie: cookieFor(uid) }); assert.equal(pin.status, 200); const c = await call(training, 'POST', '/api/bunker/checkin', { body: { pin: pin.json.pin } }); assert.equal(c.status, 200, JSON.stringify(c.json)); return c.json.token; };
  const uid = people.swrite.uid;

  // Enforced, no guided right (free baseline): the workout and history are kept, the program is frozen exactly as it was.
  setCaps('swrite', 'baseline', { ttlMs: 1500 }); await new Promise(resolve => setTimeout(resolve, 1900));
  await adminSetMode(uid, 'shadow'); assert.equal((await adminSetMode(uid, 'enforced')).status, 200);
  seed(uid);
  let token = await kioskToken(uid);
  const frozen = await kioskCall(token, 'POST', '/api/bunker/finish', { workout: workout('fin-free') });
  assert.equal(frozen.status, 200, JSON.stringify(frozen.json)); assert.equal(frozen.json.guidedProgress, 'frozen');
  let state = readStoredState(uid);
  assert.ok(state.workouts.some(w => w.id === 'fin-free') && state.workouts.some(w => w.id === 'old-1'), 'the new workout is recorded and the history is intact');
  assert.equal(state.programs.find(p => p.id === 'gk').status, 'active', 'the program is preserved, not advanced');
  assert.equal(state.activeProgramId, 'gk');

  // Same account with the guided right (the other fee): the program closes as before.
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('swrite', 'autonomous', { ttlMs: 1500 });
  seed(uid); token = await kioskToken(uid);
  const advanced = await kioskCall(token, 'POST', '/api/bunker/finish', { workout: workout('fin-paid') });
  assert.equal(advanced.status, 200, JSON.stringify(advanced.json)); assert.equal(advanced.json.guidedProgress, undefined);
  state = readStoredState(uid);
  assert.equal(state.programs.find(p => p.id === 'gk').status, 'completed'); assert.equal(state.activeProgramId, null);

  // Legacy member: untouched behaviour and no Platform call.
  const legacy = people.legacy.uid; seed(legacy);
  const before = platform.state.calls.length;
  const legacyFinish = await kioskCall(await kioskToken(legacy), 'POST', '/api/bunker/finish', { workout: workout('fin-legacy') });
  assert.equal(legacyFinish.status, 200); assert.equal(legacyFinish.json.guidedProgress, undefined);
  assert.equal(readStoredState(legacy).programs.find(p => p.id === 'gk').status, 'completed');
  assert.equal(platform.state.calls.length, before);
});

/* ---- H2: an administrative suspension closes interactive routes the same way for passkey and sso sessions, and keeps the safe paths open ---- */
test('a suspended enforced account is blocked on gated AND interactive member routes with both session types, while recovery, export, withdrawal and reading the gym news stay open; legacy is untouched', async () => {
  setCaps('swrite', 'baseline', { ttlMs: 1500 });
  const sso = await redeem('swrite'); assert.equal(sso.status, 200); await enforce('swrite');
  const passkey = cookieFor(people.swrite.uid);
  await new Promise(resolve => setTimeout(resolve, 1900)); setCaps('swrite', 'suspended', { ttlMs: 1500 });
  const closed = [['GET', '/api/data'], ['POST', '/api/sync'], ['POST', '/api/social/wall'], ['GET', '/api/social/wall'], ['POST', '/api/chat/messages'], ['GET', '/api/chat/threads'], ['POST', '/api/friends/request'], ['POST', '/api/media/upload'], ['POST', '/api/push/subscribe'], ['POST', '/api/social/reports']];
  const open = [['GET', '/api/news'], ['GET', '/api/notifications'], ['POST', '/api/notifications/read-all'], ['POST', '/api/social/wall/delete'], ['POST', '/api/social/wall/comment/delete'], ['POST', '/api/friends/block'], ['POST', '/api/push/unsubscribe'], ['POST', '/api/social/preferences'], ['GET', '/api/me'], ['GET', '/api/me/security-events'], ['POST', '/api/coach/forget']];
  for (const [label, cookie] of [['sso', sso.cookie], ['passkey', passkey]]) {
    for (const [method, route] of closed) {
      const r = await call(training, method, route, { cookie, body: method === 'POST' ? {} : undefined });
      assert.equal(r.status, 403, `${label} ${method} ${route} -> ${r.status} ${JSON.stringify(r.json)}`);
      assert.ok(['platform_access_blocked', 'capability_required'].includes(r.json.code), `${label} ${method} ${route}`);
    }
    for (const [method, route] of open) {
      if (label === 'sso' && route === '/api/coach/forget') continue;     // passkey-only (destructive), unrelated to the suspension
      const r = await call(training, method, route, { cookie, body: method === 'POST' ? {} : undefined });
      assert.ok(!['platform_access_blocked', 'capability_required', 'platform_link_inactive'].includes(r.json?.code), `${label} ${method} ${route} must not be closed by the suspension (${r.status} ${JSON.stringify(r.json)})`);
    }
  }
  // Passkey-only recovery/export/deletion routes are never closed by the capability contract.
  for (const [method, route] of [['GET', '/api/me/export'], ['GET', '/api/me/passkeys'], ['POST', '/api/me/delete/options'], ['POST', '/api/logout']]) {
    const r = await call(training, method, route, { cookie: passkey, body: method === 'POST' ? {} : undefined });
    assert.ok(!['platform_access_blocked', 'capability_required', 'platform_link_inactive'].includes(r.json?.code), `${method} ${route} ${r.status}`);
  }
  // A legacy member is not affected by anything above (no Platform call, no new closure).
  const legacy = cookieFor(people.legacy.uid), before = platform.state.calls.length;
  for (const [method, route] of closed) { const r = await call(training, method, route, { cookie: legacy, body: method === 'POST' ? {} : undefined }); assert.ok(!['platform_access_blocked', 'capability_required', 'platform_link_inactive'].includes(r.json?.code), `legacy ${method} ${route}`); }
  assert.equal(platform.state.calls.length, before);
});

/* ---- H4 / H5 / H6: unavailability degrades, refusal and inconsistency fail closed, outages do not make every request wait, cache lifetime follows OUR clock ---- */
test('H6: an unavailable Platform degrades safely, a refusing or contradicting Platform fails closed; neither is persisted as a restriction', async () => {
  const personId = randomUUID(), user = { id: 'u-h6', personId };
  const config = { baseUrl: 'http://127.0.0.1:9', keyId: 'k', secret: Buffer.alloc(32, 3) };
  const t0 = 1_800_000_000_000;
  const run = async (answer, { clock = t0 } = {}) => {
    const alerts = [], persisted = [];
    const service = createCapabilitiesService({ config, now: () => clock, fetchImpl: async () => answer(), onRestriction: (u, r) => persisted.push(r), onAlert: (kind, detail) => alerts.push([kind, detail]) });
    return { view: await service.evaluate(user, { mode: 'enforced' }), alerts, persisted, service };
  };
  const ok = (over = {}) => ({ ok: true, status: 200, json: async () => ({ ...v2({ personId, trainingUserId: user.id, kind: 'full', now: t0 }), ...over }) });
  const http_ = status => ({ ok: false, status, json: async () => ({}) });

  // Unavailable: baseline, never paid rights, and an alert that Platform is unreachable.
  for (const answer of [() => { throw new Error('network'); }, () => http_(503), () => http_(500), () => http_(429), () => http_(408)]) {
    const { view, alerts, persisted } = await run(answer);
    assert.equal(view.source, 'degraded'); assert.equal(view.level, 'baseline'); assert.equal(view.capabilities.aiCoach, false); assert.equal(view.capabilities.workoutRecording, true);
    assert.equal(alerts[0][0], 'platform_unreachable'); assert.deepEqual(persisted, []);
  }
  // Clock we cannot trust: unavailability (baseline), not a verdict about the person.
  const skewed = await run(() => ok({ generatedAt: new Date(t0 + 10 * 60_000).toISOString(), expiresAt: new Date(t0 + 10 * 60_000 + 30_000).toISOString() }));
  assert.equal(skewed.view.source, 'degraded');

  // Refused (401/403/404/400) or contradicting (bad contract, another person, another Training user, absurd window): blocked, alert, nothing persisted.
  const refusals = [
    ['http 401', () => http_(401), 'platform_rejected', 'PLATFORM_REJECTED'], ['http 403', () => http_(403), 'platform_rejected', 'PLATFORM_REJECTED'],
    ['http 404', () => http_(404), 'platform_rejected', 'PLATFORM_REJECTED'], ['http 400', () => http_(400), 'platform_rejected', 'PLATFORM_REJECTED'],
    ['invalid contract', () => ok({ contract: 'something-else' }), 'platform_inconsistent', 'IDENTITY_INCONSISTENT'],
    ['another person', () => ok({ personId: randomUUID() }), 'platform_inconsistent', 'IDENTITY_INCONSISTENT'],
    ['another training user', () => ok({ trainingSubject: { linkStatus: 'active', trainingUserId: 'someone-else' } }), 'platform_inconsistent', 'IDENTITY_INCONSISTENT'],
    ['window longer than 60 s', () => ok({ expiresAt: new Date(t0 + 300_000).toISOString() }), 'platform_inconsistent', 'IDENTITY_INCONSISTENT'],
    ['not json', () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }), 'platform_inconsistent', 'IDENTITY_INCONSISTENT'],
  ];
  for (const [label, answer, alertKind, reasonCode] of refusals) {
    const { view, alerts, persisted, service } = await run(answer);
    assert.equal(view.source, 'rejected', label); assert.equal(view.level, 'blocked', label); assert.equal(view.reasonCode, reasonCode, label);
    assert.equal(service.allows(view, ['workoutHistory']), false, `${label}: nothing is allowed`);
    assert.equal(alerts[0][0], alertKind, label); assert.deepEqual(persisted, [], `${label}: a refusal is not stored as a restriction`);
  }
  // The refusal is remembered for a few seconds only (no hammering), then Platform is asked again and a healthy answer restores access.
  let clock = t0, answer = () => http_(403), calls = 0;
  const service = createCapabilitiesService({ config, now: () => clock, fetchImpl: async () => { calls++; return answer(); } });
  assert.equal((await service.evaluate(user, { mode: 'enforced' })).level, 'blocked'); await service.evaluate(user, { mode: 'enforced' }); assert.equal(calls, 1, 'short negative cache');
  clock += 6_000; answer = () => ok({ generatedAt: new Date(clock).toISOString(), expiresAt: new Date(clock + 30_000).toISOString() });
  const healed = await service.evaluate(user, { mode: 'enforced' }); assert.equal(calls, 2); assert.equal(healed.level, 'full');
  // Alerts are rate limited: a flood of failures raises one alert per kind per 5 minutes.
  const flood = [], noisy = createCapabilitiesService({ config, now: () => clock, fetchImpl: async () => http_(401), onAlert: kind => flood.push(kind) });
  for (let i = 0; i < 5; i++) { clock += 6_000; await noisy.evaluate({ id: `u-${i}`, personId: randomUUID() }, { mode: 'enforced' }); }
  assert.equal(flood.length, 1);
  // Not configured is loud too, and never grants paid rights.
  const unconfigured = []; const none = createCapabilitiesService({ config: null, now: () => t0, onAlert: kind => unconfigured.push(kind) });
  assert.equal((await none.evaluate({ ...user, platformRestriction: undefined }, { mode: 'enforced' })).level, 'baseline'); assert.deepEqual(unconfigured, ['platform_not_configured']);
});

test('H5: during an outage only one request pays the timeout; the circuit breaker answers the rest at once and probes again after the backoff', async () => {
  const config = { baseUrl: 'http://127.0.0.1:9', keyId: 'k', secret: Buffer.alloc(32, 3) };
  let clock = 1_800_000_000_000, calls = 0, down = true;
  const people_ = Array.from({ length: 6 }, (_, i) => ({ id: `u-b${i}`, personId: randomUUID() }));
  const service = createCapabilitiesService({ config, now: () => clock, breakerBaseMs: 5_000, fetchImpl: async url => {
    calls++;
    if (down) throw new Error('timeout');
    const personId = String(url).match(/persons\/([0-9a-f-]{36})\//)[1], who = people_.find(p => p.personId === personId);
    return { ok: true, status: 200, json: async () => v2({ personId, trainingUserId: who.id, kind: 'baseline', now: clock }) };
  } });
  for (const who of people_) assert.equal((await service.evaluate(who, { mode: 'enforced' })).source, 'degraded');
  assert.equal(calls, 1, 'five of the six requests never touched the network');
  assert.equal(service.status().breakerOpen, true); assert.ok(service.status().consecutiveFailures >= 1);
  clock += 5_001; await service.evaluate(people_[0], { mode: 'enforced' }); assert.equal(calls, 2, 'one probe after the backoff');
  clock += 10_001; down = false; assert.equal((await service.evaluate(people_[1], { mode: 'enforced' })).source, 'fresh', 'recovery closes the breaker');
  assert.equal(service.status().breakerOpen, false); assert.equal(service.status().unreachableSinceMs, 0);
});

test('H4: the cache lifetime is bounded by OUR clock, not by the clock inside the answer', async () => {
  const config = { baseUrl: 'http://127.0.0.1:9', keyId: 'k', secret: Buffer.alloc(32, 3) };
  const personId = randomUUID(), user = { id: 'u-h4', personId }, now0 = 1_800_000_000_000;
  let clock = now0, calls = 0;
  // Platform's clock runs 50 s AHEAD: its answer says it is valid for 60 s from its own "now" (110 s from ours).
  const service = createCapabilitiesService({ config, now: () => clock, fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => v2({ personId, trainingUserId: user.id, kind: 'full', ttlMs: 60_000, now: clock + 50_000 }) }; } });
  assert.equal((await service.evaluate(user, { mode: 'enforced' })).source, 'fresh');
  clock += 59_000; assert.equal((await service.evaluate(user, { mode: 'enforced' })).source, 'cache'); assert.equal(calls, 1);
  clock += 2_000; assert.equal((await service.evaluate(user, { mode: 'enforced' })).source, 'fresh'); assert.equal(calls, 2, 'asked again after 60 s of OUR time, never later');
  // Platform's clock runs 20 s BEHIND: the answer expires earlier than 60 s of our time, and we honour the earlier bound.
  calls = 0; clock = now0 + 500_000;
  const behind = createCapabilitiesService({ config, now: () => clock, fetchImpl: async () => { calls++; return { ok: true, status: 200, json: async () => v2({ personId, trainingUserId: user.id, kind: 'full', ttlMs: 60_000, now: clock - 20_000 }) }; } });
  await behind.evaluate(user, { mode: 'enforced' }); clock += 41_000; await behind.evaluate(user, { mode: 'enforced' }); assert.equal(calls, 2);
});

test('H6/H10 over HTTP: a Platform that refuses an enforced user blocks them, never a legacy user; a gate failure never takes access from a legacy user', async () => {
  // Enforced user refused by Platform -> blocked on gated and interactive routes, free data untouched.
  setCaps('sfree', 'baseline', { ttlMs: 1500 });
  await new Promise(resolve => setTimeout(resolve, 1900));
  assert.equal((await adminSetMode(people.sfree.uid, 'shadow')).status, 200); assert.equal((await adminSetMode(people.sfree.uid, 'enforced')).status, 200);
  const cookie = cookieFor(people.sfree.uid);
  assert.equal((await call(training, 'GET', '/api/data', { cookie })).status, 200);
  await new Promise(resolve => setTimeout(resolve, 1900)); platform.state.forced.set(people.sfree.personId, { status: 403, body: { error: 'service_auth_rejected' } });
  const refused = await call(training, 'GET', '/api/data', { cookie });
  assert.equal(refused.status, 403); assert.equal(refused.json.reasonCode, 'PLATFORM_REJECTED');
  assert.equal((await call(training, 'POST', '/api/social/wall', { cookie, body: {} })).status, 403);
  assert.equal((await call(training, 'GET', '/api/me', { cookie })).status, 200, 'the account and its recovery paths stay reachable');
  assert.equal(dbUser(people.sfree.uid).platformRestriction, undefined, 'a refusal is not stored as a persistent restriction');
  // The same refusal does not touch a legacy user, who is never evaluated.
  platform.state.forced.set(people.legacy.personId ?? 'none', { status: 403, body: {} });
  assert.notEqual((await call(training, 'GET', '/api/data', { cookie: cookieFor(people.legacy.uid) })).status, 403);
  // Once Platform answers normally again the enforced user recovers by itself.
  platform.state.forced.delete(people.sfree.personId); await new Promise(resolve => setTimeout(resolve, 5_200));
  assert.equal((await call(training, 'GET', '/api/data', { cookie })).status, 200);
});

test('H10: a failure of the integration itself keeps legacy and anonymous callers working and fails closed only for users who opted in', async () => {
  const { gateFailureMayProceed } = await import('../platform-sso/index.js');
  assert.equal(gateFailureMayProceed(null), true, 'anonymous / public routes');
  assert.equal(gateFailureMayProceed({ id: 'x' }), true, 'no mode = legacy');
  assert.equal(gateFailureMayProceed({ id: 'x', platformEnforcement: 'legacy' }), true);
  assert.equal(gateFailureMayProceed({ id: 'x', platformEnforcement: 'bogus' }), true);
  assert.equal(gateFailureMayProceed({ id: 'x', platformEnforcement: 'shadow' }), false);
  assert.equal(gateFailureMayProceed({ id: 'x', platformEnforcement: 'enforced' }), false);
  // And the dispatcher really uses it: no other 503 path remains for the gate.
  const source = fs.readFileSync(path.join(API_ROOT, 'server.js'), 'utf8');
  assert.match(source, /gateFailureMayProceed\(who\)/); assert.equal((source.match(/platform_gate_unavailable/g) || []).length, 1);
});

/* ---- H3: a Platform code never silently replaces the session of ANOTHER account (login CSRF) ---- */
async function redeemWithCookie(who, cookie) {
  const code = randomBytes(32).toString('base64url');
  platform.state.codes.set(code, { personId: people[who].personId, trainingUserId: people[who].uid });
  const response = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, origin: training.base, cookie });
  return { ...response, code, setCookie: sessionCookies(response.headers)[0] || '' };
}
const confirmSwitch = (ticket, cookie, origin = training.base) => call(training, 'POST', '/api/platform/v1/sso/confirm', { body: { ticket }, origin, cookie });

test('H3: redeeming while ANOTHER account is signed in asks for confirmation instead of replacing the session; only that browser session can confirm, once', async () => {
  setCaps('a', 'baseline', { ttlMs: 1500 }); setCaps('b', 'baseline', { ttlMs: 1500 });
  const victim = cookieFor(people.a.uid);
  assert.equal((await call(training, 'GET', '/api/me', { cookie: victim })).json.user?.id ?? (await call(training, 'GET', '/api/me', { cookie: victim })).json.id, people.a.uid);

  // The attacker (account b) got a valid code and sent the victim (signed in as a) to /sso#code=...
  const attempt = await redeemWithCookie('b', victim);
  assert.equal(attempt.status, 409, JSON.stringify(attempt.json)); assert.equal(attempt.json.error, 'session_switch_confirmation_required');
  assert.equal(attempt.setCookie, '', 'no cookie is issued: the victim\'s session was not replaced');
  assert.equal(attempt.json.current.name, 'Member a'); assert.equal(attempt.json.target.name, 'Member b');
  assert.match(attempt.json.ticket, /^[0-9a-f]{64}$/);
  assert.equal((await call(training, 'GET', '/api/me', { cookie: victim })).status, 200, 'the victim is still signed in as themselves');
  assert.ok(!JSON.stringify(attempt.json).includes(attempt.code), 'the one-time code is not echoed');

  // Nobody else can use the ticket: another browser, no session, wrong origin, malformed.
  const other = await confirmSwitch(attempt.json.ticket, cookieFor(people.c.uid)); assert.equal(other.status, 400);
  const second = await redeemWithCookie('b', victim); assert.equal(second.status, 409);       // the first ticket was burned by the failed attempt; ask for another
  assert.equal((await confirmSwitch(second.json.ticket, undefined)).status, 400, 'no session');
  assert.equal((await confirmSwitch(second.json.ticket, victim, 'https://evil.example')).status, 403, 'foreign origin');
  assert.equal((await call(training, 'POST', '/api/platform/v1/sso/confirm', { body: { ticket: 'x' }, origin: training.base, cookie: victim })).status, 400);
  const third = await redeemWithCookie('b', victim);

  // The person confirms explicitly: now (and only now) the session becomes b's, once.
  const done = await confirmSwitch(third.json.ticket, victim);
  assert.equal(done.status, 200, JSON.stringify(done.json)); assert.equal(done.json.user.id, people.b.uid); assert.equal(done.json.user.authLevel, 'sso');
  assert.match(done.headers.get('set-cookie') || '', /gymsid=/);
  assert.equal((await confirmSwitch(third.json.ticket, victim)).status, 400, 'a ticket is single use');
  const events = JSON.stringify(dbUser(people.a.uid) && JSON.parse(fs.readFileSync(dbFile, 'utf8')).securityEvents || []);
  assert.match(events, /platform_sso_switch_requested/); assert.match(events, /platform_sso_switch_confirmed/);
});

test('H3: the confirmation re-checks the target account, and the normal flows are unchanged (no session, same account, older sso session)', async () => {
  setCaps('d', 'baseline', { ttlMs: 1500 }); setCaps('e', 'baseline', { ttlMs: 1500 });
  // No session: direct sign-in, as before.
  const fresh = await redeemWithCookie('d', undefined); assert.equal(fresh.status, 200); assert.match(fresh.setCookie, /gymsid=/);
  // Same account with its passkey session: kept, no replacement and no prompt.
  const kept = await redeemWithCookie('d', cookieFor(people.d.uid)); assert.equal(kept.status, 200); assert.equal(kept.json.sessionKept, true); assert.equal(kept.setCookie, '');
  // An older sso session of the SAME account is replaced (that is just a refresh)...
  const refreshed = await redeemWithCookie('d', fresh.setCookie.split(';')[0]); assert.equal(refreshed.status, 200); assert.match(refreshed.setCookie, /gymsid=/);
  // ... but an sso session of ANOTHER account also needs the confirmation.
  const crossed = await redeemWithCookie('e', refreshed.setCookie.split(';')[0]); assert.equal(crossed.status, 409);
  // Between the prompt and the confirmation the target link is revoked by Platform: the confirmation fails closed.
  const ticket = crossed.json.ticket, session = refreshed.setCookie.split(';')[0];
  const revoke = await platformCall(training, REVOKE, { v: 1, linkId: dbUser(people.e.uid).platformLink.linkId, linkVersion: 9, personId: people.e.personId, trainingUserId: people.e.uid });
  assert.equal(revoke.status, 200, JSON.stringify(revoke.json));
  const late = await confirmSwitch(ticket, session); assert.equal(late.status, 409); assert.equal(late.json.error, 'link_not_confirmed');
  // Restore the acknowledged link for later tests.
  const again = await platformCall(training, ACTIVATE, activateBody('e', { linkId: randomUUID(), linkVersion: 12 }));
  assert.ok([200, 409].includes(again.status));
});

/* ------------------------------------------------------------------ browser-bound SSO (PKCE S256): login CSRF and forwarded links */
// Each of these tests is its own client IP (a private peer's first X-Forwarded-For hop, the legacy rule), so the SSO failures other tests leave behind never rate-limit them.
const clientIp = n => ({ 'x-forwarded-for': `198.51.100.${n}` });
test('binding: /sso/start puts a random verifier in an HttpOnly cookie of this origin and sends the browser to Home with only the challenge', async () => {
  const first = await startBrowser(training, clientIp(10)), second = await startBrowser(training, clientIp(10));
  assert.equal(first.status, 302);
  assert.match(first.location, /^http:\/\/127\.0\.0\.1:5173\/#sso_challenge=[A-Za-z0-9_-]{43}$/, 'Home gets nothing but the fragment challenge');
  assert.match(first.cookie, /^j2ssob=[A-Za-z0-9_-]{43}$/);
  const attributes = first.setCookie.find(item => item.startsWith('j2ssob=')).split(';').map(item => item.trim().toLowerCase());
  for (const required of ['httponly', 'samesite=lax', 'path=/api/platform/v1/sso', 'max-age=600']) assert.ok(attributes.includes(required), `cookie attribute ${required}: ${attributes}`);
  assert.ok(!attributes.includes('secure'), 'plain-http loopback: Secure is added only when the public origin is https');
  assert.equal(first.challenge, challengeOf(first.verifier), 'the challenge Home receives is the S256 of the verifier that stays in the cookie');
  assert.ok(!first.location.includes(first.verifier), 'the verifier never travels in the URL');
  assert.notEqual(first.verifier, second.verifier, 'every start is a fresh secret');
  assert.equal(first.response.headers.get('cache-control'), 'no-store'); assert.equal(first.response.headers.get('referrer-policy'), 'no-referrer');
});

test('binding: /sso/start sets no cookie and explains itself when SSO is off or Home is not configured', async () => {
  const off = await startBrowser(plain);
  assert.equal(off.status, 302); assert.equal(off.location, '/sso#error=disabled'); assert.deepEqual(off.setCookie, []);
  const noHome = await startTraining({ PLATFORM_SSO_ENABLED: 'true', PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: platform.state.keyId, PLATFORM_API_KEY_SECRET: platformSecret });
  try {
    const unavailable = await startBrowser(noHome);
    assert.equal(unavailable.status, 302); assert.equal(unavailable.location, '/sso#error=unavailable'); assert.deepEqual(unavailable.setCookie, []);
  } finally { noHome.stop(); }
});

test('binding: a redemption from a browser that never started the flow is refused and Platform is not even asked (a forwarded link cannot burn or use the code)', async () => {
  setCaps('a', 'baseline');
  const code = randomBytes(32).toString('base64url');
  platform.state.codes.set(code, { personId: people.a.personId, trainingUserId: people.a.uid, challenge: challengeOf(randomBytes(32).toString('base64url')) });
  const before = platform.state.calls.filter(item => item.method === 'POST').length;
  const refused = await call(training, 'POST', '/api/platform/v1/sso/redeem', { body: { v: 1, code }, origin: training.base, binding: 'none', headers: clientIp(11) });
  assert.equal(refused.status, 400); assert.equal(refused.json.error, 'sso_binding_missing');
  assert.equal(refused.headers.get('set-cookie')?.includes('gymsid='), false, 'no session was opened');
  assert.equal(platform.state.calls.filter(item => item.method === 'POST').length, before, 'Platform was not contacted');
  assert.equal(platform.state.codes.get(code).used, undefined, 'the code is untouched');
  for (const malformed of ['j2ssob=short', `j2ssob=${'!'.repeat(43)}`, `j2ssob=${'A'.repeat(44)}`, 'j2ssob=']) {
    const response = await fetch(training.base + '/api/platform/v1/sso/redeem', { method: 'POST', headers: { 'content-type': 'application/json', origin: training.base, cookie: malformed, ...clientIp(11) }, body: JSON.stringify({ v: 1, code }) });
    assert.equal(response.status, 400, malformed); assert.equal((await response.json()).error, 'sso_binding_missing');
  }
  assert.equal(platform.state.calls.filter(item => item.method === 'POST').length, before);
});

test('binding: login CSRF — a victim\'s browser cannot be signed in to the attacker\'s account with the attacker\'s code, with or without a prior session', async () => {
  setCaps('a', 'baseline'); setCaps('b', 'baseline');
  const attackerBrowser = await startBrowser(training, clientIp(12));                       // the attacker starts the flow in their OWN browser and keeps the code Home returns
  const code = randomBytes(32).toString('base64url');
  platform.state.codes.set(code, { personId: people.a.personId, trainingUserId: people.a.uid, challenge: attackerBrowser.challenge });
  const send = async cookie => { const response = await fetch(training.base + '/api/platform/v1/sso/redeem', { method: 'POST', headers: { 'content-type': 'application/json', origin: training.base, ...clientIp(12), ...(cookie ? { cookie } : {}) }, body: JSON.stringify({ v: 1, code }) }); return { status: response.status, json: await response.json().catch(() => null), setCookie: response.headers.getSetCookie?.() ?? [] }; };
  // The attacker sends the victim to /sso#code=<code>. The victim has no session and no binding cookie.
  const cold = await send(null);
  assert.equal(cold.status, 400); assert.equal(cold.json.error, 'sso_binding_missing'); assert.ok(!cold.setCookie.some(item => item.startsWith('gymsid=')));
  // The victim did start their own flow earlier (so they hold a valid-looking cookie), but for THEIR OWN challenge.
  const victimBrowser = await startBrowser(training, clientIp(12));
  const warm = await send(victimBrowser.cookie);
  assert.equal(warm.status, 400); assert.equal(warm.json.error, 'sso_binding_mismatch'); assert.ok(!warm.setCookie.some(item => item.startsWith('gymsid=')), 'no session for the victim');
  // …even with a session of their own, nothing changes for them and no switch is offered (the ticket exists only after a valid redemption).
  const withSession = await send(`${cookieFor(people.b.uid)}; ${victimBrowser.cookie}`);
  assert.equal(withSession.status, 400); assert.equal(withSession.json.error, 'sso_binding_mismatch'); assert.equal(withSession.json.ticket, undefined);
  assert.equal(platform.state.codes.get(code).used, undefined, 'Platform did not consume the code for the wrong browser');
  // The attacker\'s own browser still works: the binding protects the victim, it does not break the legitimate flow.
  const own = await send(attackerBrowser.cookie);
  assert.equal(own.status, 200); assert.ok(own.setCookie.some(item => item.startsWith('gymsid=')));
  assert.equal(platform.state.lastRedeem.v, 2); assert.equal(platform.state.lastRedeem.verifier, attackerBrowser.verifier);
});

test('binding: the cookie is cleared once a code has been used for it, whatever the outcome, but survives a Platform outage so the person can retry', async () => {
  setCaps('a', 'baseline');
  const cleared = headers => (headers.getSetCookie?.() ?? []).some(item => /^j2ssob=;/.test(item) && /Max-Age=0/i.test(item) && /Path=\/api\/platform\/v1\/sso/.test(item));
  const ok = await redeem('a', { headers: clientIp(13) });
  assert.equal(ok.status, 200); assert.ok(cleared(ok.headers), 'success clears the binding cookie next to the new session');
  assert.ok((ok.headers.getSetCookie?.() ?? []).some(item => item.startsWith('gymsid=')));
  const spent = await redeem('a', { entry: { status: 410 }, headers: clientIp(13) });
  assert.equal(spent.status, 400); assert.ok(cleared(spent.headers), 'a dead code clears it too');
  platform.state.down = true;
  try {
    const down = await redeem('a', { headers: clientIp(13) });
    assert.equal(down.status, 503); assert.equal(cleared(down.headers), false, 'an outage keeps the cookie: the same page can try again');
  } finally { platform.state.down = false; }
});

test('binding: a valid redemption while ANOTHER account is signed in still needs the confirmation, and the binding cookie is spent', async () => {
  setCaps('a', 'baseline'); setCaps('b', 'baseline');
  const code = randomBytes(32).toString('base64url');
  platform.state.codes.set(code, { personId: people.b.personId, trainingUserId: people.b.uid });
  const response = await call(training, 'POST', '/api/platform/v1/sso/redeem', { cookie: cookieFor(people.a.uid), body: { v: 1, code }, origin: training.base, headers: clientIp(14) });
  assert.equal(response.status, 409); assert.equal(response.json.error, 'session_switch_confirmation_required');
  assert.ok((response.headers.getSetCookie?.() ?? []).some(item => /^j2ssob=;/.test(item)), 'the code is consumed, so the binding is too');
  assert.ok(!(response.headers.getSetCookie?.() ?? []).some(item => item.startsWith('gymsid=')), 'the session was not replaced');
});

test('binding: PLATFORM_HOME_URL is an origin only — https, or http on loopback — and nothing else', () => {
  const parse = value => parsePlatformIntegrationEnv({ PLATFORM_HOME_URL: value }).homeUrl;
  assert.equal(parse('https://home.2jfitnesscenter.com'), 'https://home.2jfitnesscenter.com');
  assert.equal(parse('https://home.2jfitnesscenter.com/'), 'https://home.2jfitnesscenter.com');
  assert.equal(parse('http://127.0.0.1:5173'), 'http://127.0.0.1:5173');
  assert.equal(parse('http://localhost:5173/'), 'http://localhost:5173');
  for (const bad of ['', undefined, 'http://home.example', 'https://u:p@home.example', 'https://home.example/path', 'https://home.example/?q=1', 'https://home.example/#x', 'javascript:alert(1)', 'not a url', '//home.example']) assert.equal(parse(bad), null, String(bad));
});
