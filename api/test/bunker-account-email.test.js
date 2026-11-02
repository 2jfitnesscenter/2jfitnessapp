import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { Readable } from 'node:stream';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

// Task 6b: Bunker keeps a verified e-mail per account and answers two signed internal lookups for Platform (caller `platform` only).
const DIR = tempData();
const SECRET = 'a'.repeat(64);
const API_ROOT = path.resolve('.');
const { createPlatformProofStore } = await import('../platform-proof/store.js');
const { signPlatformServiceRequest } = await import('../platform-proof/service-auth.js');
const mod = await import('../platform-sso/bunker-account.js');
const { createBunkerAccountRoutes, parseInternalServiceKeys, normalizeEmail, emailFields, BUNKER_ACCOUNT_EMAIL_PATH, BUNKER_ACCOUNT_BY_EMAIL_PATH } = mod;
const { classifyRoute } = await import('../platform-sso/route-policy.js');

const SECRETS = { platform: Buffer.alloc(32, 0x51), bunker: Buffer.alloc(32, 0x52), home: Buffer.alloc(32, 0x53) };
const KEY_IDS = { platform: 'platform-1', bunker: 'bunker-1', home: 'home-1' };
const KEYS_ENV = JSON.stringify(Object.fromEntries(Object.keys(SECRETS).map(caller => [KEY_IDS[caller], { caller, secret: SECRETS[caller].toString('base64url') }])));

/* ------------------------------------------------------------------ pure helpers */
test('normalizeEmail: trim + lowercase, 3..254 characters, basic shape; anything else is null', () => {
  assert.equal(normalizeEmail('  Ana.Perez@Example.COM '), 'ana.perez@example.com');
  for (const bad of ['', '   ', 'a@', '@b.co', 'no-at-sign', 'a b@c.de', 'a@b', 'x'.repeat(250) + '@b.co', null, undefined, 42, {}]) assert.equal(normalizeEmail(bad), null, String(bad));
  assert.equal(normalizeEmail('a@b.c'), 'a@b.c');
});

test('emailFields: a new account stores the normalized e-mail UNVERIFIED, or null when none was sent', () => {
  assert.deepEqual(emailFields('  Ana@Example.com '), { email: 'ana@example.com', emailVerified: false });
  assert.deepEqual(emailFields(undefined), { email: null, emailVerified: false });
  assert.deepEqual(emailFields(''), { email: null, emailVerified: false });
});

test('parseInternalServiceKeys keeps the caller of every key and drops malformed entries', () => {
  const keys = parseInternalServiceKeys(KEYS_ENV);
  assert.equal(keys.get('platform-1').caller, 'platform');
  assert.equal(keys.get('bunker-1').caller, 'bunker');
  assert.equal(keys.get('home-1').caller, 'home');
  assert.equal(parseInternalServiceKeys(JSON.stringify({ k: { caller: 'evil', secret: SECRETS.platform.toString('base64url') } })).size, 0);
  assert.equal(parseInternalServiceKeys(JSON.stringify({ k: { caller: 'platform', secret: 'short' } })).size, 0);
  assert.equal(parseInternalServiceKeys('not json').size, 0);
  assert.equal(parseInternalServiceKeys(undefined).size, 0);
});

test('the internal paths are classified (not unclassified) so the route-policy inventory stays complete', () => {
  assert.notEqual(classifyRoute(`POST ${BUNKER_ACCOUNT_EMAIL_PATH}`).kind, 'unclassified');
  assert.notEqual(classifyRoute(`POST ${BUNKER_ACCOUNT_BY_EMAIL_PATH}`).kind, 'unclassified');
});

