// F9d-2 · Re-authentication done with a passkey IN PLATFORM, trusted for the member's OWN export / erasure only (2JHub H-83, contract §9),
// against the REAL Training server and a fake Platform. With PLATFORM_HUB_STEPUP_ENABLED off, everything answers exactly like F9d.
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
const HOME = 'http://127.0.0.1:5176';
const SECRET = 'e'.repeat(64);
const outbound = { keyId: 'bunker-out-s', secret: Buffer.alloc(32, 0x43) };
const inbound = { keyId: 'platform-out-s', secret: Buffer.alloc(32, 0x64) };

/* ------------------------------------------------------------------ fake Platform: SSO redeem, step-up redeem, capabilities */
const sso = new Map(), stepups = new Map();
let stepupAnswer = null;   // override of the next step-up answer (contract violations)
let stepupRedeems = 0;
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
        const entry = [...sso.values()].find(c => c.personId === cap[1]);
        const now = Date.now();
        return reply(200, { contract: '2J-CAPABILITIES-V2', version: 2, personId: cap[1], trainingSubject: { linkStatus: 'active', trainingUserId: entry?.trainingUserId }, capabilityLevel: 'baseline', accessState: 'baseline', reasonCode: 'FREE_BASELINE', capabilities: baselineCapabilities(), suspensionStatus: 'none', effectiveFrom: null, expiresAt: new Date(now + 60_000).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true } });
      }
      const r = body.length ? JSON.parse(body.toString('utf8')) : {};
      if (req.url === '/api/internal/platform/v2/training-sso/redeem') {
        const entry = sso.get(r.code);
        if (!entry || entry.used) return reply(403, { error: 'SSO_REJECTED' });
        entry.used = true;
        return reply(200, { v: 1, issuer: '2j-platform', audience: '2j-training', personId: entry.personId, trainingUserId: entry.trainingUserId, linkStatus: 'active', displayName: 'Ana', assurance: 'platform_sso', correlationId: r.correlationId });
      }
      if (req.url === '/api/internal/platform/v2/training-stepup/redeem') {
        stepupRedeems++;
        const entry = stepups.get(r.code);
        if (r.audience !== '2j-training-stepup' || !entry || entry.used) return reply(403, { error: 'STEPUP_REJECTED' });
        entry.used = true;
        const answer = { v: 1, issuer: '2j-platform', audience: '2j-training-stepup', personId: entry.personId, trainingUserId: entry.trainingUserId, purpose: entry.purpose, assurance: 'platform_passkey', verifiedAt: new Date().toISOString(), correlationId: r.correlationId };
        const override = stepupAnswer; stepupAnswer = null;
        return reply(200, override ? { ...answer, ...override } : answer);
      }
      reply(404, { error: 'not_found' });
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

/* ------------------------------------------------------------------ Training under test */
const P = { a: randomUUID(), b: randomUUID(), staff: randomUUID(), env: randomUUID() };
const linked = (id, personId, extra = {}) => ({ id, name: `Member ${id}`, username: id.replace(/[^a-z]/g, ''), created: '2026-05-01T08:00:00.000Z', personId, platformLink: { personId, state: 'active', origin: 'hub_provisioned' }, ...extra });
function seed(dir) {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    // u-a and u-b were created by the automatic sign-up: NO Búnker passkey at all.
    users: [linked('u-a', P.a), linked('u-b', P.b), linked('u-staff', P.staff, { trainer: true }), linked('u-env', P.env), { id: 'u-free', name: 'Free', username: 'free' }],
    creds: [], subs: [], invites: [], recoveries: [],
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
  PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_HOME_URL: HOME, PLATFORM_HUB_SETTINGS_ENABLED: 'true',
  PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
  PLATFORM_HUB_INBOUND_KEYS: JSON.stringify({ [inbound.keyId]: inbound.secret.toString('base64url') }),
  PLATFORM_LOGIN_RETIRED: 'true', PLATFORM_HUB_CREDENTIALS_ENABLED: 'true',
};
const on = await startTraining({ ...BRIDGE, PLATFORM_HUB_STEPUP_ENABLED: 'true' });
const off = await startTraining(BRIDGE);
const stopped = [];
after(async () => { await on.stop(); await off.stop(); for (const s of stopped) await s.stop(); platform.server.close(); });
const readDb = t => JSON.parse(fs.readFileSync(path.join(t.dir, 'db.json'), 'utf8'));
const rnd = () => crypto.randomBytes(32).toString('base64url');

