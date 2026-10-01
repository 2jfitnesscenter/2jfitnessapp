import test, { beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, writeState as seedState } from './helpers.mjs';
const dir = tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');
const { readState } = await import('../lib/state-store.js');
const { buildFinishedWorkout, WORKOUT_INACTIVITY_MS } = await import('../lib/workout-activity.js');
const base = 1700000000000;
let now = base + WORKOUT_INACTIVITY_MS, sweep;
const realNow = Date.now; Date.now = () => now; after(() => { Date.now = realNow; });
const users = ['A', 'B', 'C'].map(id => ({ id }));
const routes = bunkerRoutes({ json: (res, status, body) => Object.assign(res, { status, body }), readBody: async req => req.body,
  readSession: req => users.find(u => u.id === req.member), sign: x => x, verifySig: x => x, users: () => users,
  isTrainer: () => false, registerInactivitySweep: f => { sweep = f; } });
const active = id => ({ id, d: '2026-10-01', start: base - 50 * 60000, lastActivityAt: base, cur: 0,
  entries: [{ id: '0025', target: { reps: 8 }, sets: [{ w: 40, r: 8, done: true, rpe: 7, feel: 'good' }] }] });
function seed(id, at = base, extra = {}) { seedState(dir, id, { workouts: [], exWeights: {}, programs: [], active: { ...active(id), lastActivityAt: at }, ...extra }); }
async function call(path, id, body) { const res = {}; await routes[`POST ${path}`]({ body, member: id, headers: { authorization: `Bearer bunker:${id}:${now + 3600000}` } }, res); return res; }
const timeoutBody = id => ({ workout: buildFinishedWorkout(readState(id).active), finishReason: 'inactivity_timeout', expectedActiveRevision: readState(id)._sync.activeRevision });
beforeEach(() => { now = base + WORKOUT_INACTIVITY_MS; users.forEach(u => seed(u.id, now)); });

test('59:59 does not finish; 60:00 finishes normal history exactly once', async () => {
  seed('A'); now--; await sweep(); assert.ok(readState('A').active);
  now++; await sweep(); await sweep(); const S = readState('A');
  assert.equal(S.active, null); assert.equal(S.workouts.length, 1);
  assert.equal(S.workouts[0].finishReason, 'inactivity_timeout');
  assert.equal(S.workouts[0].end, base); assert.equal(S.workouts[0].finishedAt, now);
  assert.equal(S.workouts[0].entries[0].sets[0].feel, 'good');
});
test('three users have independent deadlines, even without board polling or a kiosk UI', async () => {
  seed('A'); seed('B', now - 10 * 60000); seed('C', now - 5000); await sweep();
  assert.equal(readState('A').active, null); assert.ok(readState('B').active); assert.ok(readState('C').active);
});
test('acknowledged mobile activity at 50 minutes prevents a stale Bunker timeout', async () => {
  seed('A'); now = base + 50 * 60000;
  assert.equal((await call('/api/active/activity', 'A', { id: 'A', at: now })).status, 200);
  now = base + 60 * 60000;
  assert.equal((await call('/api/bunker/finish', 'A', timeoutBody('A'))).status, 409);
  await sweep(); assert.ok(readState('A').active);
  now = base + 110 * 60000; await sweep(); assert.equal(readState('A').workouts.length, 1);
});
test('lost finish response / retry and later manual click are idempotent', async () => {
  seed('A'); const body = timeoutBody('A');
  assert.equal((await call('/api/bunker/finish', 'A', body)).status, 200);
  assert.equal((await call('/api/bunker/finish', 'A', body)).status, 200);
  assert.equal((await call('/api/bunker/finish', 'A', { workout: body.workout })).status, 200);
  assert.equal(readState('A').workouts.length, 1);
});
test('manual finish before timeout remains manual and sweep cannot duplicate it', async () => {
  seed('A', now); const body = { workout: buildFinishedWorkout(readState('A').active) };
  await call('/api/bunker/finish', 'A', body); now += 3600000; await sweep();
  assert.equal(readState('A').workouts.length, 1); assert.equal(readState('A').workouts[0].finishReason, undefined);
});
test('replayed activity does not become fresh activity; another user cannot touch A', async () => {
  seed('A'); now = base + 50 * 60000;
  await call('/api/active/activity', 'A', { id: 'A', at: now });
  const at = now; now = base + 70 * 60000;
  await call('/api/active/activity', 'A', { id: 'A', at });
  await call('/api/active/activity', 'B', { id: 'A', at: now });
  assert.equal(readState('A').active.lastActivityAt, at);
});
test('reload/reconnect uses persisted deadline and cannot resurrect the finished session', async () => {
  seed('A'); const a = readState('A').active; await sweep();
  const result = await call('/api/bunker/active', 'A', { active: a });
  assert.equal(result.status, 409); assert.equal(readState('A').active, null);
});
test('stale revision and divergent mobile snapshot are rejected without clearing active', async () => {
  seed('A'); const body = timeoutBody('A'); body.expectedActiveRevision++;
  assert.equal((await call('/api/bunker/finish', 'A', body)).status, 409);
  const a = structuredClone(readState('A').active); a.entries[0].sets[0].w = 100;
  assert.equal((await call('/api/active/finish-inactive', 'A', { active: a, workout: buildFinishedWorkout(a) })).status, 409);
  assert.equal(readState('A').active.entries[0].sets[0].w, 40);
});
test('phone-only timeout uses normal finish and preserves Guided Program receipt/completion', async () => {
  const a = active('phone'); a.src2j = { program: { programId: 'p', sessionId: '1:1:0' } };
  seed('A', now, { active: null, activeProgramId: 'p', programs: [{ id: 'p', source: 'guided-v2', status: 'active', weeks: [{ sessions: [{ day: 1, routineId: 'r' }] }] }] });
  assert.equal((await call('/api/active/finish-inactive', 'A', { active: a, workout: buildFinishedWorkout(a) })).status, 200);
  const S = readState('A'); assert.equal(S.activeProgramId, null); assert.equal(S.programs[0].status, 'completed'); assert.deepEqual(S.workouts[0].src2j, a.src2j);
});
test('API and client use one exact inactivity policy and finish builder', () => {
  const read = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(read(new URL('../lib/workout-activity.js', import.meta.url)), read(new URL('../../frontend/src/lib/workout-activity.js', import.meta.url)));
});
