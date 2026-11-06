import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

/* H13 through the real server: flag off, permission list, step-up, activation by Platform's signed call, admin promotion step-up. */
const DIR = tempData();
const SECRET = 'a'.repeat(64);
const { signPlatformServiceRequest } = await import('../platform-proof/service-auth.js');
const { createPlatformProofStore, platformProofStoreConstants } = await import('../platform-proof/store.js');
const API_ROOT = path.resolve('.');
const LEDGER_KEY = crypto.randomBytes(32).toString('hex');
const linkKey = { id: 'platform-link-fixture', secret: Buffer.alloc(32, 0x66) };

const freePort = () => new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
const names = ['owner', 'pedro', 'otheradmin', 'coach', 'm0', 'm1', 'm2', 'm3', 'target'];
function seed(dir) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: names.map(name => ({ id: `u-${name}`, name: `User ${name}`, username: name, ...(name === 'pedro' || name === 'otheradmin' ? { admin: true, trainer: true } : {}), ...(name === 'coach' ? { trainer: true } : {}) })),
    creds: [], subs: [], invites: [], recoveries: [],
  }));
}
async function start(extraEnv, dir = DIR) {
  seed(dir);
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: API_ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: 'u-owner', ...extraEnv }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  return { base, dir, stop: () => child.kill() };
}
const keys = JSON.stringify({ [linkKey.id]: linkKey.secret.toString('base64url') });
const on = await start({ PLATFORM_ASSISTED_LINK_ENABLED: 'true', PLATFORM_LINK_ISSUERS: 'u-owner,u-pedro', PLATFORM_LINK_LEDGER_KEY: LEDGER_KEY, PLATFORM_LINK_LIFECYCLE_ENABLED: 'true', PLATFORM_SERVICE_AUTH_KEYS: keys });
const off = await start({ PLATFORM_LINK_LIFECYCLE_ENABLED: 'true', PLATFORM_SERVICE_AUTH_KEYS: keys }, DIR + '-off');
const promo = await start({ NODE_ENV: 'production', ADMIN_PROMOTION_STEP_UP: 'false' }, DIR + '-promo');
const promoStagingTest = await start({ NODE_ENV: 'test', STAGING_TEST_MODE: 'true', ADMIN_PROMOTION_STEP_UP: 'false' }, DIR + '-promo-staging-test');
after(() => { on.stop(); off.stop(); promo.stop(); promoStagingTest.stop(); });

