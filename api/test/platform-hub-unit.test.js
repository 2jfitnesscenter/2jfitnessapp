// F9b · 2J Hub bridge: pure pieces (signature vectors, verifier, link index, retained programs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { signHubRequest, verifyHubRequest, HUB_SERVICE_AUTH_FRESHNESS_MS } from '../platform-hub/service-auth.js';
import { linkState } from '../platform-hub/links.js';
import { HUB_SERVICE_ALLOWLIST } from '../platform-hub/service-routes.js';
import { applyStatePolicy } from '../platform-sso/state-policy.js';
import { baselineCapabilities } from '../platform-sso/capabilities.js';

// Copied AS IS from 2JHub packages/contracts/src/training.ts (SERVICE_AUTH_TEST_VECTORS). Do not edit: if they stop matching, the contract changed.
const SERVICE_AUTH_TEST_VECTORS = {
  secret: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA', // gitleaks:allow (vector de prueba público, no es un secreto)
  cases: [
    {
      keyId: 'bunker-test-1',
      timestamp: '2026-11-14T10:00:00.000Z',
      requestId: '8b9c2f3e-1d2a-4c5b-9e6f-7a8b9c0d1e2f',
      method: 'GET',
      path: '/api/internal/platform/v2/persons/0f8b7a6c-5d4e-4f3a-8b2c-1d0e9f8a7b6c/training-capabilities',
      body: '',
      bodySha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      signature: 'jGT1DtUNkv1h_g-2PF1NPy6vGgYpP8H3W1r2g1ObxwA',
    },
    {
      keyId: 'bunker-test-1',
      timestamp: '2026-11-14T10:00:05.123Z',
      requestId: '1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f',
      method: 'POST',
      path: '/api/internal/platform/v2/training-sso/redeem',
      body: '{"v":1,"code":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","audience":"2j-training","destination":"bunker","correlationId":"corr-1"}',
      bodySha256: '79d92fe6c3d531cc96bdc10e9fbc0d294ac2a65993a13f7363946065ebbd153a',
      signature: 'e8yJXMaeVynuPugGUIf-IMTuLdNWYm4JJKlnU9ixkS0',
    },
  ],
};

test('2J-SERVICE-AUTH-V1: the contract vectors give exactly the published digest and signature, and verify', () => {
  const secret = Buffer.from(SERVICE_AUTH_TEST_VECTORS.secret, 'base64url');
  const keys = new Map([['bunker-test-1', secret]]);
  for (const c of SERVICE_AUTH_TEST_VECTORS.cases) {
    const signed = signHubRequest({ keyId: c.keyId, secret, timestamp: c.timestamp, requestId: c.requestId, method: c.method, target: c.path, body: c.body });
    assert.equal(signed.digest, c.bodySha256, c.method);
    assert.equal(signed.signature, c.signature, c.method);
    const headers = { 'x-2j-key-id': c.keyId, 'x-2j-timestamp': c.timestamp, 'x-2j-request-id': c.requestId, 'x-2j-signature': c.signature };
    const allow = [{ method: c.method, path: c.path }];
    assert.deepEqual(verifyHubRequest({ method: c.method, requestTarget: c.path, headers, body: Buffer.from(c.body), keys, allow, now: Date.parse(c.timestamp) }), { ok: true, keyId: c.keyId, requestId: c.requestId });
  }
});

test('verifier: ±30 s, exact allowlist (GET allowed), unknown key, tampering — all refused with a reason for the audit only', () => {
  const secret = Buffer.alloc(32, 7), keys = new Map([['hub-in', secret]]), now = Date.parse('2026-11-14T10:00:00.000Z');
  const call = ({ method = 'GET', target = '/api/internal/platform/v1/training-users?query=an', body = '', at = now, keyId = 'hub-in', sign = {} } = {}) => {
    const timestamp = new Date(at).toISOString(), requestId = '8b9c2f3e-1d2a-4c5b-9e6f-7a8b9c0d1e2f';
    const { signature } = signHubRequest({ keyId, secret, timestamp, requestId, method: sign.method ?? method, target: sign.target ?? target, body: sign.body ?? body });
    return verifyHubRequest({ method, requestTarget: target, headers: { 'x-2j-key-id': keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature }, body: Buffer.from(body), keys, allow: HUB_SERVICE_ALLOWLIST, now });
  };
  assert.equal(call().ok, true);
  assert.equal(call({ target: '/api/internal/platform/v1/training-users/u-1' }).ok, true);
  assert.equal(call({ method: 'POST', target: '/api/platform/v1/provision', body: '{}' }).ok, true);
  assert.equal(call({ at: now - HUB_SERVICE_AUTH_FRESHNESS_MS }).ok, true, 'exactly 30 s is still fresh');
  assert.equal(call({ at: now - HUB_SERVICE_AUTH_FRESHNESS_MS - 1 }).reason, 'stale');
  assert.equal(call({ at: now + HUB_SERVICE_AUTH_FRESHNESS_MS + 1 }).reason, 'stale');
  assert.equal(call({ method: 'POST', target: '/api/internal/platform/v1/training-users' }).reason, 'not_allowlisted');
  assert.equal(call({ target: '/api/platform/v1/link-proofs/exchange' }).reason, 'not_allowlisted');
  assert.equal(call({ keyId: 'proof-key' }).reason, 'unknown_key');
  assert.equal(call({ sign: { target: '/api/internal/platform/v1/training-users?query=zz' } }).reason, 'bad_signature', 'the query is signed');
  assert.equal(call({ method: 'POST', target: '/api/platform/v1/provision', body: '{"a":2}', sign: { body: '{"a":1}' } }).reason, 'bad_signature');
  assert.equal(verifyHubRequest({ method: 'GET', requestTarget: '/x', headers: {}, body: Buffer.alloc(0), keys, allow: HUB_SERVICE_ALLOWLIST }).reason, 'missing_headers');
});

