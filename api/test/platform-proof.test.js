import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { tempData } from './helpers.mjs';

const DIR = tempData();
const { createPlatformProofStore, platformProofStoreConstants } = await import('../platform-proof/store.js');
const { createPlatformProofRoutes, PLATFORM_LINK_AUDIENCE, PLATFORM_LINK_PURPOSE, PLATFORM_PROOF_TTL_MS } = await import('../platform-proof/routes.js');
const { parseServiceAuthKeys, signPlatformServiceRequest, verifyPlatformServiceRequest, SERVICE_AUTH_PATH } = await import('../platform-proof/service-auth.js');
const { decrypt } = await import('../lib/crypto.js');

const SECRET_A = Buffer.alloc(32, 0x42);
const SECRET_B = Buffer.alloc(32, 0x43);
const KEY_ID_A = 'platform-fixture-a';
const KEY_ID_B = 'platform-fixture-b';
const keys = parseServiceAuthKeys(JSON.stringify({ [KEY_ID_A]: SECRET_A.toString('base64url'), [KEY_ID_B]: SECRET_B.toString('base64url') }));
const platformUserA = 'training-account-A';
const context = (overrides = {}) => ({
  v: 1, transactionId: '11111111-1111-4111-8111-111111111111',
  personId: '22222222-2222-4222-8222-222222222222',
  audience: PLATFORM_LINK_AUDIENCE, purpose: PLATFORM_LINK_PURPOSE,
  challengeDigest: 'a'.repeat(64), expiresAt: new Date(Date.now() + 300_000).toISOString(),
  ...overrides,
});

function fixture({ issuanceEnabled = true, exchangeEnabled = true, session = { id: platformUserA, authLevel: 'passkey' }, clock = Date.now() } = {}) {
  let current = typeof clock === 'function' ? clock() : clock;
  const now = () => current;
  const dataDir = fs.mkdtempSync(path.join(DIR, 'fixture-'));
  const store = createPlatformProofStore({ dataDir, now });
  const activeUsers = [{ id: platformUserA, disabled: false }, { id: 'training-account-B', disabled: false }];
  const routes = createPlatformProofRoutes({
    json: (res, status, body) => { res.statusCode = status; res.body = body; return res; },
    readSession: () => session,
    store,
    users: () => activeUsers,
    issuanceEnabled,
    exchangeEnabled,
    serviceKeys: keys,
    now,
  });
  function setNow(value) { current = value; }
  return { dataDir, store, routes, activeUsers, now, setNow };
}

function request(method, url, bodyBytes, headers = {}) {
  const req = Readable.from(bodyBytes?.length ? [bodyBytes] : []);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function response() {
  return { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; } };
}

async function invoke(handler, method, url, body, headers = {}) {
  const raw = Buffer.isBuffer(body) ? body : Buffer.from(body ?? '');
  const res = response();
  await handler(request(method, url, raw, headers), res);
  return res;
}

function signedHeaders({ body, path = SERVICE_AUTH_PATH, keyId = KEY_ID_A, secret = SECRET_A, timestamp = new Date().toISOString(), requestId = randomUUID(), method = 'POST' }) {
  const signed = signPlatformServiceRequest({ keyId, secret, timestamp, requestId, method, path, body });
  return {
    headers: {
      'content-type': 'application/json', 'x-2j-key-id': keyId,
      'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId,
      'x-2j-signature': signed.signature,
    },
    requestId, canonical: signed.canonical, bodyDigest: signed.bodyDigest,
  };
}

async function issue(f, ctx = context(), { cookie = false } = {}) {
  const raw = Buffer.from(JSON.stringify(ctx));
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie: 'gymsid=ignored-session-cookie' } : {}) };
  return invoke(f.routes['POST /api/platform/v1/link-proofs'], 'POST', '/api/platform/v1/link-proofs', raw, headers);
}

