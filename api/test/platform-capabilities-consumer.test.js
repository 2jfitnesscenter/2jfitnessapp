import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CAPABILITIES_V2_MAX_TTL_MS,
  CAPABILITIES_V2_PATH_PREFIX,
  capabilitiesV2ConsumerEnabled,
  capabilitiesV2Schema,
  createCapabilitiesV2Consumer,
  signCapabilitiesV2Request,
} from '../platform-capabilities/consumer.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const schemaJson = JSON.parse(fs.readFileSync(path.join(root, 'contracts/platform-training-capabilities-v2.schema.json'), 'utf8'));
const matrix = JSON.parse(fs.readFileSync(path.join(root, 'contracts/platform-training-capabilities-v2.json'), 'utf8'));
const PERSON_ID = '22222222-2222-4222-8222-222222222222';
const OTHER_PERSON_ID = '33333333-3333-4333-8333-333333333333';
const TRAINING_ID = 'training-user-a';
const OTHER_TRAINING_ID = 'training-user-b';
const KEY_ID = 'bunker-v2-test';
const SECRET = Buffer.alloc(32, 0x31);
const ORIGIN = 'https://platform.example.test';
const START = Date.parse('2030-01-01T12:00:00.000Z');

function snapshot(overrides = {}) {
  return {
    contract: '2J-CAPABILITIES-V2',
    version: 2,
    personId: PERSON_ID,
    trainingSubject: { linkStatus: 'active', trainingUserId: TRAINING_ID },
    capabilityLevel: 'autonomous',
    accessState: 'active',
    capabilities: { ...matrix.profiles.active_autonomous_training_access },
    reasonCode: 'ACTIVE_AUTONOMOUS',
    suspensionStatus: 'none',
    effectiveFrom: '2030-01-01',
    generatedAt: new Date(START).toISOString(),
    expiresAt: new Date(START + 60_000).toISOString(),
    source: { platform: true },
    ...overrides,
  };
}

function consumer({ fetchImpl, clock = () => START, ...options } = {}) {
  return createCapabilitiesV2Consumer({
    enabled: true,
    platformOrigin: ORIGIN,
    keyId: KEY_ID,
    secret: SECRET,
    fetchImpl: fetchImpl ?? (async () => new Response(JSON.stringify(snapshot()), { status: 200, headers: { 'content-type': 'application/json' } })),
    now: clock,
    ...options,
  });
}

function assertSchemaParity() {
  assert.equal(schemaJson.additionalProperties, false);
  assert.deepEqual(Object.keys(capabilitiesV2Schema.shape).sort(), Object.keys(schemaJson.properties).sort());
  assert.deepEqual(Object.keys(capabilitiesV2Schema.shape.capabilities.shape).sort(), schemaJson.properties.capabilities.required.slice().sort());
}

test('consumer is inert by default and enable flag accepts only the documented truthy values', async () => {
  assert.equal(capabilitiesV2ConsumerEnabled(undefined), false);
  assert.equal(capabilitiesV2ConsumerEnabled('true'), true);
  assert.equal(capabilitiesV2ConsumerEnabled('1'), true);
  assert.equal(capabilitiesV2ConsumerEnabled('yes'), false);
  let calls = 0;
  const client = createCapabilitiesV2Consumer({ fetchImpl: async () => { calls++; } });
  assert.equal(client.enabled, false);
  assert.deepEqual(await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID }), { status: 'disabled' });
  assert.equal(calls, 0);
  const stringFalse = createCapabilitiesV2Consumer({ enabled: 'false', fetchImpl: async () => { calls++; } });
  assert.equal((await stringFalse.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'disabled');
  assert.equal(calls, 0);
});

test('consumer schema has exact V2 key parity and rejects unknown root or capability fields', () => {
  assertSchemaParity();
  assert.equal(capabilitiesV2Schema.safeParse(snapshot()).success, true);
  assert.equal(capabilitiesV2Schema.safeParse({ ...snapshot(), issuer: '2j-platform' }).success, false, 'V2 does not define issuer or audience payload claims');
  assert.equal(capabilitiesV2Schema.safeParse({ ...snapshot(), capabilities: { ...snapshot().capabilities, surprise: true } }).success, false);
});

