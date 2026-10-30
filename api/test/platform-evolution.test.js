import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { tempData, writeState } from './helpers.mjs';

const DATA = tempData();
const { createPlatformProofRoutes } = await import('../platform-proof/routes.js');
const { createPlatformProofStore } = await import('../platform-proof/store.js');
const { parseServiceAuthKeys, signPlatformServiceRequest, SERVICE_TRAINING_EVOLUTION_PATH } = await import('../platform-proof/service-auth.js');
const KEY_ID = 'synthetic-platform';
const SECRET = Buffer.alloc(32, 0x51);
const keys = parseServiceAuthKeys(JSON.stringify({ [KEY_ID]: SECRET.toString('base64url') }));
const PERSON = '12345678-1234-4234-8234-123456789012';
const UID = 'synthetic-training-user';
const now = () => Date.parse('2026-10-30T10:00:00.000Z');

const authorization = (overrides = {}) => ({
  permission: 'training.read', permissionGranted: true,
  capability: 'workoutHistory', capabilityGranted: true, accessState: 'entitled',
  checkedAt: new Date(now()).toISOString(),
  consent: { purpose: 'home_evolution', status: 'granted', version: 1, checkedAt: new Date(now()).toISOString() },
  ...overrides,
});
const requestBody = (overrides = {}) => ({ v: 1, personId: PERSON, trainingUserId: UID, authorization: authorization(), cursor: null, limit: 2, ...overrides });
const user = (overrides = {}) => ({ id: UID, personId: PERSON, disabled: false, platformLink: { state: 'active', personId: PERSON }, ...overrides });
const state = () => ({
  unit: 'kg',
  bodyweight: [{ d: '2026-10-01', w: 80 }],
  measurements: { waist: [{ d: '2026-10-02', v: 90 }] },
  workouts: [{ id: 'synthetic-workout-id', d: '2026-10-03', name: 'PRIVATE_WORKOUT_NAME', privateNotes: 'PRIVATE_NOTE', entries: [{ id: 'squat-id', name: 'PRIVATE_EXERCISE_NAME', sets: [{ w: 70, r: 8, rpe: 7, done: true, note: 'PRIVATE_SET_NOTE' }] }] }],
  health: { private: 'PRIVATE_HEALTH' }, coach: { notes: 'PRIVATE_COACH_NOTE' },
});

function fixture({ enabled = true, initialState = state(), users = [user()], fingerprint = 'state-1' } = {}) {
  let current = initialState;
  const dataDir = tempData();
  const store = createPlatformProofStore({ dataDir, now });
  const routes = createPlatformProofRoutes({
    json: (res, status, body) => { res.statusCode = status; res.body = body; return res; },
    readSession: () => null, store, users: () => users,
    readState: () => current, stateFingerprint: () => fingerprint,
    trainingEvolutionEnabled: enabled, serviceKeys: keys, now,
  });
  return { routes, store, users, setState(value) { current = value; } };
}

async function call(f, body = requestBody(), { requestId = randomUUID(), alter = {}, signed = true } = {}) {
  const raw = Buffer.from(JSON.stringify(body));
  const timestamp = new Date(now()).toISOString();
  const signature = signed ? signPlatformServiceRequest({ keyId: KEY_ID, secret: SECRET, timestamp, requestId, method: 'POST', path: SERVICE_TRAINING_EVOLUTION_PATH, body: raw }).signature : null;
  const req = Readable.from([raw]);
  req.method = 'POST'; req.url = SERVICE_TRAINING_EVOLUTION_PATH;
  req.headers = { 'content-type': 'application/json', ...(signature ? { 'x-2j-key-id': KEY_ID, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature } : {}), ...alter };
  const res = { headers: {}, setHeader(name, value) { this.headers[name.toLowerCase()] = value; } };
  await f.routes[`POST ${SERVICE_TRAINING_EVOLUTION_PATH}`](req, res);
  return res;
}