async function exchange(f, code, ctx = context(), options = {}) {
  const { expiresAt: _expiresAt, v: _version, ...exchangeContext } = ctx;
  const body = Buffer.from(JSON.stringify({ v: 1, code, ...exchangeContext, ...options.bodyOverrides }));
  const signed = signedHeaders({ body, ...options.signing });
  const headers = { ...signed.headers, ...(options.headers || {}) };
  return { response: await invoke(f.routes['POST /api/platform/v1/link-proofs/exchange'], 'POST', options.requestTarget || SERVICE_AUTH_PATH, body, headers), body, signed };
}

test('feature flags stay independently off by default and issuance requires a real account session', async () => {
  const disabled = fixture({ issuanceEnabled: false, exchangeEnabled: false, session: null });
  assert.equal((await issue(disabled)).statusCode, 423);
  const issuanceOnly = fixture({ issuanceEnabled: true, exchangeEnabled: false, session: null });
  assert.equal((await issue(issuanceOnly)).statusCode, 401);
  const pinSession = fixture({ issuanceEnabled: true, session: { id: platformUserA, authLevel: 'pin' } });
  assert.equal((await issue(pinSession)).body.error, 'authentication_required', 'a shared-staff PIN session is not proof of a member-controlled Training account');
  const noBody = fixture({ issuanceEnabled: true, exchangeEnabled: false, session: null });
  assert.equal((await invoke(noBody.routes['POST /api/platform/v1/link-proofs'], 'POST', '/api/platform/v1/link-proofs', '', { 'content-type': 'application/json' })).body.error, 'authentication_required');
  assert.equal((await invoke(noBody.routes['POST /api/platform/v1/link-proofs/exchange'], 'POST', SERVICE_AUTH_PATH, '{}', { 'content-type': 'application/json' })).statusCode, 423, 'issuance and exchange flags do not enable each other');
});

test('authenticated issuance binds only the current session subject and stores only encrypted proof hashes', async () => {
  const f = fixture();
  const withCallerId = await issue(f, context({ trainingUserId: 'training-account-B', userId: 'training-account-B' }));
  assert.equal(withCallerId.statusCode, 400, 'strict request schema rejects caller-supplied Training identities');

  const ctx = context();
  const issued = await issue(f, ctx);
  assert.equal(issued.statusCode, 201);
  assert.deepEqual(Object.keys(issued.body).sort(), ['code', 'expiresAt', 'v']);
  assert.equal(issued.body.v, 1);
  assert.match(issued.body.code, /^[A-Za-z0-9_-]{43}$/);
  assert.ok(Date.parse(issued.body.expiresAt) <= Date.parse(ctx.expiresAt));
  assert.ok(Date.parse(issued.body.expiresAt) - f.now() <= PLATFORM_PROOF_TTL_MS);
  assert.equal(issued.headers['cache-control'], 'no-store');

  const proofFile = path.join(f.dataDir, platformProofStoreConstants.STORE_FILE);
  const disk = fs.readFileSync(proofFile, 'utf8');
  assert.equal(disk.includes(issued.body.code), false, 'raw code is not persisted in plaintext');
  const persisted = decrypt(disk, platformProofStoreConstants.INFO);
  assert.equal(persisted.proofs.length, 1);
  assert.equal(persisted.proofs[0].trainingUserId, platformUserA, 'stored account identity comes from the server session');
  assert.equal(persisted.proofs[0].codeHash, createHash('sha256').update(issued.body.code).digest('hex'));
  assert.equal(JSON.stringify(persisted).includes(issued.body.code), false);
  const audit = JSON.stringify(f.store.auditEvents());
  for (const secret of [issued.body.code, ctx.challengeDigest, 'passkey assertion']) assert.equal(audit.includes(secret), false);
  assert.equal(JSON.stringify(issued.body).includes(platformUserA), false);
});