function ssoCode(personId, trainingUserId) { const code = rnd(); sso.set(code, { personId, trainingUserId }); return code; }
function stepupCode(personId, trainingUserId, purpose) { const code = rnd(); stepups.set(code, { personId, trainingUserId, purpose }); return code; }
/** What Home's single form carries: SSO code + step-up code (optionally without the SSO pair). */
function form(personId, uid, purpose, { withSso = true, stepupFor = null } = {}) {
  const f = { stepupCode: stepupCode(...(stepupFor || [personId, uid]), purpose), stepupCorrelationId: randomUUID() };
  if (withSso) Object.assign(f, { code: ssoCode(personId, uid), correlationId: randomUUID() });
  return f;
}
async function post(t, fields, { origin = HOME, cookie = null, type = 'application/x-www-form-urlencoded', raw = null } = {}) {
  const headers = { 'content-type': type, ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) };
  const r = await fetch(t.base + '/api/platform/v1/stepup/receive', { method: 'POST', redirect: 'manual', headers, body: raw ?? new URLSearchParams(fields).toString() });
  const setCookie = r.headers.get('set-cookie');
  return { status: r.status, location: r.headers.get('location'), cookie: setCookie ? setCookie.split(';', 1)[0] : null, cache: r.headers.get('cache-control') };
}
const as = (t, cookie, m, p, body) => fetch(t.base + p, { method: m, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function ssoSession(t, personId, uid) {
  const r = await fetch(t.base + '/api/platform/v1/sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code: ssoCode(personId, uid), correlationId: randomUUID() }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: HOME } });
  return (r.headers.get('set-cookie') || '').split(';', 1)[0];
}
const refused = (t, reason) => readDb(t).securityEvents.some(e => e.event === 'platform_hub_stepup_refused' && e.meta?.reason === reason);

/* ------------------------------------------------------------------ the happy paths */
test('export: one form → SSO session of that account + one-use grant → /settings#data; the download works ONCE', async () => {
  const r = await post(on, form(P.a, 'u-a', 'export'));
  assert.equal(r.status, 303); assert.equal(r.location, '/settings#data'); assert.equal(r.cache, 'no-store');
  assert.match(r.cookie || '', /^gymsid=/);
  const level = await (await as(on, r.cookie, 'GET', '/api/platform/v1/me/training-level')).json();
  assert.equal(level.stepUp.purpose, 'export');
  assert.ok(Date.parse(level.stepUp.expiresAt) - Date.now() <= 5 * 60_000);
  const first = await as(on, r.cookie, 'GET', '/api/me/export');
  assert.equal(first.status, 200, await first.clone().text());
  const second = await as(on, r.cookie, 'GET', '/api/me/export');
  assert.equal(second.status, 403); assert.equal((await second.json()).code, 'passkey_required');
  const ev = readDb(on).securityEvents;
  assert.ok(ev.some(e => e.event === 'platform_hub_stepup_granted' && e.userId === 'u-a' && e.meta.purpose === 'export'));
  assert.ok(ev.some(e => e.event === 'platform_hub_stepup_used' && e.userId === 'u-a'));
  // The grant opens nothing but its own purpose: erasure with an `export` grant → refused.
  const again = await post(on, form(P.a, 'u-a', 'export'), { cookie: r.cookie });
  const d = await as(on, again.cookie || r.cookie, 'POST', '/api/me/delete', { confirm: 'ua', platformStepUp: true });
  assert.equal(d.status, 403);
});

test('a provisioned profile (no Búnker passkey) erases its account with a Platform passkey; the end-of-link notice is queued', async () => {
  const t = await startTraining({ ...BRIDGE, PLATFORM_HUB_STEPUP_ENABLED: 'true' });
  stopped.push(t);
  const r = await post(t, form(P.b, 'u-b', 'delete'));
  assert.equal(r.location, '/settings#data');
  // The typed username still applies; a wrong one does not spend the grant.
  const wrong = await as(t, r.cookie, 'POST', '/api/me/delete', { confirm: 'nope', platformStepUp: true });
  assert.equal(wrong.status, 400);
  const ok = await as(t, r.cookie, 'POST', '/api/me/delete', { confirm: 'ub', platformStepUp: true });
  assert.equal(ok.status, 200, await ok.clone().text());
  assert.match(ok.headers.get('set-cookie') || '', /Max-Age=0/);
  const db = readDb(t);
  assert.equal(db.users.some(u => u.id === 'u-b'), false, 'erased');
  const outbox = JSON.parse(fs.readFileSync(path.join(t.dir, 'platform-hub-outbox.json'), 'utf8'));
  assert.ok(JSON.stringify(outbox).includes(P.b), 'Platform will be told the link ended (F9c)');
});

/* ------------------------------------------------------------------ what it refuses */
test('form: wrong Origin, null/absent Origin, wrong content type, extra or missing fields → refused, no grant', async () => {
  const f = form(P.a, 'u-a', 'export');
  for (const origin of ['https://evil.test', 'null', null]) {
    const r = await post(on, f, { origin });
    assert.equal(r.location, '/sso#error=denied'); assert.equal(r.cookie, null);
  }
  assert.ok(refused(on, 'origin_rejected'));
  assert.equal((await post(on, f, { type: 'application/json' })).location, '/sso#error=denied');
  assert.equal((await post(on, { ...form(P.a, 'u-a', 'export'), next: 'account' })).location, '/sso#error=denied');
  assert.equal((await post(on, { stepupCode: rnd() })).location, '/sso#error=denied');
  assert.ok(refused(on, 'bad_form'));
});

test('step-up only: no session → refused; a session of ANOTHER account → refused; the same account → granted', async () => {
  const none = await post(on, form(P.a, 'u-a', 'export', { withSso: false }));
  assert.equal(none.location, '/sso#error=denied'); assert.ok(refused(on, 'no_session'));
  const other = await ssoSession(on, P.b, 'u-b');
  const wrong = await post(on, form(P.a, 'u-a', 'export', { withSso: false }), { cookie: other });
  assert.equal(wrong.location, '/sso#error=denied'); assert.ok(refused(on, 'other_account'));
  assert.equal((await as(on, other, 'GET', '/api/me/export')).status, 403, 'no grant for the other session either');
  const mine = await ssoSession(on, P.a, 'u-a');
  const ok = await post(on, form(P.a, 'u-a', 'export', { withSso: false }), { cookie: mine });
  assert.equal(ok.location, '/settings#data'); assert.equal(ok.cookie, null, 'the same session is kept');
  assert.equal((await as(on, mine, 'GET', '/api/me/export')).status, 200);
});

test('SSO of one account + step-up of another (person or Training user) → refused, and no session is created', async () => {
  const r = await post(on, form(P.a, 'u-a', 'export', { stepupFor: [P.b, 'u-b'] }));
  assert.equal(r.location, '/sso#error=denied'); assert.equal(r.cookie, null);
  const s = await post(on, form(P.a, 'u-a', 'export', { stepupFor: [P.b, 'u-a'] }));
  assert.equal(s.location, '/sso#error=denied'); assert.equal(s.cookie, null);
  assert.ok(refused(on, 'other_account')); assert.ok(refused(on, 'other_person'));
  // Browser holding another account's session + SSO for u-a → the F9b rule (never switch silently).
  const otherSession = await ssoSession(on, P.b, 'u-b');
  assert.equal((await post(on, form(P.a, 'u-a', 'export'), { cookie: otherSession })).location, '/sso#error=switch');
});

test('used, repeated or concurrent step-up codes; answers outside the contract → refused', async () => {
  const f = form(P.a, 'u-a', 'export');
  assert.equal((await post(on, f)).location, '/settings#data');
  const replay = await post(on, { ...f, code: ssoCode(P.a, 'u-a'), correlationId: randomUUID() });
  assert.equal(replay.location, '/sso#error=denied', 'the step-up code was already used');
  const g = form(P.a, 'u-a', 'export', { withSso: false });
  const mine = await ssoSession(on, P.a, 'u-a');
  const [x, y] = await Promise.all([post(on, g, { cookie: mine }), post(on, g, { cookie: mine })]);
  assert.deepEqual([x.location, y.location].sort(), ['/settings#data', '/sso#error=denied']);
  for (const override of [{ assurance: 'platform_sso' }, { purpose: 'passkeys' }, { audience: '2j-training' }, { correlationId: 'other' }, { extra: 1 }]) {
    stepupAnswer = override;
    const r = await post(on, form(P.a, 'u-a', 'export'));
    assert.equal(r.location, '/sso#error=denied', JSON.stringify(override)); assert.equal(r.cookie, null);
  }
});

test('staff and ADMIN_UIDS never get a grant (F9e)', async () => {
  assert.equal((await post(on, form(P.staff, 'u-staff', 'export'))).location, '/sso#error=denied');
  assert.equal((await post(on, form(P.env, 'u-env', 'export'))).location, '/sso#error=denied');
});

test('the grant expires after 5 minutes and dies with a restart (memory only)', async () => {
  const t = await startTraining({ ...BRIDGE, PLATFORM_HUB_STEPUP_ENABLED: 'true' });
  const r = await post(t, form(P.a, 'u-a', 'export'));
  assert.equal(r.location, '/settings#data');
  await t.stop();
  const again = await startTraining({ ...BRIDGE, PLATFORM_HUB_STEPUP_ENABLED: 'true' }, t.dir);
  stopped.push(again);
  assert.equal((await as(again, r.cookie, 'GET', '/api/me/export')).status, 403, 'no grant after a restart');
  // Expiry: unit-checked on the store with a fake clock.
  const { createStepup } = await import('../platform-hub/stepup.js');
  let clock = 1_000_000;
  const user = { id: 'u-a' };
  const s = createStepup({ hub: { stepupEnabled: true }, db: { users: [] }, saveDb() {}, secEvent() {}, readSession: () => user, receiver: {}, redeemStepup: null, rateLimit: {}, isStaff: () => false, isEnvAdmin: () => false, now: () => clock });
  const req = { headers: { cookie: 'gymsid=abc' } };
  const key = crypto.createHash('sha256').update('abc').digest('base64url');
  s.grantsForTests.set(key, { userId: 'u-a', purpose: 'delete', expiresAt: clock + 5 * 60_000 });
  assert.equal(s.stepUp.admits(req, 'POST /api/me/delete'), true);
  assert.equal(s.stepUp.admits(req, 'GET /api/me/export'), false, 'other purpose');
  clock += 5 * 60_000;
  assert.equal(s.stepUp.admits(req, 'POST /api/me/delete'), false, 'expired at 5 min');
});

test('platform_passkey opens ONLY the session\'s own export/erasure: every other passkey/staff operation still refuses the SSO session', async () => {
  for (const purpose of ['export', 'delete']) {
    const r = await post(on, form(P.a, 'u-a', purpose));
    const cookie = r.cookie;
    const sensitive = [
      ['GET', '/api/me/passkeys'], ['POST', '/api/me/passkeys/options'], ['POST', '/api/me/passkeys/revoke'], ['POST', '/api/me/delete/options'],
      ['POST', '/api/logout/all'], ['POST', '/api/me/sessions/revoke'], ['POST', '/api/link/approve'], ['POST', '/api/me/step-up'], ['POST', '/api/coach/forget'],
      ['GET', '/api/webhooks'], ['POST', '/api/strava/disconnect'], ['GET', '/api/bunker/pin'], ['GET', '/api/admin/ops'], ['GET', '/api/trainer/members'], ['POST', '/api/guided/save'],
      ['POST', '/api/admin/platform-enforcement'], ['GET', '/api/bunker/admin/sessions'],
    ];
    for (const [method, route] of sensitive) {
      const res = await as(on, cookie, method, route, method === 'POST' ? {} : undefined);
      assert.equal(res.status, 403, `${purpose}: ${method} ${route}`);
      assert.equal((await res.json()).code, 'passkey_required', `${purpose}: ${method} ${route}`);
    }
    // ...and the grant is still there for its own operation (nothing above spent it).
    const level = await (await as(on, cookie, 'GET', '/api/platform/v1/me/training-level')).json();
    assert.equal(level.stepUp?.purpose, purpose);
  }
});

test('platform_sso alone still satisfies nothing: SSO session without a grant → export and erasure refused', async () => {
  const cookie = await ssoSession(on, P.a, 'u-a');
  assert.equal((await (await as(on, cookie, 'GET', '/api/me/export')).json()).code, 'passkey_required');
  assert.equal((await as(on, cookie, 'POST', '/api/me/delete', { confirm: 'ua', platformStepUp: true })).status, 403);
  const level = await (await as(on, cookie, 'GET', '/api/platform/v1/me/training-level')).json();
  assert.equal(level.stepUp, null);
});

test('switch off: the receiver does not exist, training-level has no stepUp field, export/erasure exactly as in F9d', async () => {
  const r = await post(off, form(P.a, 'u-a', 'export'));
  assert.equal(r.status, 404);
  const cookie = await ssoSession(off, P.a, 'u-a');
  const level = await (await as(off, cookie, 'GET', '/api/platform/v1/me/training-level')).json();
  assert.equal('stepUp' in level, false);
  assert.equal((await (await as(off, cookie, 'GET', '/api/me/export')).json()).code, 'passkey_required');
  const before = stepupRedeems;
  await post(off, form(P.a, 'u-a', 'export'));
  assert.equal(stepupRedeems, before, 'Platform is never asked');
});