/* ------------------------------------------------------------------ route handlers (in process) */
function fixture() {
  const dataDir = fs.mkdtempSync(path.join(DIR, 'fx-'));
  const clock = Date.now();
  const now = () => clock;
  const db = { users: [
    { id: 'u-a', name: 'A', email: null, emailVerified: false },
    { id: 'u-b', name: 'B', email: null, emailVerified: false },
    { id: 'u-gone', name: 'G', email: null, emailVerified: false, disabled: true },
  ] };
  const events = [], logs = [];
  let saves = 0;
  const routes = createBunkerAccountRoutes({
    json: (res, status, body) => { res.statusCode = status; res.body = body; return res; },
    db, saveDb: () => { saves++; }, store: createPlatformProofStore({ dataDir, now }), keys: parseInternalServiceKeys(KEYS_ENV),
    secEvent: (event, detail) => events.push({ event, detail }), log: { error: m => logs.push(String(m)), warn: m => logs.push(String(m)) }, now,
  });
  return { db, routes, events, logs, saves: () => saves };
}
async function call(f, path_, payload, { caller = 'platform', headers = {}, raw } = {}) {
  const body = raw ?? Buffer.from(JSON.stringify(payload));
  const timestamp = new Date().toISOString(), requestId = randomUUID();
  const { signature } = signPlatformServiceRequest({ keyId: KEY_IDS[caller], secret: SECRETS[caller], timestamp, requestId, method: 'POST', path: path_, body });
  const req = Readable.from([body]);
  req.method = 'POST'; req.url = path_;
  req.headers = { 'content-type': 'application/json', 'x-2j-key-id': KEY_IDS[caller], 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature, ...headers };
  const res = { setHeader() {} };
  await f.routes[`POST ${path_}`](req, res);
  return { res, req };
}
const sync = (f, payload, opts) => call(f, BUNKER_ACCOUNT_EMAIL_PATH, payload, opts);
const lookup = (f, payload, opts) => call(f, BUNKER_ACCOUNT_BY_EMAIL_PATH, payload, opts);
const noEmailIn = (res, ...emails) => { const text = JSON.stringify(res.body).toLowerCase(); for (const e of emails) assert.ok(!text.includes(e.toLowerCase()), 'the response leaked the e-mail'); };

