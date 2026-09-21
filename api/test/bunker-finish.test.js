import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempData, writeState } from './helpers.mjs';

tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');

/* bunkerRoutes is a factory of closures — server.js's own json/readBody/readSession/sign/
   verifySig are passed in rather than imported (see the module's own doc comment), precisely
   so it can be exercised directly like this: no real HTTP server, no real session secret, just
   a minimal sign/verifySig pair matching the same "HMAC'd payload + '.' + mac" contract
   readBunkerToken expects. */
const SECRET = 'bunker-finish-test-secret';
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

// v1.3.1 (A3 fix) — readBunkerToken now revalidates the account on every use, so this stub
// answers "yes, real and active" for whatever uid it's asked about — these tests are about
// finish's own logic, not A3's disabled/demoted-account checks (see bunker-revocation.test.js
// for those).
const users = () => ({ find: () => ({ disabled: false }) });
const routes = bunkerRoutes({
  json: (res, status, body) => { res.status = status; res.body = body; },
  readBody: async req => req._body,
  readSession: () => null,
  sign, verifySig,
  users,
  isTrainer: () => false,
});
const finish = routes['POST /api/bunker/finish'];
const postActive = routes['POST /api/bunker/active'];

async function callFinish(uid, workout) {
  const req = { headers: { authorization: 'Bearer ' + bunkerToken(uid) }, _body: { workout } };
  const res = {};
  await finish(req, res);
  return res;
}

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, active: { id: 'should-be-cleared' },
  ...over,
});

test('Sync V2: Bunker finish increments revision, stale mobile conflicts and retry does not duplicate', async () => {
  const uid = 'v2_finish';
  writeState(process.env.DATA_DIR, uid, baseState({ workouts: [] }));
  const { openSync, mutate } = await import('../lib/sync.js');
  const before = openSync(uid);
  const workout = { id: 'v2-workout', d: '2026-09-21', start: 1, end: 2, entries: [] };
  assert.equal((await callFinish(uid, workout)).status, 200);
  assert.equal((await callFinish(uid, workout)).status, 200);
  assert.throws(() => mutate(uid, { operationId: 'stale-mobile', type: 'save', revision: before.meta.revision, generation: before.meta.generation, state: before.state }), { code: 'SYNC_CONFLICT' });
  const after = openSync(uid);
  assert.equal(after.state.workouts.length, 1);
  assert.equal(after.meta.revision, before.meta.revision + 1);
});

test('a weight PR is detected and written to workout.prs, exactly as the normal finish flow would', async () => {
  const uid = 'u_pr_weight';
  writeState(process.env.DATA_DIR, uid, baseState({
    workouts: [{ id: 'w0', d: '2026-09-01', entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }], target: { sets: 1, reps: 5, weight: 60 } }] }],
  }));
  const workout = {
    id: 'w1', d: '2026-09-19', start: 1000, end: 2000, routineId: 'r1', name: 'Bunker', bw: null,
    entries: [{ id: '0025', sets: [{ w: 70, r: 5, done: true }], target: { sets: 1, reps: 5, weight: 70 } }],
    prs: [], // whatever the client sends here must be ignored and re-derived server-side
  };
  const res = await callFinish(uid, workout);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.prs, ['0025']);

  const { readState } = await import('../lib/state-store.js');
  const S = readState(uid);
  assert.deepEqual(S.workouts.find(w => w.id === 'w1').prs, ['0025'], 'the weight PR must be persisted on the saved workout');
});