test('issuance validates strict context and Platform expiry; effective proof lifetime is capped at two minutes', async () => {
  const f = fixture();
  const invalidCases = [
    [{ audience: 'other' }, 400, 'invalid_context'],
    [{ purpose: 'other' }, 400, 'invalid_context'],
    [{ challengeDigest: 'A'.repeat(64) }, 400, 'invalid_context'],
    [{ transactionId: 'not-a-uuid' }, 400, 'invalid_context'],
    [{ expiresAt: '2026-10-10T12:00:00Z' }, 400, 'invalid_context'],
    [{ expiresAt: new Date(f.now() - 1).toISOString() }, 410, 'platform_challenge_expired'],
    [{ expiresAt: new Date(f.now() + 330_001).toISOString() }, 400, 'invalid_context'],
    [{ clientId: 'not-accepted' }, 400, 'invalid_context'],
  ];
  for (const [overrides, status, error] of invalidCases) {
    const result = await issue(f, context(overrides));
    assert.equal(result.statusCode, status);
    assert.equal(result.body.error, error);
  }
  const short = await issue(f, context({ expiresAt: new Date(f.now() + 30_000).toISOString() }));
  assert.equal(Date.parse(short.body.expiresAt), Date.parse(new Date(f.now() + 30_000).toISOString()), 'effective TTL is the earlier Platform expiry');
  const regular = await issue(f);
  assert.equal(Date.parse(regular.body.expiresAt), f.now() + PLATFORM_PROOF_TTL_MS, 'proof lifetime defaults to two minutes');
});

test('Platform receiver matches exact 2J-SERVICE-AUTH-V1 canonical bytes and accepts key rotation', () => {
  assert.equal(keys.size, 2);
  assert.equal(parseServiceAuthKeys(JSON.stringify({ short: Buffer.from('short').toString('base64url') })).size, 0, 'undersized keys fail closed');
  const body = Buffer.from('{"v":1}');
  const timestamp = '2026-10-10T12:00:00.000Z';
  const requestId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const signed = signPlatformServiceRequest({ keyId: KEY_ID_A, secret: SECRET_A, timestamp, requestId, body });
  assert.equal(signed.canonical, [
    '2J-SERVICE-AUTH-V1', KEY_ID_A, timestamp, requestId, 'POST', SERVICE_AUTH_PATH,
    createHash('sha256').update(body).digest('hex'),
  ].join('\n'));
  const goldenBody = Buffer.from('{"v":1,"code":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","transactionId":"11111111-1111-4111-8111-111111111111","personId":"22222222-2222-4222-8222-222222222222","audience":"2j-training-account-link","purpose":"training-account-link","challengeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}');
  const golden = signPlatformServiceRequest({ keyId: KEY_ID_A, secret: SECRET_A, timestamp, requestId, body: goldenBody });
  assert.equal(golden.bodyDigest, '8473ddd28ddf57f9964b66dabac8ff0d4bda6a491e112be5f59633df088ca52a');
  assert.equal(golden.canonical, `2J-SERVICE-AUTH-V1\n${KEY_ID_A}\n${timestamp}\n${requestId}\nPOST\n${SERVICE_AUTH_PATH}\n8473ddd28ddf57f9964b66dabac8ff0d4bda6a491e112be5f59633df088ca52a`);
  assert.equal(golden.signature, 'F6GYp70w6TrZtTCWb4Jcmv3T92UxMyxGpUl2A6oK9oY');
  for (const [keyId, secret] of [[KEY_ID_A, SECRET_A], [KEY_ID_B, SECRET_B]]) {
    const proof = signPlatformServiceRequest({ keyId, secret, timestamp, requestId, body });
    const valid = verifyPlatformServiceRequest({ method: 'POST', requestTarget: SERVICE_AUTH_PATH, headers: {
      'x-2j-key-id': keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': proof.signature,
    }, body, keys, now: Date.parse(timestamp) });
    assert.equal(valid.status, 'ok', `${keyId} is accepted during rotation`);
  }
  const valid = signedHeaders({ body, timestamp, requestId });
  const check = headers => verifyPlatformServiceRequest({ method: 'POST', requestTarget: SERVICE_AUTH_PATH, headers, body, keys, now: Date.parse(timestamp) });
  assert.equal(check({}).status, 'service_auth_required');
  assert.equal(check({ ...valid.headers, 'x-2j-key-id': 'unknown' }).status, 'service_auth_invalid');
  assert.equal(check({ ...valid.headers, 'x-2j-signature': 'bad' }).status, 'service_auth_invalid');
  assert.equal(check({ ...valid.headers, 'x-2j-timestamp': new Date(Date.parse(timestamp) - 61_000).toISOString() }).status, 'service_auth_invalid');
  assert.equal(check({ ...valid.headers, 'x-2j-timestamp': new Date(Date.parse(timestamp) + 61_000).toISOString() }).status, 'service_auth_invalid');
  assert.equal(verifyPlatformServiceRequest({ method: 'GET', requestTarget: SERVICE_AUTH_PATH, headers: valid.headers, body, keys, now: Date.parse(timestamp) }).status, 'service_auth_invalid');
  assert.equal(verifyPlatformServiceRequest({ method: 'POST', requestTarget: SERVICE_AUTH_PATH + '?x=1', headers: valid.headers, body, keys, now: Date.parse(timestamp) }).status, 'service_auth_invalid');
  assert.equal(verifyPlatformServiceRequest({ method: 'POST', requestTarget: SERVICE_AUTH_PATH, headers: valid.headers, body: Buffer.from('{"v":2}'), keys, now: Date.parse(timestamp) }).status, 'service_auth_invalid', 'body bytes are integrity protected');
});