test('link index: unique in both directions, never by name or e-mail; adoption only for a free user and a free person', () => {
  const P = '0f8b7a6c-5d4e-4f3a-8b2c-1d0e9f8a7b6c', Q = '1f8b7a6c-5d4e-4f3a-8b2c-1d0e9f8a7b6c';
  const db = { users: [
    { id: 'free', name: 'Ana', email: 'ana@x' },
    { id: 'linked', personId: P, platformLink: { personId: P, state: 'active' } },
    { id: 'pending', platformLink: { personId: Q, state: 'pending' } },
    { id: 'meta', personId: Q },
    { id: 'revoked', platformLink: { personId: P, state: 'revoked' } },
  ] };
  const u = id => db.users.find(x => x.id === id);
  assert.deepEqual(linkState(db, u('linked'), P), { status: 'linked' });
  assert.deepEqual(linkState(db, u('free'), P), { status: 'conflict', reason: 'person_taken' }, 'P already belongs to another user');
  assert.deepEqual(linkState(db, u('free'), '2f8b7a6c-5d4e-4f3a-8b2c-1d0e9f8a7b6c'), { status: 'adopt' });
  assert.deepEqual(linkState(db, u('linked'), Q), { status: 'conflict', reason: 'other_person' });
  assert.deepEqual(linkState(db, u('pending'), Q), { status: 'conflict', reason: 'pending' });
  assert.deepEqual(linkState(db, u('revoked'), '3f8b7a6c-5d4e-4f3a-8b2c-1d0e9f8a7b6c'), { status: 'adopt' }, 'after a revocation Platform may link the user again');
});

test('Basic keeps what a trainer delivered (INT-V2-02, H-74): continue and activate it, never change its content; own guided copies stay closed', () => {
  const caps = baselineCapabilities();
  const delivered = { id: 'Xy12trainer', source: 'guided-v2', catalogId: 'c1', status: 'assigned', weeks: [{ n: 1 }], routineSnapshots: { r: { ex: [] } } };
  const own = { id: 'g2jp-u-abc', source: 'guided-v2', catalogId: 'c2', status: 'paused', weeks: [{ n: 1 }] };
  const current = { programs: [delivered, own], activeProgramId: null };
  const run = (mutate, retainDelivered = true) => { const incoming = structuredClone(current); mutate(incoming); return applyStatePolicy({ current, incoming, caps, retainDelivered }); };
  let r = run(s => { s.programs[0].status = 'active'; s.programs[0].startedAt = 1; s.activeProgramId = delivered.id; });
  assert.deepEqual(r.stripped, []); assert.equal(r.state.activeProgramId, delivered.id); assert.equal(r.state.programs[0].status, 'active');
  r = run(s => { s.programs[0].weeks.push({ n: 2 }); });
  assert.deepEqual(r.stripped, ['programs.guided.changed'], 'content of a delivered program does not change');
  r = run(s => { s.programs[1].status = 'active'; s.activeProgramId = own.id; });
  assert.deepEqual(r.stripped.sort(), ['programs.guided.activated', 'programs.guided.changed']);
  r = run(s => { s.programs.push({ ...structuredClone(delivered), id: 'copy-1', source: undefined, name: 'Mi copia' }); });
  assert.deepEqual([r.stripped, r.denied], [[], []], 'copying it as a personal program is free');
  r = run(s => { s.programs[0].status = 'active'; s.activeProgramId = delivered.id; }, false);
  assert.deepEqual(r.stripped.sort(), ['programs.guided.activated', 'programs.guided.changed'], 'switch off: exactly the previous behaviour');
});