test('a 1RM record with no new top weight still surfaces as an e1RM record, same as is1RMRecord', async () => {
  const uid = 'u_pr_1rm';
  // Prior best: a single heavy rep at 80kg -> est. 1RM exactly 80.
  writeState(process.env.DATA_DIR, uid, baseState({
    workouts: [{ id: 'w0', d: '2026-09-01', entries: [{ id: '0025', sets: [{ w: 80, r: 1, done: true }], target: { sets: 1, reps: 1, weight: 80 } }] }],
  }));
  // 75kg x5 (Epley est. ~87.5) beats the prior 1RM estimate without beating the raw 80kg weight
  // PR -- exactly the case that distinguishes e1RM records from weight PRs.
  const workout = {
    id: 'w1', d: '2026-09-19', start: 1000, end: 2000, routineId: 'r1', name: 'Bunker', bw: null,
    entries: [{ id: '0025', sets: [{ w: 75, r: 5, done: true }], target: { sets: 1, reps: 5, weight: 75 } }],
    prs: [],
  };
  const res = await callFinish(uid, workout);
  assert.deepEqual(res.body.prs, [], 'not a raw weight PR — 75 < 80');
  assert.equal(res.body.e1prs.length, 1, 'the rule itself must still fire — checked via the response, the one place the normal flow ever surfaces it');
  assert.equal(res.body.e1prs[0].id, '0025');
  assert.ok(res.body.e1prs[0].est > 80, 'the new estimate must beat the prior 80');
  assert.equal(res.body.e1prs[0].prev, 80);

  // doFinishWorkout itself never writes e1prs onto a saved workout (it only ever reaches the
  // finish-summary sheet, in that same render) — Bunker must not introduce persistence the
  // normal flow doesn't have, even though the rule that PRODUCES the value is identical.
  const { readState } = await import('../lib/state-store.js');
  assert.equal(readState(uid).workouts.find(w => w.id === 'w1').e1prs, undefined, 'e1prs must never be persisted on the saved workout');
});

test('a session with nothing that beats history produces no PRs at all', async () => {
  const uid = 'u_no_pr';
  writeState(process.env.DATA_DIR, uid, baseState({
    workouts: [{ id: 'w0', d: '2026-09-01', entries: [{ id: '0025', sets: [{ w: 100, r: 5, done: true }], target: { sets: 1, reps: 5, weight: 100 } }] }],
  }));
  const workout = {
    id: 'w1', d: '2026-09-19', start: 1000, end: 2000, routineId: 'r1', name: 'Bunker', bw: null,
    entries: [{ id: '0025', sets: [{ w: 90, r: 5, done: true }], target: { sets: 1, reps: 5, weight: 90 } }],
  };
  const res = await callFinish(uid, workout);
  assert.deepEqual(res.body.prs, []);
  assert.deepEqual(res.body.e1prs, []);
});

test('exWeights is raised when the new weight beats it, and left alone when it does not', async () => {
  const uidUp = 'u_exw_up', uidSame = 'u_exw_same';
  writeState(process.env.DATA_DIR, uidUp, baseState({ exWeights: { '0025': { w: 50, d: '2026-08-01' } } }));
  writeState(process.env.DATA_DIR, uidSame, baseState({ exWeights: { '0025': { w: 90, d: '2026-08-01' } } }));

  await callFinish(uidUp, { id: 'w1', d: '2026-09-19', start: 1, end: 2, routineId: 'r1', name: 'x', bw: null,
    entries: [{ id: '0025', sets: [{ w: 55, r: 5, done: true }], target: {} }] });
  await callFinish(uidSame, { id: 'w1', d: '2026-09-19', start: 1, end: 2, routineId: 'r1', name: 'x', bw: null,
    entries: [{ id: '0025', sets: [{ w: 55, r: 5, done: true }], target: {} }] });

  const { readState } = await import('../lib/state-store.js');
  assert.deepEqual(readState(uidUp).exWeights['0025'], { w: 55, d: '2026-09-19' }, 'a heavier confirmed weight replaces the old one, with the new date');
  assert.deepEqual(readState(uidSame).exWeights['0025'], { w: 90, d: '2026-08-01' }, 'a lighter session never overwrites a heavier one already on file');
});

test('integrity: S.active clears, no duplicate workouts, target/sets/cardio/date/id all survive intact', async () => {
  const uid = 'u_integrity';
  writeState(process.env.DATA_DIR, uid, baseState({ workouts: [] }));
  const workout = {
    id: 'w-integrity-1', d: '2026-09-19', start: 111, end: 222, routineId: 'rX', name: 'Full body', bw: 78.4,
    entries: [
      { id: '0025', sets: [{ w: 60, r: 8, done: true }, { w: 60, r: 8, done: false }], target: { sets: 2, reps: 8, weight: 60, mode: 'reps' } },
      { id: '3220', sets: [{ min: 16, speed: 9.5, done: true }], target: { sets: 1, mode: 'cardio', min: 15, speed: 9 } },
    ],
  };
  await callFinish(uid, structuredClone(workout));

  const { readState } = await import('../lib/state-store.js');
  const S = readState(uid);
  assert.equal(S.active, null);
  assert.equal(S.workouts.length, 1, 'exactly one workout, no duplicates');
  const w = S.workouts[0];
  assert.equal(w.id, workout.id);
  assert.equal(w.d, workout.d);
  assert.deepEqual(w.entries[0].target, workout.entries[0].target);
  assert.deepEqual(w.entries[0].sets, workout.entries[0].sets);
  assert.deepEqual(w.entries[1].sets, [{ min: 16, speed: 9.5, done: true }]);
  assert.equal(w.entries[1].target.mode, 'cardio');
});

