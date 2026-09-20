import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempData, writeState } from './helpers.mjs';

tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');
const { readState } = await import('../lib/state-store.js');

/* Same factory-of-closures exercise pattern as bunker-finish.test.js — no real HTTP server, a
   minimal sign/verifySig pair for the bunker-token half (GET /session, used here only to prove
   the kiosk can pick up a handed-off session through its own existing endpoint), and a
   swappable readSession for the cookie-authenticated handoff endpoint itself. */
const SECRET = 'bunker-handoff-test-secret';
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

let currentUser = null; // swapped per test to simulate different/absent cookie sessions
const routes = bunkerRoutes({
  json: (res, status, body) => { res.status = status; res.body = body; },
  readBody: async req => req._body,
  readSession: () => currentUser,
  sign, verifySig,
  users: () => [],
  isTrainer: () => false,
});
const handoff = routes['POST /api/bunker/handoff'];
const getSession = routes['GET /api/bunker/session'];

async function callHandoff(user, active, force) {
  currentUser = user;
  const req = { headers: {}, _body: { active, force } };
  const res = {};
  await handoff(req, res);
  return res;
}
async function callGetSession(uid) {
  const req = { headers: { authorization: 'Bearer ' + bunkerToken(uid) } };
  const res = {};
  await getSession(req, res);
  return res;
}

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, active: null,
  ...over,
});
const sampleActive = (id, over = {}) => ({
  id, d: '2026-09-20', start: 1000, routineId: 'r1', name: 'Full body', bw: 78.2, cur: 0,
  entries: [{ id: '0025', target: { sets: 3, reps: 8, weight: 60, mode: 'reps' }, plan: { policy: 'linear', kind: 'first' },
    sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }, { w: 60, r: 8, done: false }] }],
  ...over,
});

test('unauthenticated request is rejected before touching any state', async () => {
  const res = await callHandoff(null, sampleActive('a1'));
  assert.equal(res.status, 401);
});

test('a correct handoff writes S.active exactly, with nothing else disturbed', async () => {
  const uid = 'u_handoff_ok';
  writeState(process.env.DATA_DIR, uid, baseState());
  const active = sampleActive('sess-1');
  const res = await callHandoff({ id: uid }, active);
  assert.equal(res.status, 200);
  assert.deepEqual(readState(uid).active, active, 'S.active must match the phone\'s session field for field');
  assert.equal(readState(uid).workouts.length, 0, 'a handoff never touches S.workouts');
});

test('idempotent by active.id: resending the same session overwrites with the latest copy, never duplicates', async () => {
  const uid = 'u_handoff_idempotent';
  writeState(process.env.DATA_DIR, uid, baseState());
  const first = sampleActive('sess-2');
  await callHandoff({ id: uid }, first);

  // A retry of the SAME session, now with one more set logged locally in between attempts.
  const second = sampleActive('sess-2', { entries: [{ ...first.entries[0], sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }] }] });
  const res2 = await callHandoff({ id: uid }, second);
  assert.equal(res2.status, 200);
  const S = readState(uid);
  assert.deepEqual(S.active, second, 'the later resend wins, still the same logical session');
  assert.equal(S.workouts.length, 0, 'still no workout ever created by a handoff, let alone duplicated');
});

test('a genuinely different active on the server is never silently overwritten — 409 until force:true', async () => {
  const uid = 'u_handoff_conflict';
  const existing = sampleActive('sess-kiosk', { name: 'Ya empezado en el Bunker' });
  writeState(process.env.DATA_DIR, uid, baseState({ active: existing }));

  const fromPhone = sampleActive('sess-phone');
  const blocked = await callHandoff({ id: uid }, fromPhone);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.existing.id, 'sess-kiosk');
  assert.deepEqual(readState(uid).active, existing, 'the kiosk session must survive an un-forced conflicting handoff untouched');

  const forced = await callHandoff({ id: uid }, fromPhone, true);
  assert.equal(forced.status, 200);
  assert.deepEqual(readState(uid).active, fromPhone, 'force:true lets the member deliberately replace it');
});

test('malformed active is rejected with 400, not written', async () => {
  const uid = 'u_handoff_bad';
  writeState(process.env.DATA_DIR, uid, baseState());
  const res = await callHandoff({ id: uid }, { name: 'no id, no entries' });
  assert.equal(res.status, 400);
  assert.equal(readState(uid).active, null);
});

test('the Bunker kiosk can immediately recover a handed-off session through its own existing endpoint', async () => {
  const uid = 'u_handoff_to_kiosk';
  writeState(process.env.DATA_DIR, uid, baseState());
  const active = sampleActive('sess-visible-at-kiosk');
  await callHandoff({ id: uid }, active);

  const session = await callGetSession(uid);
  assert.equal(session.status, 200);
  assert.deepEqual(session.body.active, active, 'GET /api/bunker/session must hand back exactly what the phone transferred');
});

test('multiuser isolation: two handoffs in parallel never cross uids', async () => {
  const uidA = 'u_handoff_multi_a', uidB = 'u_handoff_multi_b';
  writeState(process.env.DATA_DIR, uidA, baseState());
  writeState(process.env.DATA_DIR, uidB, baseState());
  const activeA = sampleActive('sess-a', { name: 'Sesion de A', entries: [{ id: '0025', target: {}, plan: {}, sets: [{ w: 111, r: 1, done: true }] }] });
  const activeB = sampleActive('sess-b', { name: 'Sesion de B', entries: [{ id: '0007', target: {}, plan: {}, sets: [{ w: 222, r: 1, done: true }] }] });

  await Promise.all([
    callHandoff({ id: uidA }, activeA),
    callHandoff({ id: uidB }, activeB),
  ]);

  const SA = readState(uidA), SB = readState(uidB);
  assert.deepEqual(SA.active, activeA);
  assert.deepEqual(SB.active, activeB);
  const rawA = JSON.stringify(SA), rawB = JSON.stringify(SB);
  assert.ok(!rawA.includes('sess-b') && !rawA.includes('"0007"') && !rawA.includes('222'));
  assert.ok(!rawB.includes('sess-a') && !rawB.includes('"0025"') && !rawB.includes('111'));
});
