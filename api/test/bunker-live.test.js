import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, writeState } from './helpers.mjs';

const dir = tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');
const { readState } = await import('../lib/state-store.js');
const { openSync } = await import('../lib/sync.js');
const store = await import('../bunker/store.js');
const { programProgress } = await import('../lib/guided-program-model.js');
const members = ['live-A', 'live-B', 'live-C'].map(id => ({ id, name: id }));
const routes = bunkerRoutes({ json: (res, status, body) => Object.assign(res, { status, body }),
  readBody: async req => req.body, readSession: req => members.find(u => u.id === req.member),
  sign: x => x, verifySig: x => x, users: () => members, isTrainer: () => false });
const token = id => `bunker:${id}:${Date.now() + 3600000}`;
async function call(path, id, body, method = 'POST') {
  const res = {};
  await routes[`${method} /api/bunker/${path}`]({ headers: { authorization: `Bearer ${token(id)}` }, member: id, body, url: '/x' }, res);
  return res;
}
const active = id => ({ id, d: '2026-10-01', start: 1, cur: 0, name: id, entries: [{ id: '0025', target: { rest: 60 }, sets: [{ w: 40, r: 8, done: false }] }] });
function seed(id, extra = {}) {
  writeState(dir, id, { routines: [], programs: [], workouts: [], week: {}, dayPlan: {}, exWeights: {}, customEx: [], active: active(id), ...extra });
  openSync(id);
  store.startSession(id, id);
}

test('three users: sets, exercise swaps, cardio, timers and finish remain isolated', async () => {
  members.forEach(u => seed(u.id));
  for (let i = 0; i < members.length; i++) {
    const id = members[i].id, draft = active(id);
    draft.cur = i;
    draft.entries[0].id = ['0025', '0001', '0466'][i];
    draft.entries[0].sets[0] = { w: 40 + i * 10, r: 8 + i, done: true, ...(i === 2 ? { sec: 60, distance: 1 } : {}) };
    const before = await call('session', id, null, 'GET');
    const body = { active: draft, operationId: `isolated-${id}`, expectedActiveRevision: before.body.activeRevision };
    assert.equal((await call('active', id, body)).status, 200);
    assert.equal((await call('rest', id, { sec: 60 + i * 30 })).status, 200);
  }
  const B = readState('live-B'), C = readState('live-C');
  const A = readState('live-A');
  assert.equal(A.active.entries[0].sets[0].w, 40);
  assert.equal(B.active.entries[0].id, '0001');
  assert.equal(C.active.entries[0].sets[0].distance, 1);
  const times = await Promise.all(members.map(u => call('session', u.id, null, 'GET')));
  assert.deepEqual(times.map(x => x.body.restSec), [60, 90, 120]);
  assert.equal(new Set(times.map(x => x.body.restEndsAt)).size, 3);
  const beforeB = JSON.stringify(B), beforeC = JSON.stringify(C);
  assert.equal((await call('finish', 'live-A', { workout: { ...A.active, end: 100 } })).status, 200);
  assert.equal((await call('finish', 'live-A', { workout: { ...A.active, end: 100 } })).status, 200);
  assert.equal(readState('live-A').workouts.length, 1);
  assert.equal(readState('live-A').active, null);
  assert.equal(JSON.stringify(readState('live-B')), beforeB);
  assert.equal(JSON.stringify(readState('live-C')), beforeC);
  assert.ok(store.getSession('live-B'));
  assert.ok(store.getSession('live-C'));
});

test('lost active response retries idempotently; concurrent stale snapshot gets 409 without losing server sets', async () => {
  seed('live-A');
  const p = (await call('session', 'live-A', null, 'GET')).body;
  const draft = active('live-A'); draft.entries[0].sets[0].done = true;
  const body = { active: draft, operationId: 'lost-response', expectedActiveRevision: p.activeRevision };
  const first = await call('active', 'live-A', body);
  assert.equal(first.status, 200);
  assert.deepEqual((await call('active', 'live-A', body)).body, first.body);
  assert.equal((await call('active', 'live-A', { ...body, active: active('live-A'), operationId: 'stale' })).status, 409);
  assert.equal(readState('live-A').active.entries[0].sets[0].done, true);
});