const sign = payload => `${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
const cookie = name => `gymsid=${sign(`u-${name}:${Date.now() + 86_400_000}:0`)}`;
let n = 0;
const stepUp = (name, purpose) => sign(`stepup.u-${name}:${Date.now() + 300_000 + ++n}:${purpose}`);
async function api(server, method, route, { as, body, step } = {}) {
  const response = await fetch(server.base + route, { method, headers: { 'content-type': 'application/json', ...(as ? { cookie: cookie(as) } : {}), ...(step ? { 'x-step-up': step } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* empty */ }
  return { status: response.status, json };
}
async function platformCall(server, payload) {
  const route = '/api/platform/v1/link/activate', requestId = randomUUID(), timestamp = new Date().toISOString();
  const raw = Buffer.from(JSON.stringify(payload), 'utf8');
  const { signature } = signPlatformServiceRequest({ keyId: linkKey.id, secret: linkKey.secret, timestamp, requestId, method: 'POST', path: route, body: raw });
  const response = await fetch(server.base + route, { method: 'POST', headers: { 'content-type': 'application/json', 'x-2j-key-id': linkKey.id, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, body: raw });
  return { status: response.status, json: await response.json().catch(() => null) };
}
const P = '/api/admin/platform-link/assist';
const pair = who => ({ personId: randomUUID(), trainingUserId: `u-${who}`, reasonCode: 'lost_device' });

test('flag off (the default): every H13 route is 404 and Platform cannot activate with origin admin_assisted', async () => {
  for (const [method, route] of [['POST', P], ['POST', `${P}-requests`], ['GET', `${P}-requests`], ['POST', `${P}-requests/approve`], ['POST', `${P}-requests/reject`]]) {
    assert.equal((await api(off, method, route, { as: 'owner', body: method === 'POST' ? pair('m0') : undefined, step: stepUp('owner', 'platform-link-issue') })).status, 404, route);
  }
  const attempt = await platformCall(off, { v: 1, linkId: randomUUID(), linkVersion: 1, personId: randomUUID(), trainingUserId: 'u-m0', origin: 'admin_assisted', receiptId: randomUUID(), reviewId: randomUUID() });
  assert.deepEqual([attempt.status, attempt.json.error], [423, 'assisted_link_disabled']);
});

test('who can issue: only the configured holders; an admin is not enough; a trainer/member only request', async () => {
  for (const who of ['otheradmin', 'coach', 'm0']) {
    const r = await api(on, 'POST', P, { as: who, body: pair('m0'), step: stepUp(who, 'platform-link-issue') });
    assert.ok([403].includes(r.status), `${who}: ${r.status}`);
  }
  assert.equal((await api(on, 'POST', P, { as: 'otheradmin', body: pair('m0'), step: stepUp('otheradmin', 'platform-link-issue') })).json.error, 'not_issuer');
  assert.equal((await api(on, 'POST', `${P}-requests`, { as: 'coach', body: { ...pair('m1'), note: 'llamar al 600123456' } })).status, 201);
  assert.equal((await api(on, 'POST', `${P}-requests`, { as: 'otheradmin', body: pair('m2') })).status, 201);
  assert.equal((await api(on, 'POST', `${P}-requests`, { as: 'm3', body: pair('m0') })).status, 403, 'a member cannot ask');
  assert.equal((await api(on, 'GET', `${P}-requests`, { as: 'coach' })).status, 403, 'only holders list the requests');
  const listed = (await api(on, 'GET', `${P}-requests`, { as: 'pedro' })).json.requests;
  assert.equal(listed.length, 2);
  for (const item of listed) assert.deepEqual(Object.keys(item).sort(), ['personId', 'requestId', 'trainingUserId'], 'only P/U and request identifiers are exposed');
  assert.ok(!JSON.stringify(listed).includes('600123456'), 'the free-text note is never returned to the issuer');
  assert.equal((await api(on, 'POST', P, { body: pair('m0') })).status, 401, 'no session');
});

test('issuance needs a step-up of its own purpose, signed for that person, spent by use', async () => {
  const wrongPurpose = await api(on, 'POST', P, { as: 'pedro', body: pair('m0'), step: stepUp('pedro', 'passkeys') });
  assert.deepEqual([wrongPurpose.status, wrongPurpose.json.code], [403, 'step_up_required']);
  const someoneElses = await api(on, 'POST', P, { as: 'pedro', body: pair('m0'), step: stepUp('owner', 'platform-link-issue') });
  assert.equal(someoneElses.status, 403, "another person's step-up is not accepted");
  const token = stepUp('pedro', 'platform-link-issue');
  assert.equal((await api(on, 'POST', P, { as: 'pedro', body: pair('m0'), step: token })).status, 201);
  assert.equal((await api(on, 'POST', P, { as: 'pedro', body: pair('m3'), step: token })).status, 403, 'a spent step-up cannot be reused');
});

test('end to end: a holder approves a request, Platform activates with the receipt and the review id, once', async () => {
  const requests = (await api(on, 'GET', `${P}-requests`, { as: 'owner' })).json.requests;
  const request = requests.find(item => item.trainingUserId === 'u-m1');
  const approved = await api(on, 'POST', `${P}-requests/approve`, { as: 'owner', body: { requestId: request.requestId }, step: stepUp('owner', 'platform-link-issue') });
  assert.equal(approved.status, 201);
  const reviewId = randomUUID();
  const activate = { v: 1, linkId: randomUUID(), linkVersion: 1, personId: request.personId, trainingUserId: 'u-m1', origin: 'admin_assisted', receiptId: approved.json.receiptId, reviewId };
  assert.equal((await platformCall(on, { ...activate, reviewId: undefined })).status, 400, 'reviewId is required');
  assert.equal((await platformCall(on, { ...activate, personId: randomUUID() })).status, 409, 'another person');
  assert.equal((await platformCall(on, { ...activate, receiptId: randomUUID() })).status, 409, 'another receipt');
  const ok = await platformCall(on, activate);
  assert.deepEqual([ok.status, ok.json.status], [200, 'active']);
  const db = JSON.parse(fs.readFileSync(path.join(on.dir, 'db.json'), 'utf8'));
  const user = db.users.find(item => item.id === 'u-m1');
  assert.equal(user.platformLink.origin, 'admin_assisted'); assert.equal(user.platformLink.reviewId, reviewId); assert.equal(user.personId, request.personId);
  const again = await platformCall(on, { ...activate, linkId: randomUUID() });
  assert.equal(again.status, 409, 'the receipt is spent');
  const ledger = fs.readFileSync(path.join(on.dir, 'platform-link-ledger.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  assert.ok(ledger.some(entry => entry.type === 'assist_consumed' && entry.reviewId === reviewId));
  assert.ok(ledger.every(entry => entry.mac && entry.prev), 'every line is chained');
});

test('promoting to administrator always needs the admin\'s passkey step-up; only a staging-test fixture may bypass it', async () => {
  const route = '/api/admin/user/role';
  const none = await api(promo, 'POST', route, { as: 'owner', body: { id: 'u-m0', role: 'admin' } });
  assert.deepEqual([none.status, none.json.code], [403, 'step_up_required']);
  assert.equal((await api(promo, 'POST', route, { as: 'owner', body: { id: 'u-m0', role: 'admin' }, step: stepUp('owner', 'passkeys') })).status, 403, 'wrong purpose');
  const token = stepUp('owner', 'admin-promote');
  assert.equal((await api(promo, 'POST', route, { as: 'owner', body: { id: 'u-m0', role: 'admin' }, step: token })).status, 200);
  assert.equal((await api(promo, 'POST', route, { as: 'owner', body: { id: 'u-m1', role: 'admin' }, step: token })).status, 403, 'spent by the first promotion');
  assert.equal((await api(promo, 'POST', route, { as: 'owner', body: { id: 'u-m2', role: 'admin' } })).json.code, 'step_up_required', 'NODE_ENV=production ignores the false override');
  assert.equal((await api(promo, 'POST', route, { as: 'owner', body: { id: 'u-m0', role: 'member' } })).status, 200, 'demotion needs no step-up');
  assert.equal((await api(promo, 'POST', route, { as: 'owner', body: { id: 'u-coach', role: 'trainer' } })).status, 200, 'other role changes are untouched');
  assert.equal((await api(on, 'POST', route, { as: 'owner', body: { id: 'u-m2', role: 'admin' } })).json.code, 'step_up_required', 'step-up remains required with H13 enabled');
  assert.equal((await api(off, 'POST', route, { as: 'owner', body: { id: 'u-m2', role: 'admin' } })).json.code, 'step_up_required', 'step-up also applies with H13 disabled');
  assert.equal((await api(promoStagingTest, 'POST', route, { as: 'owner', body: { id: 'u-m0', role: 'admin' } })).status, 200, 'explicit staging-test fixture can bypass; not a deployable environment');
});

test('H13 requests and receipts persist encrypted; free note never reaches issuer or db.json', async () => {
  const note = `H13-NOTE-CANARY-${crypto.randomUUID()}`;
  const body = { ...pair('target'), note };
  const created = await api(on, 'POST', `${P}-requests`, { as: 'coach', body });
  assert.equal(created.status, 201);

  const listed = await api(on, 'GET', `${P}-requests`, { as: 'owner' });
  const visible = listed.json.requests.find(item => item.requestId === created.json.requestId);
  assert.ok(visible, 'issuer can see the request identifiers');
  assert.equal(Object.hasOwn(visible, 'note'), false);
  assert.equal(JSON.stringify(visible).includes(note), false);

  const db = JSON.parse(fs.readFileSync(path.join(on.dir, 'db.json'), 'utf8'));
  assert.equal(Object.hasOwn(db.platformAssist || {}, 'requests'), false, 'H13 requests are not persisted in plaintext db.json');
  assert.equal(Object.hasOwn(db.platformAssist || {}, 'receipts'), false, 'H13 receipts are not persisted in plaintext db.json');
  const encryptedPath = path.join(on.dir, platformProofStoreConstants.STORE_FILE);
  const encryptedBytes = fs.readFileSync(encryptedPath, 'utf8');
  assert.equal(encryptedBytes.includes(note), false, 'ciphertext does not expose the free note');
  const proofStore = createPlatformProofStore({ dataDir: on.dir });
  const persistedRequest = proofStore.readAssistedLinkState().requests.find(item => item.requestId === created.json.requestId);
  assert.equal(persistedRequest.note, note, 'the note remains recoverable only through the encrypted store');

  const approved = await api(on, 'POST', `${P}-requests/approve`, { as: 'owner', body: { requestId: created.json.requestId }, step: stepUp('owner', 'platform-link-issue') });
  assert.equal(approved.status, 201);
  const afterApproval = fs.readFileSync(encryptedPath, 'utf8');
  assert.equal(afterApproval.includes(note), false);
  const stored = proofStore.readAssistedLinkState();
  assert.ok(stored.receipts.some(item => item.receiptId === approved.json.receiptId), 'receipt is persisted in the encrypted store');
  assert.equal(stored.requests.find(item => item.requestId === created.json.requestId).note, undefined, 'decided request note is removed');
});