test('sync with a platform signature: 200 { uid, emailVerified: true }, stored normalized, e-mail never returned', async () => {
  const f = fixture();
  const { res } = await sync(f, { uid: 'u-a', email: '  Ana@Example.COM ' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { uid: 'u-a', emailVerified: true });
  assert.equal(f.db.users[0].email, 'ana@example.com');
  assert.equal(f.db.users[0].emailVerified, true);
  assert.ok(f.saves() >= 1);
  noEmailIn(res, 'ana@example.com');
});

test('sync signed by a bunker or home key: 401 service_auth_rejected and nothing is written', async () => {
  for (const caller of ['bunker', 'home']) {
    const f = fixture();
    const { res } = await sync(f, { uid: 'u-a', email: 'ana@example.com' }, { caller });
    assert.equal(res.statusCode, 401, caller);
    assert.deepEqual(res.body, { error: 'service_auth_rejected' });
    assert.equal(f.db.users[0].emailVerified, false);
    assert.equal(f.db.users[0].email, null);
  }
});

test('lookup signed by a bunker or home key: 401 service_auth_rejected', async () => {
  for (const caller of ['bunker', 'home']) {
    const f = fixture();
    f.db.users[0].email = 'ana@example.com'; f.db.users[0].emailVerified = true;
    const { res } = await lookup(f, { email: 'ana@example.com' }, { caller });
    assert.equal(res.statusCode, 401, caller);
    assert.deepEqual(res.body, { error: 'service_auth_rejected' });
  }
});

test('unsigned, badly signed or replayed requests are refused and never touch an account', async () => {
  const f = fixture();
  const unsigned = Readable.from([Buffer.from('{}')]); unsigned.method = 'POST'; unsigned.url = BUNKER_ACCOUNT_EMAIL_PATH; unsigned.headers = { 'content-type': 'application/json' };
  const r1 = { setHeader() {} }; await f.routes[`POST ${BUNKER_ACCOUNT_EMAIL_PATH}`](unsigned, r1);
  assert.equal(r1.statusCode, 401); assert.equal(r1.body.error, 'service_auth_required');
  const bad = await sync(f, { uid: 'u-a', email: 'ana@example.com' }, { headers: { 'x-2j-signature': 'A'.repeat(43) } });
  assert.equal(bad.res.statusCode, 401);
  assert.equal(f.db.users[0].emailVerified, false);
  const body = Buffer.from(JSON.stringify({ uid: 'u-a', email: 'ana@example.com' })), requestId = randomUUID(), timestamp = new Date().toISOString();
  const { signature } = signPlatformServiceRequest({ keyId: KEY_IDS.platform, secret: SECRETS.platform, timestamp, requestId, method: 'POST', path: BUNKER_ACCOUNT_EMAIL_PATH, body });
  const again = async () => {
    const req = Readable.from([body]); req.method = 'POST'; req.url = BUNKER_ACCOUNT_EMAIL_PATH;
    req.headers = { 'content-type': 'application/json', 'x-2j-key-id': KEY_IDS.platform, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature };
    const res = { setHeader() {} }; await f.routes[`POST ${BUNKER_ACCOUNT_EMAIL_PATH}`](req, res); return res;
  };
  assert.equal((await again()).statusCode, 200);
  assert.equal((await again()).statusCode, 409);
});

test('sync to a uid that does not exist (or is disabled): 404 account_not_found', async () => {
  const f = fixture();
  for (const uid of ['ghost', 'u-gone']) {
    const { res } = await sync(f, { uid, email: 'x@example.com' });
    assert.equal(res.statusCode, 404, uid);
    assert.deepEqual(res.body, { error: 'account_not_found' });
  }
});

test('sync when the e-mail is already verified on ANOTHER account: 409 email_already_verified; the same account may re-sync', async () => {
  const f = fixture();
  assert.equal((await sync(f, { uid: 'u-a', email: 'shared@example.com' })).res.statusCode, 200);
  const clash = await sync(f, { uid: 'u-b', email: 'SHARED@example.com' });
  assert.equal(clash.res.statusCode, 409);
  assert.deepEqual(clash.res.body, { error: 'email_already_verified' });
  assert.equal(f.db.users[1].emailVerified, false);
  assert.equal(f.db.users[1].email, null);
  noEmailIn(clash.res, 'shared@example.com');
  assert.equal((await sync(f, { uid: 'u-a', email: 'shared@example.com' })).res.statusCode, 200, 'idempotent for the owner');
});

test('sync (unchanged by 6c): an UNVERIFIED copy of the same e-mail on another account does not block it', async () => {
  const f = fixture();
  f.db.users[1].email = 'dup@example.com';
  assert.equal((await sync(f, { uid: 'u-a', email: 'dup@example.com' })).res.statusCode, 200);
});

test('sync/lookup reject malformed bodies with 400', async () => {
  const f = fixture();
  for (const body of [{ uid: 'u-a' }, { uid: 'u-a', email: 'nope' }, { uid: 5, email: 'a@b.co' }, { uid: 'u-a', email: 'a@b.co', verified: false }, { uid: '', email: 'a@b.co' }]) {
    const { res } = await sync(f, body);
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.deepEqual(res.body, { error: 'invalid_request' });
  }
  for (const body of [{}, { email: 'nope' }, { email: 'a@b.co', extra: 1 }]) assert.equal((await lookup(f, body)).res.statusCode, 400, JSON.stringify(body));
  assert.equal((await sync(f, undefined, { raw: Buffer.from('{not json') })).res.statusCode, 400);
});

test('lookup: 200 { uid } for exactly one verified account; the e-mail is not returned', async () => {
  const f = fixture();
  await sync(f, { uid: 'u-b', email: 'Bea@Example.com' });
  const { res } = await lookup(f, { email: ' bea@example.COM ' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { uid: 'u-b' });
  noEmailIn(res, 'bea@example.com');
});

test('lookup (task 6c): an UNVERIFIED stored e-mail matches too, 200 { uid }; the e-mail is not returned', async () => {
  const f = fixture();
  f.db.users[0].email = 'only-unverified@example.com';
  const { res } = await lookup(f, { email: ' Only-Unverified@Example.com ' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { uid: 'u-a' });
  noEmailIn(res, 'only-unverified@example.com');
});

test('lookup: 404 no_account when nobody has it (no accounts with that e-mail at all)', async () => {
  const f = fixture();
  f.db.users[0].email = 'someone@example.com';
  const { res } = await lookup(f, { email: 'nobody@example.com' });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'no_account' });
  noEmailIn(res, 'nobody@example.com');
});

test('lookup: a DISABLED account never matches, verified or not', async () => {
  const f = fixture();
  for (const emailVerified of [false, true]) {
    Object.assign(f.db.users[2], { email: 'gone@example.com', emailVerified });
    const { res } = await lookup(f, { email: 'gone@example.com' });
    assert.equal(res.statusCode, 404, String(emailVerified));
    assert.deepEqual(res.body, { error: 'no_account' });
  }
});

test('lookup: 409 ambiguous when two accounts carry the e-mail (verified or not); disabled accounts do not count', async () => {
  const f = fixture();
  for (const [first, second] of [[true, true], [true, false], [false, false]]) {
    Object.assign(f.db.users[0], { email: 'twin@example.com', emailVerified: first });
    Object.assign(f.db.users[1], { email: 'twin@example.com', emailVerified: second });
    f.db.users[1].disabled = false;
    const { res } = await lookup(f, { email: 'twin@example.com' });
    assert.equal(res.statusCode, 409, `${first}/${second}`);
    assert.deepEqual(res.body, { error: 'ambiguous' });
    noEmailIn(res, 'twin@example.com');
    f.db.users[1].disabled = true;
    assert.deepEqual((await lookup(f, { email: 'twin@example.com' })).res.body, { uid: 'u-a' });
  }
});

test('R3: nothing the routes log or record contains the e-mail or the request body', async () => {
  const f = fixture();
  await sync(f, { uid: 'u-a', email: 'secretmail@example.com' });
  await sync(f, { uid: 'u-b', email: 'secretmail@example.com' });
  await lookup(f, { email: 'secretmail@example.com' });
  await sync(f, { uid: 'ghost', email: 'secretmail@example.com' });
  const everything = JSON.stringify({ events: f.events, logs: f.logs });
  assert.ok(!everything.includes('secretmail'), 'e-mail leaked into a log or security event');
  assert.ok(f.events.some(e => e.detail?.userId === 'u-a'), 'the uid and result code are recorded');
});

/* ------------------------------------------------------------------ the real server: profile edit, registration validation, wiring */
const port = await new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port: p } = probe.address(); probe.close(() => resolve(p)); }); });
const base = `http://localhost:${port}`;
fs.writeFileSync(path.join(DIR, 'db.json'), JSON.stringify({
  users: [
    { id: 'old-user', name: 'Old', username: 'olduser' },   // an account from before this task: no e-mail fields at all
    { id: 'mailer', name: 'Mailer', username: 'mailer', email: 'mailer@example.com', emailVerified: true },
    { id: 'ssoer', name: 'Ssoer', username: 'ssoer' },
  ], creds: [], subs: [], invites: [], recoveries: [],
  deviceSessions: [{ id: 'sso-1', userId: 'ssoer', via: 'sso', expiresAt: Date.now() + 86_400_000, lastUsedAt: new Date().toISOString() }],
}, null, 2));
// Started lazily by the first HTTP test (a top-level await here would let the runner finish the earlier tests and kill the server first).
let child = null;
const started = (async () => {
  child = spawn(process.execPath, ['server.js'], { cwd: API_ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: DIR, SECRET_FILE: path.join(DIR, 'secret'), RP_ID: 'localhost', ORIGIN: base, PLATFORM_INTERNAL_SERVICE_KEYS: KEYS_ENV }, stdio: ['ignore', 'ignore', 'inherit'], windowsHide: true });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error('isolated API did not start');
})();
started.catch(() => {});
after(() => child?.kill());
const cookie = uid => { const payload = `${uid}:${Date.now() + 86_400_000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
const ssoCookie = () => { const payload = `ssoer:${Date.now() + 86_400_000}:0:sso:${Date.now()}:sso-1`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
const post = async (route, { uid, body, caller, rawCookie } = {}) => {
  await started;
  const raw = Buffer.from(JSON.stringify(body ?? {}));
  const headers = { 'content-type': 'application/json' };
  if (uid) headers.cookie = cookie(uid);
  if (rawCookie) headers.cookie = rawCookie;
  if (caller) {
    const timestamp = new Date().toISOString(), requestId = randomUUID();
    const { signature } = signPlatformServiceRequest({ keyId: KEY_IDS[caller], secret: SECRETS[caller], timestamp, requestId, method: 'POST', path: route, body: raw });
    Object.assign(headers, { 'x-2j-key-id': KEY_IDS[caller], 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature });
  }
  const response = await fetch(base + route, { method: 'POST', headers, body: raw });
  let json = null; try { json = await response.json(); } catch { /* none */ }
  return { status: response.status, json };
};
const dbUser = id => JSON.parse(fs.readFileSync(path.join(DIR, 'db.json'), 'utf8')).users.find(u => u.id === id);

test('existing accounts without e-mail are backfilled to email null / emailVerified false', async () => {
  await started;
  const user = dbUser('old-user');
  assert.equal(user.email, null);
  assert.equal(user.emailVerified, false);
});

test('profile edit: a session user can set an e-mail (normalized, unverified); changing a verified one resets the flag', async () => {
  const set = await post('/api/me/username', { uid: 'old-user', body: { email: '  Old@Example.com ' } });
  assert.equal(set.status, 200);
  assert.equal(dbUser('old-user').email, 'old@example.com');
  assert.equal(dbUser('old-user').emailVerified, false);
  assert.equal(dbUser('mailer').emailVerified, true);
  const change = await post('/api/me/username', { uid: 'mailer', body: { email: 'mailer2@example.com' } });
  assert.equal(change.status, 200);
  assert.equal(dbUser('mailer').email, 'mailer2@example.com');
  assert.equal(dbUser('mailer').emailVerified, false, 'a changed e-mail is no longer verified');
});

test('profile edit: the client can never mark the e-mail verified, bad e-mails are 400, no session is 401', async () => {
  const sneaky = await post('/api/me/username', { uid: 'old-user', body: { email: 'old@example.com', emailVerified: true } });
  assert.equal(sneaky.status, 200);
  assert.equal(dbUser('old-user').emailVerified, false);
  assert.equal((await post('/api/me/username', { uid: 'old-user', body: { email: 'garbage' } })).status, 400);
  assert.equal(dbUser('old-user').email, 'old@example.com', 'a rejected e-mail leaves the stored one untouched');
  assert.equal((await post('/api/me/username', { body: { email: 'a@b.co' } })).status, 401);
});

test('C1: changing the e-mail needs a strong (passkey) session: an sso session gets 403 passkey_required, username-only stays allowed, a passkey session can', async () => {
  const denied = await post('/api/me/username', { rawCookie: ssoCookie(), body: { email: 'attacker@example.com' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.json.code, 'passkey_required');
  assert.equal(dbUser('ssoer').email ?? null, null, 'nothing was stored');
  const both = await post('/api/me/username', { rawCookie: ssoCookie(), body: { username: 'ssoer2', email: 'attacker@example.com' } });
  assert.equal(both.status, 403);
  assert.equal(dbUser('ssoer').username, 'ssoer', 'a refused change stores nothing, not even the username');
  const nameOnly = await post('/api/me/username', { rawCookie: ssoCookie(), body: { username: 'ssoer3' } });
  assert.equal(nameOnly.status, 200);
  const ok = await post('/api/me/username', { uid: 'old-user', body: { email: 'strong@example.com' } });
  assert.equal(ok.status, 200);
});

test('profile edit: username-only calls behave exactly as before', async () => {
  const ok = await post('/api/me/username', { uid: 'old-user', body: { username: 'oldie' } });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json, { username: 'oldie' });
  assert.equal((await post('/api/me/username', { uid: 'old-user', body: {} })).status, 400);
  assert.equal((await post('/api/me/username', { uid: 'old-user', body: { username: 'x' } })).status, 400);
});

test('registration validates an optional e-mail up front', async () => {
  assert.equal((await post('/api/register/options', { body: { name: 'New', email: 'garbage' } })).status, 400);
  assert.equal((await post('/api/register/options', { body: { name: 'New', email: 'New@Example.com' } })).status, 200);
  assert.equal((await post('/api/register/options', { body: { name: 'New2' } })).status, 200);
});

test('end to end over HTTP: platform syncs, platform looks up; bunker and home callers get 401', async () => {
  const synced = await post(BUNKER_ACCOUNT_EMAIL_PATH, { caller: 'platform', body: { uid: 'old-user', email: 'Verified@Example.com' } });
  assert.equal(synced.status, 200);
  assert.deepEqual(synced.json, { uid: 'old-user', emailVerified: true });
  assert.equal(dbUser('old-user').emailVerified, true);
  const found = await post(BUNKER_ACCOUNT_BY_EMAIL_PATH, { caller: 'platform', body: { email: 'verified@example.com' } });
  assert.deepEqual(found.json, { uid: 'old-user' });
  assert.equal((await post(BUNKER_ACCOUNT_BY_EMAIL_PATH, { caller: 'platform', body: { email: 'nobody@example.com' } })).status, 404);
  for (const caller of ['bunker', 'home']) {
    for (const route of [BUNKER_ACCOUNT_EMAIL_PATH, BUNKER_ACCOUNT_BY_EMAIL_PATH]) {
      const denied = await post(route, { caller, body: { uid: 'old-user', email: 'verified@example.com' } });
      assert.equal(denied.status, 401, `${caller} ${route}`);
      assert.equal(denied.json.error, 'service_auth_rejected');
    }
  }
  assert.equal((await post(BUNKER_ACCOUNT_BY_EMAIL_PATH, { body: { email: 'verified@example.com' } })).status, 401, 'no signature at all');
});

test('editing the e-mail after Platform verified it drops the verified flag; the lookup follows the STORED e-mail (new one found, old one not)', async () => {
  await post('/api/me/username', { uid: 'old-user', body: { email: 'moved@example.com' } });
  assert.equal(dbUser('old-user').emailVerified, false);
  assert.equal((await post(BUNKER_ACCOUNT_BY_EMAIL_PATH, { caller: 'platform', body: { email: 'verified@example.com' } })).status, 404);
  const moved = await post(BUNKER_ACCOUNT_BY_EMAIL_PATH, { caller: 'platform', body: { email: 'moved@example.com' } });
  assert.equal(moved.status, 200);
  assert.deepEqual(moved.json, { uid: 'old-user' });
});

test('the REAL audit trail keeps the sync (uid + result code) and never the e-mail', async () => {
  const { appendSecurityEvent } = await import('../lib/security-audit.js');
  const f = fixture();
  const real = { securityEvents: [] };
  const routes = createBunkerAccountRoutes({
    json: (res, status, body) => { res.statusCode = status; res.body = body; return res; },
    db: f.db, saveDb() {}, store: createPlatformProofStore({ dataDir: fs.mkdtempSync(path.join(DIR, 'fx-')), now: Date.now }), keys: parseInternalServiceKeys(KEYS_ENV),
    secEvent: (event, { userId = null, actorId = null, meta = null } = {}) => appendSecurityEvent(real, { event, userId, actorId, meta }),
  });
  const g = { routes };
  await sync(g, { uid: 'u-a', email: 'audited@example.com' });
  await sync(g, { uid: 'u-b', email: 'audited@example.com' });
  assert.equal(real.securityEvents.length, 2);
  assert.equal(real.securityEvents[0].event, 'platform_email_sync');
  assert.equal(real.securityEvents[0].userId, 'u-a');
  assert.equal(real.securityEvents[0].meta.reason, 'ok');
  assert.equal(real.securityEvents[1].meta.reason, 'email_already_verified');
  assert.ok(!JSON.stringify(real.securityEvents).includes('audited'), 'no e-mail in the trail');
});
