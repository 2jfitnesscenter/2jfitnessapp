import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState } from './helpers.mjs';

/* Bunker V2 — what the kiosk's routine navigation, supersets, free training and several simultaneous members rely on, at the API: one panel's
 * cursor and sets survive a reload, partners of a superset never mix, picking or starting free training writes S.active and nothing of the plan,
 * and one member finishing never touches the others. (Idempotent finish, handoff, Guided receipts and 3-user isolation: bunker-live/-finish.) */
const dir = tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');
const { readState } = await import('../lib/state-store.js');
const { openSync } = await import('../lib/sync.js');
const store = await import('../bunker/store.js');
const members = ['v2-A', 'v2-B', 'v2-C'].map(id => ({ id, name: id }));
const routes = bunkerRoutes({ json: (res, status, body) => Object.assign(res, { status, body }),
  readBody: async req => req.body, readSession: req => members.find(u => u.id === req.member),
  sign: x => x, verifySig: x => x, users: () => members, isTrainer: () => false });
const token = id => `bunker:${id}:${Date.now() + 3600000}`;
async function call(path, id, body, method = 'POST') {
  const res = {};
  await routes[`${method} /api/bunker/${path}`]({ headers: { authorization: `Bearer ${token(id)}` }, member: id, body, url: '/x' }, res);
  return res;
}
const sets = n => Array.from({ length: n }, () => ({ w: 40, r: 8, done: false }));
// 8 exercises: 3 and 4 are a superset (same sg), the rest are single
const routineActive = id => ({ id, d: '2026-10-01', start: 1, cur: 0, name: 'Full body', routineId: 'r1', entries: [
  ['0001', 3], ['0002', 3], ['0003', 2, 's1'], ['0004', 2, 's1'], ['0005', 3], ['0006', 2], ['0007', 4], ['0008', 1],
].map(([ex, n, sg]) => ({ id: ex, target: { rest: 60, sets: n }, sets: sets(n), ...(sg ? { sg } : {}) })) });
const plan = { routines: [{ id: 'r1', name: 'Full body', ex: [] }], programs: [], activeProgramId: null, week: {}, dayPlan: {} };
function seed(id, extra = {}) {
  writeState(dir, id, { ...plan, workouts: [], exWeights: {}, customEx: [], active: routineActive(id), ...extra });
  openSync(id); store.startSession(id, id);
}
async function write(id, mutate, operationId) {
  const cur = (await call('session', id, null, 'GET')).body;
  const next = structuredClone(cur.active); mutate(next);
  const res = await call('active', id, { active: next, operationId, expectedActiveRevision: cur.activeRevision });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return next;
}

test('an 8-exercise routine: the kiosk can move around it and back, and a reload finds the cursor and every set exactly as left', async () => {
  seed('v2-A');
  await write('v2-A', a => { a.entries[0].sets[0] = { w: 60, r: 10, done: true, rpe: 8 }; }, 'nav-1');
  await write('v2-A', a => { a.cur = 6; }, 'nav-2');                           // jump forward to the 7th exercise
  await write('v2-A', a => { a.entries[6].sets[0] = { w: 20, r: 12, done: true }; a.cur = 6; }, 'nav-3');
  await write('v2-A', a => { a.cur = 0; }, 'nav-4');                           // and back to the first
  const reload = (await call('session', 'v2-A', null, 'GET')).body.active;     // a refresh of the page = a fresh GET /session
  assert.equal(reload.entries.length, 8); assert.equal(reload.cur, 0);
  assert.deepEqual(reload.entries[0].sets[0], { w: 60, r: 10, done: true, rpe: 8 });
  assert.deepEqual(reload.entries[6].sets[0], { w: 20, r: 12, done: true });
  assert.equal(reload.entries.flatMap(e => e.sets).filter(s => s.done).length, 2, 'navigating added or dropped nothing');
  assert.equal(readState('v2-A').active.cur, 0);
});

test('a superset: alternating A/B keeps each partner\'s sets in its own entry and the pair stays together', async () => {
  seed('v2-A');
  for (const [i, [entry, set]] of [[2, 0], [3, 0], [2, 1], [3, 1]].entries()) {
    await write('v2-A', a => { a.cur = entry; a.entries[entry].sets[set] = { w: entry === 2 ? 30 + set : 50 + set, r: 10, done: true }; }, `ab-${i}`);
  }
  const a = readState('v2-A').active;
  assert.deepEqual(a.entries[2].sets.map(s => s.w), [30, 31]); assert.deepEqual(a.entries[3].sets.map(s => s.w), [50, 51]);
  assert.ok(a.entries[2].sg && a.entries[2].sg === a.entries[3].sg, 'still one superset');
  assert.deepEqual(a.entries.filter((_, i) => i !== 2 && i !== 3).flatMap(e => e.sets).filter(s => s.done), []);
});