test('browser cookies alone cannot authorize backend exchange', async () => {
  const f = fixture({ session: { id: platformUserA, authLevel: 'passkey' } });
  const result = await invoke(f.routes['POST /api/platform/v1/link-proofs/exchange'], 'POST', SERVICE_AUTH_PATH,
    Buffer.from('{}'), { 'content-type': 'application/json', cookie: 'gymsid=valid-looking-browser-cookie' });
  assert.equal(result.statusCode, 401);
  assert.equal(result.body.error, 'service_auth_required');
});

test('proof is bound to every exact context field; mismatches do not consume it and exchange returns only the verified account ID', async () => {
  const f = fixture({ session: null }); // exchange is service-auth only; it must not consult a browser cookie
  const ctx = context();
  const issued = f.store.issue({ ...ctx, platformExpiresAtMs: Date.parse(ctx.expiresAt) }, platformUserA);
  const mismatches = [
    { transactionId: '33333333-3333-4333-8333-333333333333' },
    { personId: '44444444-4444-4444-8444-444444444444' },
    { audience: 'other-audience' },
    { purpose: 'other-purpose' },
    { challengeDigest: 'b'.repeat(64) },
  ];
  for (const mismatch of mismatches) {
    const result = await exchange(f, issued.code, { ...ctx, ...mismatch });
    assert.equal(result.response.statusCode, 409, JSON.stringify(result.response.body));
    assert.equal(result.response.body.error, 'proof_context_mismatch');
  }
  const success = await exchange(f, issued.code, ctx);
  assert.equal(success.response.statusCode, 200, success.response.body.error);
  assert.deepEqual(success.response.body, {
    v: 1, transactionId: ctx.transactionId, personId: ctx.personId,
    trainingUserId: platformUserA, audience: ctx.audience, purpose: ctx.purpose,
    verifiedAt: new Date(f.now()).toISOString(),
  });
  assert.equal(success.response.headers['cache-control'], 'no-store');
  const replay = await exchange(f, issued.code, ctx);
  assert.equal(replay.response.statusCode, 409);
  assert.equal(replay.response.body.error, 'proof_already_consumed');
  assert.equal(JSON.stringify(success.response.body).includes('email'), false);
});

