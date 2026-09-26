import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempData, writeState } from './helpers.mjs';

tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');

/* v1.3.1 — A3 fix. A cryptographically valid Bunker token used to be enough for the rest of its
 * own TTL even if the account it names got disabled (member token) or demoted from trainer
 * (admin token) the very next second. readBunkerToken/readAdminToken now revalidate the account
 * on every single use — this file drives that directly against a MUTABLE roster (the account
 * flips mid-test), unlike the other bunker test files' permissive "any uid is fine" stub. Same
 * in-process factory pattern as bunker-finish.test.js/bunker-handoff.test.js. */
const SECRET = 'bunker-revocation-test-secret';
function sign(payload) {
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try { if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null; } catch { return null; }
  return payload;
}
const bunkerToken = uid => sign('bunker:' + uid + ':' + (Date.now() + 3600000));
const adminToken = uid => sign('bunker-admin:' + uid + ':' + (Date.now() + 1800000));

// A live, mutable roster — tests flip `disabled`/`trainer` on an existing entry mid-test to
// prove the token's own authority is revalidated, not just checked once at mint time.
const ROSTER = [
  { id: 'u_alice', name: 'Alice' },
  { id: 'u_bob', name: 'Bob' },
  { id: 'trainer_carol', name: 'Carol', trainer: true },
];
const users = () => ROSTER;
const isTrainer = u => !!u && u.trainer === true;

const routes = bunkerRoutes({
  json: (res, status, body) => { res.status = status; res.body = body; },
  readBody: async req => req._body,
  readSession: () => null,
  sign, verifySig,
  users, isTrainer,
});
const getSession = routes['GET /api/bunker/session'];
const adminSessions = routes['GET /api/bunker/admin/sessions'];

async function callGetSession(token) {
  const req = { headers: { authorization: 'Bearer ' + token } };
  const res = {};
  await getSession(req, res);
  return res;
}
async function callAdminSessions(token) {
  const req = { headers: { authorization: 'Bearer ' + token } };
  const res = {};
  await adminSessions(req, res);
  return res;
}

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, active: null, ...over,
});

test('a normal, active member token keeps working (baseline)', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  const res = await callGetSession(bunkerToken('u_alice'));
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Alice');
});

test('token -> disable user -> token stops working immediately, before its own TTL expires', async () => {
  writeState(process.env.DATA_DIR, 'u_bob', baseState());
  const token = bunkerToken('u_bob');
  const before = await callGetSession(token);
  assert.equal(before.status, 200, 'works while the account is active');

  const bob = ROSTER.find(u => u.id === 'u_bob');
  bob.disabled = true;
  try {
    const after = await callGetSession(token);
    assert.equal(after.status, 401, 'the SAME still-unexpired token must now be refused');
  } finally {
    delete bob.disabled; // don't leak into later tests
  }
});

test('admin token -> retire trainer status -> admin token stops working immediately', async () => {
  const token = adminToken('trainer_carol');
  const before = await callAdminSessions(token);
  assert.equal(before.status, 200, 'works while the account is still a trainer');

  const carol = ROSTER.find(u => u.id === 'trainer_carol');
  carol.trainer = false;
  try {
    const after = await callAdminSessions(token);
    assert.equal(after.status, 401, 'the SAME still-unexpired admin token must now be refused');
  } finally {
    carol.trainer = true; // restore
  }
});

test('an unknown uid (deleted account) is refused the same way a disabled one is', async () => {
  const token = bunkerToken('u_never_existed');
  const res = await callGetSession(token);
  assert.equal(res.status, 401);
});

test('disabling one member never affects another member\'s own token (A/B isolation preserved)', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  writeState(process.env.DATA_DIR, 'u_bob', baseState());
  const bob = ROSTER.find(u => u.id === 'u_bob');
  bob.disabled = true;
  try {
    const aliceStillWorks = await callGetSession(bunkerToken('u_alice'));
    assert.equal(aliceStillWorks.status, 200);
    assert.equal(aliceStillWorks.body.name, 'Alice');
    const bobRefused = await callGetSession(bunkerToken('u_bob'));
    assert.equal(bobRefused.status, 401);
  } finally {
    delete bob.disabled;
  }
});

test('a member token can never authenticate as the admin route, disabled or not — role check is independent of the disabled check', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  // Alice is a normal, ACTIVE member — but her own (member-kind) token must still never pass
  // as an admin token, since readAdminToken only ever accepts a 'bunker-admin'-kind payload.
  const res = await callAdminSessions(bunkerToken('u_alice'));
  assert.equal(res.status, 401);
});

test.after(() => {});