test('multiuser isolation: finishing for two users concurrently never mixes their PRs, exWeights or workouts', async () => {
  const uidA = 'u_multi_a', uidB = 'u_multi_b';
  writeState(process.env.DATA_DIR, uidA, baseState({
    workouts: [{ id: 'w0', d: '2026-09-01', entries: [{ id: '0025', sets: [{ w: 40, r: 8, done: true }], target: {} }] }],
    exWeights: { '0025': { w: 40, d: '2026-09-01' } },
  }));
  writeState(process.env.DATA_DIR, uidB, baseState({
    workouts: [{ id: 'w0', d: '2026-09-01', entries: [{ id: '0007', sets: [{ w: 30, r: 8, done: true }], target: {} }] }],
    exWeights: { '0007': { w: 30, d: '2026-09-01' } },
  }));

  await Promise.all([
    callFinish(uidA, { id: 'wA', d: '2026-09-19', start: 1, end: 2, routineId: 'rA', name: 'A', bw: null,
      entries: [{ id: '0025', sets: [{ w: 45, r: 8, done: true }], target: {} }] }),
    callFinish(uidB, { id: 'wB', d: '2026-09-19', start: 1, end: 2, routineId: 'rB', name: 'B', bw: null,
      entries: [{ id: '0007', sets: [{ w: 35, r: 8, done: true }], target: {} }] }),
  ]);

  const { readState } = await import('../lib/state-store.js');
  const SA = readState(uidA), SB = readState(uidB);
  assert.equal(SA.workouts.length, 2);
  assert.equal(SB.workouts.length, 2);
  assert.deepEqual(SA.workouts.find(w => w.id === 'wA').prs, ['0025']);
  assert.deepEqual(SB.workouts.find(w => w.id === 'wB').prs, ['0007']);
  assert.equal(SA.exWeights['0025'].w, 45);
  assert.equal(SB.exWeights['0007'].w, 35);
  // No cross-contamination: A's file never mentions B's exercise/routine, and vice versa.
  const rawA = JSON.stringify(SA), rawB = JSON.stringify(SB);
  assert.ok(!rawA.includes('0007') && !rawA.includes('"rB"'));
  assert.ok(!rawB.includes('0025') && !rawB.includes('"rA"'));
});

/* ------------------------------------------------------------------------------------------
 * v1.3.1 — A4 fix: finish is now idempotent by workout id, and a write to S.active for an id
 * that has already been finished is refused instead of resurrecting it.
 * ------------------------------------------------------------------------------------------ */

async function callPostActive(uid, active, extra = {}) {
  const req = { headers: { authorization: 'Bearer ' + bunkerToken(uid) }, _body: { active, ...extra } };
  const res = {};
  await postActive(req, res);
  return res;
}

test('A4a) finishing the exact same workout twice never produces a second one', async () => {
  const uid = 'u_double_finish';
  writeState(process.env.DATA_DIR, uid, baseState({ workouts: [] }));
  const workout = { id: 'w-double', d: '2026-09-21', start: 1, end: 2, routineId: null, name: 'x', bw: null,
    entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }], target: {} }] };

  const first = await callFinish(uid, structuredClone(workout));
  const second = await callFinish(uid, structuredClone(workout));
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);

  const { readState } = await import('../lib/state-store.js');
  const S = readState(uid);
  assert.equal(S.workouts.filter(w => w.id === 'w-double').length, 1, 'exactly one workout, never two');
  assert.deepEqual(second.body.prs, first.body.prs, 'the retry reports the same PRs the real save got, not a re-derived (and wrong) empty/self-referential set');
});