test('no routine today: free training and a routine picked from the profile write S.active only; week, dayPlan and programs are untouched', async () => {
  seed('v2-A', { active: null });
  const before = JSON.stringify((({ week, dayPlan, programs, activeProgramId, routines }) => ({ week, dayPlan, programs, activeProgramId, routines }))(readState('v2-A')));
  const payload = (await call('session', 'v2-A', null, 'GET')).body;
  assert.equal(payload.active, null, 'nothing is auto-started or auto-assigned'); assert.equal(payload.routines.length, 1);
  const free = { id: 'free-1', d: '2026-10-01', start: 1, cur: 0, name: 'Freestyle', routineId: null, bw: null, entries: [] };
  assert.equal((await call('active', 'v2-A', { active: free, operationId: 'free-1', expectedActiveRevision: payload.activeRevision })).status, 200);
  free.entries.push({ id: '0001', target: {}, sets: sets(3) }); free.cur = 0;
  const rev = (await call('session', 'v2-A', null, 'GET')).body.activeRevision;
  assert.equal((await call('active', 'v2-A', { active: free, operationId: 'free-2', expectedActiveRevision: rev })).status, 200);
  assert.equal(readState('v2-A').active.routineId, null);
  assert.equal(readState('v2-A').active.entries.length, 1);
  assert.equal((await call('finish', 'v2-A', { workout: { ...free, end: 99, entries: [{ ...free.entries[0], sets: [{ w: 40, r: 8, done: true }] }] } })).status, 200);
  // now the "choose one of my routines" path
  const rev2 = (await call('session', 'v2-A', null, 'GET')).body.activeRevision;
  assert.equal((await call('active', 'v2-A', { active: routineActive('picked-1'), operationId: 'pick-1', expectedActiveRevision: rev2 })).status, 200);
  const S = readState('v2-A');
  assert.equal(S.active.routineId, 'r1');
  assert.equal(JSON.stringify((({ week, dayPlan, programs, activeProgramId, routines }) => ({ week, dayPlan, programs, activeProgramId, routines }))(S)), before);
});

test('three members at once with different cursors: each reload sees its own, and one finishing leaves the other two byte-for-byte', async () => {
  members.forEach(m => seed(m.id));
  await write('v2-A', a => { a.cur = 2; a.entries[2].sets[0].done = true; }, 'tri-A');
  await write('v2-B', a => { a.cur = 5; a.entries[5].sets[1] = { w: 70, r: 6, done: true }; }, 'tri-B');
  await write('v2-C', a => { a.cur = 7; }, 'tri-C');
  const cursors = await Promise.all(members.map(async m => (await call('session', m.id, null, 'GET')).body.active.cur));
  assert.deepEqual(cursors, [2, 5, 7]);
  const B = JSON.stringify(readState('v2-B')), C = JSON.stringify(readState('v2-C'));
  const done = readState('v2-A').active;
  assert.equal((await call('finish', 'v2-A', { workout: { ...done, end: 100 } })).status, 200);
  assert.equal(readState('v2-A').active, null); assert.equal(readState('v2-A').workouts.length, 1);
  assert.equal(JSON.stringify(readState('v2-B')), B); assert.equal(JSON.stringify(readState('v2-C')), C);
  assert.ok(store.getSession('v2-B') && store.getSession('v2-C'));
});

test('phone <-> Bunker: a phone handoff lands with its cursor, the kiosk moves on, and the finish reaches S.workouts once', async () => {
  seed('v2-A', { active: null });
  const phone = routineActive('from-phone'); phone.cur = 4; phone.entries[4].sets[0].done = true;
  assert.equal((await call('handoff', 'v2-A', { active: phone })).status, 200);
  const atKiosk = (await call('session', 'v2-A', null, 'GET')).body.active;
  assert.equal(atKiosk.cur, 4); assert.equal(atKiosk.entries[4].sets[0].done, true);
  await write('v2-A', a => { a.cur = 1; a.entries[1].sets[0].done = true; }, 'kiosk-1');
  const S = readState('v2-A');
  assert.equal(S.active.cur, 1); assert.equal(S.active.entries[4].sets[0].done, true, 'the phone\'s set is still there');
  const w = { ...S.active, end: 200 };
  assert.equal((await call('finish', 'v2-A', { workout: w })).status, 200);
  assert.equal((await call('finish', 'v2-A', { workout: w })).status, 200);
  assert.equal(readState('v2-A').workouts.filter(x => x.id === 'from-phone').length, 1);
  assert.equal(readState('v2-A').active, null);
});

test('inactivity timeout stays idempotent: the automatic finish of an idle session saves it once, however many times it is retried', async () => {
  seed('v2-A', { active: { ...routineActive('idle-1'), start: 1000, lastActivityAt: 2000 } });
  const S0 = readState('v2-A'); S0.active.entries[0].sets[0].done = true;
  const rev0 = (await call('session', 'v2-A', null, 'GET')).body.activeRevision;
  await call('active', 'v2-A', { active: { ...S0.active, lastActivityAt: 2000 }, operationId: 'idle-w', expectedActiveRevision: rev0 });
  const cur = (await call('session', 'v2-A', null, 'GET')).body;
  const w = { id: 'idle-1', d: '2026-10-01', start: 1000, end: 5000, routineId: 'r1', name: 'Full body', bw: null, prs: [], entries: [{ ...cur.active.entries[0] }] };
  const body = { workout: w, finishReason: 'inactivity_timeout', expectedActiveRevision: cur.activeRevision };
  const first = await call('finish', 'v2-A', body);
  assert.equal(first.status, 200, JSON.stringify(first.body));
  const again = await call('finish', 'v2-A', { ...body, workout: { ...w } });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  assert.equal(readState('v2-A').workouts.filter(x => x.id === 'idle-1').length, 1);
  assert.equal(readState('v2-A').workouts.find(x => x.id === 'idle-1').finishReason, 'inactivity_timeout');
});