test('proof reissue invalidates the earlier raw code; expiry and account revocation fail closed', async () => {
  const f = fixture();
  const ctx = context();
  const first = await issue(f, ctx);
  const second = await issue(f, ctx);
  assert.notEqual(first.body.code, second.body.code);
  const oldCode = await exchange(f, first.body.code, ctx);
  assert.equal(oldCode.response.statusCode, 410, JSON.stringify(oldCode.response.body));
  assert.equal(oldCode.response.body.error, 'proof_expired');
  const success = await exchange(f, second.body.code, ctx);
  assert.equal(success.response.statusCode, 200);

  const expiring = fixture();
  const expiringCtx = context();
  const proof = await issue(expiring, expiringCtx);
  expiring.setNow(Date.parse(proof.body.expiresAt) + 1);
  const expired = await exchange(expiring, proof.body.code, expiringCtx, { signing: { timestamp: new Date(expiring.now()).toISOString() } });
  assert.equal(expired.response.statusCode, 410);
  assert.equal(expired.response.body.error, 'proof_expired');

  const revoked = fixture();
  const revokedCtx = context();
  const revokedProof = await issue(revoked, revokedCtx);
  revoked.activeUsers[0].disabled = true;
  const noLongerActive = await exchange(revoked, revokedProof.body.code, revokedCtx);
  assert.equal(noLongerActive.response.statusCode, 404);
  assert.equal(noLongerActive.response.body.error, 'proof_not_found');
  revoked.activeUsers[0].disabled = false;
  assert.equal((await exchange(revoked, revokedProof.body.code, revokedCtx)).response.statusCode, 200, 'inactive Training identity was not consumed');
});

test('concurrent issuance leaves only the last durable code usable and never replays a raw code', async () => {
  const f = fixture();
  const ctx = context();
  const [first, second] = await Promise.all([issue(f, ctx), issue(f, ctx)]);
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 201);
  assert.notEqual(first.body.code, second.body.code);
  const persisted = decrypt(fs.readFileSync(path.join(f.dataDir, platformProofStoreConstants.STORE_FILE), 'utf8'), platformProofStoreConstants.INFO);
  assert.equal(persisted.proofs.filter(proof => proof.status === 'pending').length, 1);
  for (const code of [first.body.code, second.body.code]) {
    const replay = await exchange(f, code, ctx);
    assert.ok([200, 410].includes(replay.response.statusCode));
  }
  assert.equal((await exchange(f, second.body.code, ctx)).response.body.error, 'proof_already_consumed');
});

test('service request IDs persist across store reload and concurrent exchanges have exactly one winner', async () => {
  const f = fixture();
  const ctx = context();
  const issued = await issue(f, ctx);
  const { expiresAt: _expiresAt, v: _version, ...exchangeContext } = ctx;
  const body = Buffer.from(JSON.stringify({ v: 1, code: issued.body.code, ...exchangeContext }));
  const requestId = randomUUID();
  const headers = signedHeaders({ body, requestId }).headers;
  const concurrent = await Promise.all([
    invoke(f.routes['POST /api/platform/v1/link-proofs/exchange'], 'POST', SERVICE_AUTH_PATH, body, headers),
    invoke(f.routes['POST /api/platform/v1/link-proofs/exchange'], 'POST', SERVICE_AUTH_PATH, body, headers),
  ]);
  assert.deepEqual(concurrent.map(result => result.statusCode).sort(), [200, 409], JSON.stringify(concurrent.map(result => result.body)));
  assert.ok(concurrent.some(result => result.body.error === 'service_request_replayed'));
  const reloadedStore = createPlatformProofStore({ dataDir: f.dataDir, now: f.now });
  const reloadedRoutes = createPlatformProofRoutes({
    json: (res, status, value) => { res.statusCode = status; res.body = value; return res; },
    readSession: null, store: reloadedStore, users: () => f.activeUsers,
    issuanceEnabled: false, exchangeEnabled: true, serviceKeys: keys, now: f.now,
  });
  const seenAgain = await invoke(reloadedRoutes['POST /api/platform/v1/link-proofs/exchange'], 'POST', SERVICE_AUTH_PATH, body, headers);
  assert.equal(seenAgain.statusCode, 409);
  assert.equal(seenAgain.body.error, 'service_request_replayed', 'service replay state survives a process/store reload');
  assert.equal(JSON.stringify(reloadedStore.auditEvents()).includes(issued.body.code), false);
});