test('two mobile handoffs stay separate, repeated handoff preserves one session, conflict requires force', async () => {
  seed('live-A', { active: null }); seed('live-B', { active: null });
  const a = active('mobile-A'), b = active('mobile-B');
  assert.equal((await call('handoff', 'live-A', { active: a })).status, 200);
  assert.equal((await call('handoff', 'live-B', { active: b })).status, 200);
  assert.equal((await call('handoff', 'live-A', { active: a })).status, 200);
  assert.equal((await call('handoff', 'live-A', { active: active('other') })).status, 409);
  assert.equal((await call('handoff', 'live-A', { active: active('other'), force: true })).status, 200);
  assert.equal(readState('live-B').active.id, 'mobile-B');
});

test('Guided Program -> Bunker finish -> history retains receipts and selects/completes the next session once', async () => {
  const program = { id: 'guided-p', source: 'guided-v2', status: 'active', weeks: [{ sessions: [{ day: 1, routineId: 'r1' }, { day: 3, routineId: 'r2' }] }] };
  seed('live-A', { programs: [program], activeProgramId: program.id });
  for (const [index, sessionId] of ['1:1:0', '1:3:1'].entries()) {
    const w = { ...active(`guided-${index}`), end: 100 + index, src2j: { program: { programId: program.id, sessionId }, routineId: `r${index + 1}` } };
    w.entries[0].sets[0].done = true;
    assert.equal((await call('handoff', 'live-A', { active: w, force: true })).status, 200);
    assert.equal((await call('finish', 'live-A', { workout: w })).status, 200);
    assert.equal((await call('finish', 'live-A', { workout: w })).status, 200);
    const S = readState('live-A');
    assert.deepEqual(S.workouts[index].src2j, w.src2j);
    assert.equal(S.workouts.length, index + 1);
    const progress = programProgress(S.programs[0], S.workouts);
    assert.equal(progress.completed, index + 1);
    assert.equal(progress.next?.sessionId || null, index === 0 ? '1:3:1' : null);
  }
  assert.equal(readState('live-A').programs[0].status, 'completed');
  assert.equal(readState('live-A').activeProgramId, null);
});

test('API program completion reuses the exact phone model, not a parallel engine', () => {
  const normalize = p => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(normalize(new URL('../lib/guided-program-model.js', import.meta.url)), normalize(new URL('../../frontend/src/lib/guided-programs.js', import.meta.url)));
});

test('pending finish must not clear a different session installed concurrently', async () => {
  seed('live-A', { active: active('replacement') });
  const w = { ...active('old-pending'), end: 100 };
  w.entries[0].sets[0].done = true;
  assert.equal((await call('finish', 'live-A', { workout: w })).status, 409);
  assert.equal(readState('live-A').active.id, 'replacement');
  assert.equal(readState('live-A').workouts.length, 0);
});

test('a stale same-id mobile handoff cannot overwrite sets entered at the kiosk without force', async () => {
  seed('live-A');
  const stale = active('live-A');
  assert.equal((await call('handoff', 'live-A', { active: stale })).status, 200);
  const p = (await call('session', 'live-A', null, 'GET')).body;
  const edited = structuredClone(stale); edited.entries[0].sets[0].done = true;
  assert.equal((await call('active', 'live-A', { active: edited, operationId: 'kiosk-edit', expectedActiveRevision: p.activeRevision })).status, 200);
  assert.equal((await call('handoff', 'live-A', { active: stale })).status, 409);
  assert.equal(readState('live-A').active.entries[0].sets[0].done, true);
  assert.equal((await call('handoff', 'live-A', { active: stale, force: true })).status, 200);
});

test('handoff retry cannot resurrect a finished or tombstoned workout, even with force', async () => {
  seed('live-A');
  const w = active('live-A'); w.entries[0].sets[0].done = true;
  assert.equal((await call('finish', 'live-A', { workout: { ...w, end: 100 } })).status, 200);
  for (const force of [false, true]) assert.equal((await call('handoff', 'live-A', { active: w, force })).status, 409);
  assert.equal(readState('live-A').active, null);
  const { mutate } = await import('../lib/sync.js');
  const before = openSync('live-A');
  mutate('live-A', { operationId: 'delete-finished', type: 'delete', kind: 'workouts', id: w.id, revision: before.meta.revision, generation: before.meta.generation });
  assert.equal((await call('handoff', 'live-A', { active: w, force: true })).status, 409);
});