test('valid autonomous snapshot is bound to exact person and Training identity and uses canonical HMAC request', async () => {
  let seen;
  const client = consumer({ fetchImpl: async (url, init) => {
    seen = { url: new URL(url), init };
    return new Response(JSON.stringify(snapshot()), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  const result = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  const requestPath = `${CAPABILITIES_V2_PATH_PREFIX}${PERSON_ID}/training-capabilities`;
  assert.equal(result.status, 'available');
  assert.equal(result.snapshot.personId, PERSON_ID);
  assert.equal(result.snapshot.trainingSubject.trainingUserId, TRAINING_ID);
  assert.equal(Object.isFrozen(result.snapshot), true);
  assert.equal(Object.isFrozen(result.snapshot.capabilities), true);
  assert.equal(result.source, 'platform');
  assert.equal(seen.url.origin, ORIGIN);
  assert.equal(seen.url.pathname, requestPath);
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.headers.accept, 'application/json');
  assert.match(seen.init.headers['x-2j-request-id'], /^[0-9a-f-]{36}$/i);
  const expectedCanonical = [
    '2J-SERVICE-AUTH-V1', KEY_ID, seen.init.headers['x-2j-timestamp'], seen.init.headers['x-2j-request-id'],
    'GET', requestPath, crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex'),
  ].join('\n');
  const expectedSignature = crypto.createHmac('sha256', SECRET).update(expectedCanonical).digest('base64url');
  assert.equal(seen.init.headers['x-2j-signature'], expectedSignature);
});

test('server rejects a wrong request signature and consumer does not accept an unauthenticated response', async () => {
  let requestId;
  const client = consumer({ secret: Buffer.alloc(32, 0x32), fetchImpl: async (url, init) => {
    requestId = init.headers['x-2j-request-id'];
    const path = new URL(url).pathname;
    const canonical = ['2J-SERVICE-AUTH-V1', KEY_ID, init.headers['x-2j-timestamp'], requestId, 'GET', path, crypto.createHash('sha256').update(Buffer.alloc(0)).digest('hex')].join('\n');
    const expected = crypto.createHmac('sha256', SECRET).update(canonical).digest('base64url');
    assert.notEqual(init.headers['x-2j-signature'], expected);
    return new Response(JSON.stringify({ error: 'service_auth_rejected' }), { status: 401 });
  } });
  assert.equal((await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'invalid');
  assert.match(requestId, /^[0-9a-f-]{36}$/i);
});

test('signer refuses paths outside the exact V2 audience endpoint', () => {
  const input = { keyId: KEY_ID, secret: SECRET, timestamp: new Date(START).toISOString(), requestId: crypto.randomUUID() };
  assert.throws(() => signCapabilitiesV2Request({ ...input, path: `${CAPABILITIES_V2_PATH_PREFIX}${PERSON_ID}/training-capabilities?x=1` }), /invalid_service_signing_request/);
  assert.throws(() => signCapabilitiesV2Request({ ...input, path: '/api/platform/v1/link-proofs/exchange' }), /invalid_service_signing_request/);
});

test('person or Training identity mismatch fails closed without caching', async () => {
  const client = consumer({ fetchImpl: async () => new Response(JSON.stringify(snapshot({ personId: OTHER_PERSON_ID })), { status: 200 }) });
  const personMismatch = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(personMismatch.status, 'invalid');
  assert.equal(personMismatch.reason, 'person_mismatch');
  assert.equal(client.cacheSize(), 0);

  const otherClient = consumer({ fetchImpl: async () => new Response(JSON.stringify(snapshot({ trainingSubject: { linkStatus: 'active', trainingUserId: OTHER_TRAINING_ID } })), { status: 200 }) });
  const trainingMismatch = await otherClient.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(trainingMismatch.reason, 'training_identity_mismatch');
  assert.equal(otherClient.cacheSize(), 0);
});

test('expired and future snapshots are rejected even when their schema is valid', async () => {
  for (const value of [
    snapshot({ expiresAt: new Date(START).toISOString() }),
    snapshot({ generatedAt: new Date(START + 1).toISOString(), expiresAt: new Date(START + 60_000).toISOString() }),
  ]) {
    const client = consumer({ fetchImpl: async () => new Response(JSON.stringify(value), { status: 200 }) });
    const result = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
    assert.equal(result.status, 'invalid');
    assert.equal(result.reason, 'snapshot_expired_or_future');
    assert.equal(client.cacheSize(), 0);
  }
});

test('snapshot TTL cannot exceed 60 seconds', async () => {
  assert.equal(CAPABILITIES_V2_MAX_TTL_MS, 60_000);
  const client = consumer({ fetchImpl: async () => new Response(JSON.stringify(snapshot({ expiresAt: new Date(START + 60_001).toISOString() })), { status: 200 }) });
  const result = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(result.status, 'invalid');
  assert.equal(result.reason, 'snapshot_ttl_exceeded');
});

test('missing and revoked links are explicit states, do not become baseline, and clear prior active cache', async () => {
  let current = START;
  const responses = [
    snapshot({ expiresAt: new Date(START + 10_000).toISOString() }),
    snapshot({ trainingSubject: { linkStatus: 'revoked' }, capabilityLevel: 'blocked', accessState: 'active', capabilities: { ...matrix.profiles.missing_or_revoked_link }, reasonCode: 'TRAINING_LINK_REVOKED' }),
  ];
  let index = 0;
  const client = consumer({ clock: () => current, fetchImpl: async () => new Response(JSON.stringify(responses[index++]), { status: 200 }) });
  assert.equal((await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'available');
  assert.equal(client.cacheSize(), 1);
  current += 10_000;
  assert.equal((await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID, forceRefresh: true })).status, 'revoked');
  assert.equal(client.cacheSize(), 0);

  const unlinked = consumer({ fetchImpl: async () => new Response(JSON.stringify(snapshot({ trainingSubject: { linkStatus: 'not_linked' }, capabilityLevel: 'blocked', accessState: 'ended', capabilities: { ...matrix.profiles.missing_or_revoked_link }, reasonCode: 'TRAINING_LINK_MISSING', suspensionStatus: 'suspended' })), { status: 200 }) });
  assert.equal((await unlinked.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'not_linked');
});

test('administrative suspension is distinct from free baseline and retains both identity IDs', async () => {
  const suspended = snapshot({
    capabilityLevel: 'blocked', accessState: 'suspended',
    capabilities: { ...matrix.profiles.administratively_suspended },
    reasonCode: 'ADMIN_SUSPENDED', suspensionStatus: 'suspended',
  });
  const client = consumer({ fetchImpl: async () => new Response(JSON.stringify(suspended), { status: 200 }) });
  const result = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(result.status, 'suspended');
  assert.equal(result.snapshot.personId, PERSON_ID);
  assert.equal(result.snapshot.trainingSubject.trainingUserId, TRAINING_ID);
  assert.ok(Object.values(result.snapshot.capabilities).every(value => value === false));
});

test('free baseline and commercial rights retain Platform distinctions without converting membership absence to suspension', async () => {
  const baseline = snapshot({
    capabilityLevel: 'baseline', accessState: 'baseline',
    capabilities: { ...matrix.profiles.free_autonomous_baseline },
    reasonCode: 'FREE_BASELINE', effectiveFrom: null,
  });
  const baselineClient = consumer({ fetchImpl: async () => new Response(JSON.stringify(baseline), { status: 200 }) });
  const baselineResult = await baselineClient.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(baselineResult.status, 'baseline');
  assert.equal(baselineResult.snapshot.suspensionStatus, 'none');
  assert.equal(baselineResult.snapshot.capabilities.personalRoutineCreation, true);
  assert.equal(baselineResult.snapshot.capabilities.personalRoutineManagement, true);
  assert.equal(baselineResult.snapshot.capabilities.routineCreation, false);
  assert.equal(baselineResult.snapshot.capabilities.guidedTraining, false);
  assert.equal(baselineResult.snapshot.capabilities.aiCoach, false);

  const commercialClient = consumer({ fetchImpl: async () => new Response(JSON.stringify(snapshot()), { status: 200 }) });
  const commercial = await commercialClient.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(commercial.status, 'available');
  assert.equal(commercial.snapshot.capabilities.routineCreation, true);
  assert.equal(commercial.snapshot.capabilities.guidedTraining, true);
  assert.equal(commercial.snapshot.capabilities.personalRoutineCreation, true);
  assert.equal(commercial.snapshot.capabilities.aiCoach, false);
});

test('invalid snapshot and rejected auth responses never fall back to a previously cached snapshot', async () => {
  let calls = 0;
  const client = consumer({ fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify(snapshot()), { status: 200 });
    return new Response('{broken', { status: 200 });
  } });
  assert.equal((await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'available');
  client.clearCache();
  assert.equal((await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'invalid');
  assert.equal(client.cacheSize(), 0);
});

test('availability outage may use a snapshot only before expiresAt, never past it', async () => {
  let current = START;
  let calls = 0;
  const client = consumer({ clock: () => current, fetchImpl: async () => {
    calls++;
    if (calls === 1) return new Response(JSON.stringify(snapshot({ expiresAt: new Date(START + 10_000).toISOString() })), { status: 200 });
    return new Response('', { status: 503 });
  } });
  assert.equal((await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'available');
  current += 9_999;
  const stale = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID, forceRefresh: true });
  assert.equal(stale.status, 'available');
  assert.equal(stale.source, 'cache');
  assert.equal(stale.stale, true);
  current += 1;
  const expired = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID, forceRefresh: true });
  assert.equal(expired.status, 'unavailable');
  assert.equal(expired.snapshot, undefined);
});

test('single-flight prevents concurrent duplicate requests and each new request gets a fresh replay ID', async () => {
  const ids = [];
  let calls = 0;
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const client = consumer({ fetchImpl: async (_url, init) => {
    calls++;
    ids.push(init.headers['x-2j-request-id']);
    await wait;
    return new Response(JSON.stringify(snapshot()), { status: 200 });
  } });
  const pending = [
    client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID }),
    client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID }),
  ];
  release();
  const settled = await Promise.all(pending);
  assert.equal(calls, 1);
  assert.equal(settled[0].status, 'available');
  client.clearCache();
  await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(calls, 2);
  assert.notEqual(ids[0], ids[1]);
});

test('request timeout aborts fetch and returns an auditable bounded status', async () => {
  let signal;
  const client = consumer({ timeoutMs: 5, fetchImpl: (_url, init) => {
    signal = init.signal;
    return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
  } });
  const result = await client.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID });
  assert.equal(result.status, 'unavailable');
  assert.equal(result.reason, 'timeout');
  assert.equal(signal.aborted, true);
});

test('configured issuer origin must be HTTPS and redirects are not followed', async () => {
  const insecure = consumer({ platformOrigin: 'http://platform.example.test' });
  assert.equal((await insecure.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'configuration_invalid');
  const nested = consumer({ platformOrigin: 'https://platform.example.test/untrusted' });
  assert.equal((await nested.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'configuration_invalid');
  let redirectMode;
  const redirect = consumer({ fetchImpl: async (_url, init) => { redirectMode = init.redirect; throw new Error('redirect rejected'); } });
  assert.equal((await redirect.resolve({ personId: PERSON_ID, trainingUserId: TRAINING_ID })).status, 'unavailable');
  assert.equal(redirectMode, 'error');
});