test('evolution route is disabled by default and never accepts browser-only credentials', async () => {
  const f = fixture({ enabled: false });
  const result = await call(f);
  assert.equal(result.statusCode, 423);
  assert.equal(result.body.error, 'training_evolution_disabled');
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('an enabled evolution route rejects browser cookies and unsigned callers', async () => {
  const f = fixture();
  const result = await call(f, requestBody(), { signed: false, alter: { cookie: 'gymsid=synthetic-session' } });
  assert.equal(result.statusCode, 401);
});

test('signed Platform request exports only finalized workout history in the canonical response envelope', async () => {
  const f = fixture();
  const result = await call(f, requestBody({ limit: 100 }));
  assert.equal(result.statusCode, 200);
  assert.equal(result.body.schema, '2j-home-evolution-export/v1');
  assert.equal(result.body.source, 'bunker');
  assert.equal(result.body.personId, PERSON);
  assert.equal(result.body.trainingUserId, UID);
  assert.deepEqual(result.body.workouts, [{ date: '2026-10-03', exercises: [{ exerciseId: 'squat-id', sets: [{ reps: 8, rpe: 7, weight: { value: 70, unit: 'kg' }, completed: true }] }] }]);
  assert.deepEqual(Object.keys(result.body).sort(), ['exportedAt', 'nextCursor', 'personId', 'schema', 'snapshotId', 'source', 'trainingUserId', 'workouts'].sort());
  const output = JSON.stringify(result.body);
  for (const privateValue of ['PRIVATE_WORKOUT_NAME', 'PRIVATE_NOTE', 'PRIVATE_EXERCISE_NAME', 'PRIVATE_SET_NOTE', 'PRIVATE_HEALTH', 'PRIVATE_COACH_NOTE', 'synthetic-workout-id', 'bodyweight', 'measurements', 'waist']) assert.equal(output.includes(privateValue), false);
  assert.equal(result.headers['cache-control'], 'no-store');
  assert.deepEqual(f.store.auditEvents().map(event => [event.event, event.purpose]), [['platform_training_evolution.request_accepted', 'home_evolution']]);
  assert.equal(JSON.stringify(f.store.auditEvents()).includes(PERSON), false);
});

test('bodyweight and measurements remain in source state but are never exported', async () => {
  const lb = state(); lb.unit = 'lb'; lb.bodyweight = [{ d: '2026-10-01', w: 176 }];
  const result = await call(fixture({ initialState: lb }), requestBody({ limit: 100 }));
  assert.equal(result.statusCode, 200);
  assert.equal(Object.hasOwn(result.body, 'measurements'), false);
  assert.equal(Object.hasOwn(result.body, 'bodyweight'), false);
  assert.deepEqual(lb.bodyweight, [{ d: '2026-10-01', w: 176 }]);
  assert.deepEqual(lb.measurements, { waist: [{ d: '2026-10-02', v: 90 }] });
});

test('permission, workout-history capability and current purpose consent are mandatory in the signed decision', async () => {
  const bad = [
    authorization({ accessState: 'baseline' }),
    authorization({ permissionGranted: false }),
    authorization({ permission: 'admin' }),
    authorization({ capabilityGranted: false }),
    authorization({ capability: 'premiumPrograms' }),
    authorization({ consent: { purpose: 'coach', status: 'granted', version: 1, checkedAt: new Date(now()).toISOString() } }),
    authorization({ consent: { purpose: 'home_evolution', status: 'revoked', version: 1, checkedAt: new Date(now()).toISOString() } }),
    authorization({ checkedAt: '2026-10-30T09:00:00.000Z' }),
    authorization({ consent: { purpose: 'home_evolution', status: 'granted', version: 1, checkedAt: '2026-10-30T09:00:00.000Z' } }),
  ];
  for (const decision of bad) {
    const result = await call(fixture(), requestBody({ authorization: decision }));
    assert.ok([400, 403].includes(result.statusCode));
    assert.notEqual(result.statusCode, 200);
  }
});

test('link identity must be active, unique, and unsuspended; account data stays unchanged', async () => {
  const inactive = await call(fixture({ users: [user({ platformLink: { state: 'revoked', personId: PERSON } })] }));
  assert.equal(inactive.statusCode, 403);
  const wrongIdentity = await call(fixture(), requestBody({ personId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }));
  assert.equal(wrongIdentity.statusCode, 403);
  const duplicate = await call(fixture({ users: [user(), user({ id: 'other-uid' })] }));
  assert.equal(duplicate.statusCode, 403);
  const inconsistentDuplicate = await call(fixture({ users: [user(), { id: 'legacy-other-uid', disabled: false, platformLink: { state: 'active', personId: PERSON } }] }));
  assert.equal(inconsistentDuplicate.statusCode, 403, 'a conflicting active link is rejected even when legacy top-level personId is missing');
  const suspended = await call(fixture({ users: [user({ platformRestriction: { reasonCode: 'ADMIN_SUSPENDED' } })] }));
  assert.equal(suspended.statusCode, 403);
  const before = state();
  const f = fixture({ initialState: before });
  await call(f);
  assert.deepEqual(before, state(), 'export must not mutate or delete source state');
});

test('pagination uses one stable snapshot and rejects a cursor after source changes', async () => {
  const source = state();
  source.workouts.push({ id: 'synthetic-workout-2', d: '2026-10-04', entries: [{ id: 'press-id', sets: [{ w: 40, r: 5 }] }] }, { id: 'synthetic-workout-3', d: '2026-10-05', entries: [] });
  const f = fixture({ initialState: source });
  const first = await call(f);
  assert.equal(first.statusCode, 200);
  assert.ok(first.body.nextCursor);
  const second = await call(f, requestBody({ cursor: first.body.nextCursor }));
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.snapshotId, first.body.snapshotId);
  const changed = state(); changed.workouts.push({ id: 'new-workout', d: '2026-10-06', entries: [] });
  f.setState(changed);
  const stale = await call(f, requestBody({ cursor: first.body.nextCursor }));
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.error, 'training_evolution_snapshot_changed');
});

test('malformed source records fail closed and replayed signed requests are rejected', async () => {
  const malformed = state(); malformed.workouts[0].d = '2026-02-31';
  assert.equal((await call(fixture({ initialState: malformed }))).statusCode, 503);
  const f = fixture();
  const id = randomUUID();
  assert.equal((await call(f, requestBody(), { requestId: id })).statusCode, 200);
  const replay = await call(f, requestBody(), { requestId: id });
  assert.equal(replay.statusCode, 409);
  assert.equal(replay.body.error, 'service_request_replayed');
});