test('A4b) a POST /active write for an id that already finished is refused, not resurrected', async () => {
  const uid = 'u_late_active';
  writeState(process.env.DATA_DIR, uid, baseState({ workouts: [], active: { id: 'w-race', d: '2026-09-21', entries: [] } }));
  const workout = { id: 'w-race', d: '2026-09-21', start: 1, end: 2, routineId: null, name: 'x', bw: null,
    entries: [{ id: '0025', sets: [{ w: 50, r: 8, done: true }], target: {} }] };

  const fin = await callFinish(uid, workout);
  assert.equal(fin.status, 200);

  // A write that was already in flight for the SAME session id, arriving after finish.
  const late = await callPostActive(uid, { id: 'w-race', d: '2026-09-21', entries: [] }, { exId: '0025', exName: 'x', setIdx: 1, setsTotal: 1 });
  assert.equal(late.status, 409, 'refused, not silently accepted');

  const { readState } = await import('../lib/state-store.js');
  const S = readState(uid);
  assert.equal(S.active, null, 'the finished session must not come back');
  assert.equal(S.workouts.filter(w => w.id === 'w-race').length, 1);
});

test('A4c) a brand-new session for the SAME member right after finishing is completely unaffected', async () => {
  const uid = 'u_new_after_finish';
  writeState(process.env.DATA_DIR, uid, baseState({ workouts: [] }));
  const finished = { id: 'w-old', d: '2026-09-21', start: 1, end: 2, routineId: null, name: 'x', bw: null, entries: [] };
  await callFinish(uid, finished);

  // A genuinely new workout (a different id) writing to /active must work normally — the A4
  // fix only ever refuses a write for an id that is ALREADY in S.workouts, never a new one.
  const started = await callPostActive(uid, { id: 'w-new-session', d: '2026-09-21', entries: [] }, { exId: '0025', exName: 'x', setIdx: 0, setsTotal: 3 });
  assert.equal(started.status, 200);

  const { readState } = await import('../lib/state-store.js');
  const S = readState(uid);
  assert.equal(S.active?.id, 'w-new-session');
});

test('Sync V2 serializes Bunker set snapshots and acknowledges a lost-response retry once', async () => {
  const uid = 'u_bunker_active_v2';
  writeState(process.env.DATA_DIR, uid, baseState({ workouts: [], active: { id: 'w-live', d: '2026-09-21', entries: [] } }));
  const { openSync } = await import('../lib/sync.js');
  openSync(uid);
  const { readState } = await import('../lib/state-store.js');
  const revision = readState(uid)._sync.activeRevision;
  const active = { id: 'w-live', d: '2026-09-21', entries: [{ id: '0025', sets: [{ w: 50, r: 8, done: true }] }] };
  const body = { operationId: 'bunker-active-operation-1', expectedActiveRevision: revision, exId: '0025', setIdx: 1, setsTotal: 1 };

  const first = await callPostActive(uid, active, body);
  const afterFirst = readState(uid);
  const retry = await callPostActive(uid, active, body);
  const afterRetry = readState(uid);
  assert.equal(first.status, 200);
  assert.deepEqual(retry.body, first.body, 'a retry after a lost response receives its original receipt');
  assert.equal(afterRetry._sync.revision, afterFirst._sync.revision, 'the retry performs no second write');

  const stale = await callPostActive(uid, { ...active, cur: 1 }, { ...body, operationId: 'bunker-active-operation-2' });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'ACTIVE_CONFLICT');
  assert.deepEqual(readState(uid).active, active, 'a stale Bunker snapshot cannot overwrite the accepted set state');
});

test('Sync V2 rejects a legacy Bunker active writer after activation', async () => {
  const uid = 'u_bunker_active_legacy';
  writeState(process.env.DATA_DIR, uid, baseState({ workouts: [], active: null }));
  const { openSync } = await import('../lib/sync.js');
  openSync(uid);
  const legacy = await callPostActive(uid, { id: 'legacy', d: '2026-09-21', entries: [] });
  assert.equal(legacy.status, 409);
  assert.equal(legacy.body.code, 'SYNC_UPGRADE_REQUIRED');
  const { readState } = await import('../lib/state-store.js');
  assert.equal(readState(uid).active, null);
});
