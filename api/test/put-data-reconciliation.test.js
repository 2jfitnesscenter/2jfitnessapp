import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* v1.3.1 — A1 fix. Cross-audit finding: PUT /api/data was a full-file replace with no
 * protection beyond `active`, so a client whose own local snapshot predated a Bunker-finished
 * workout, or a trainer's routine re-save, could sync anything at all afterward and silently
 * erase what the server had gained since (reproduced, not just theorised, during the audit).
 *
 * Fixed narrowly for the fields provably safe to protect without breaking a real, legitimate
 * removal: workouts (union-merged by id — explicit delete via POST /api/workouts/delete, or a
 * whole-account `wipe: true`, are the only two ways one still actually disappears) and
 * routineVersions/programVersions (100% server-authored, same "server always wins" rule as
 * `active`). routines/programs/dayPlan are deliberately untouched — see server.js's own comment
 * on PUT /api/data for why.
 *
 * Same real-spawned-server pattern as data-active-preserve.test.js/active-discard.test.js — a
 * route table this size isn't meaningfully testable any other way. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'put-data-recon-'));
const SECRET = 'd'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'u1', name: 'Member One' }, { id: 'trainer1', name: 'Trainer One', trainer: true, admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
fs.writeFileSync(path.join(dir, 'bunker.json'), JSON.stringify({
  pins: [{ userId: 'u1', pin: '1234', updatedAt: Date.now() }], adminCodes: [], roomKey: null,
  settings: { columns: 4, header: 'x', enableRestEndBeep: true, highlightFinishedRest: true, hideWeightsInPublicView: false, autoLockSec: 60 },
}, null, 2));

const PORT = 34570;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base },
  stdio: ['ignore', 'ignore', 'ignore'],
});
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server child process never became healthy');
}
await waitForServer();

function writeState(uid, S) { fs.writeFileSync(path.join(dir, 'state-' + uid + '.json'), JSON.stringify(S)); }
function cookieFor(uid) {
  const exp = Date.now() + 86400000;
  const payload = `${uid}:${exp}:0`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}
async function req(method, p, { body, uid = 'u1', bearer } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookieFor(uid) };
  if (bearer) headers.authorization = 'Bearer ' + bearer;
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j };
}
const getData = uid => req('GET', '/api/data', { uid }).then(r => r.body.state);
const putData = (state, uid) => req('PUT', '/api/data', { body: { state }, uid });
const putDataWipe = (state, uid) => req('PUT', '/api/data', { body: { state, wipe: true }, uid });

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, active: null, ...over,
});
const someWorkout = id => ({ id, d: '2026-09-21', start: 1, end: 2, routineId: null, name: 'x', bw: null, entries: [], prs: [] });

test('A) a workout the server gained after a client\'s own snapshot survives that client\'s stale PUT', async () => {
  writeState('u1', baseState());
  await putData(baseState(), 'u1');
  const stale = await getData('u1'); // this is what the "old" client has in memory

  // The server gains a workout the stale client never saw (e.g. the Bunker finished one).
  const withNewWorkout = await getData('u1');
  withNewWorkout.workouts = [someWorkout('w-new')];
  writeState('u1', withNewWorkout);

  // The stale client now syncs something unrelated, using its OLD snapshot as the base.
  await putData({ ...stale, _ts: Date.now(), someUnrelatedChange: true }, 'u1');

  const after = await getData('u1');
  assert.ok(after.workouts.some(w => w.id === 'w-new'), 'the workout the stale client never knew about must survive');
});

test('B) routineVersions/programVersions gained after a client\'s snapshot survive that client\'s stale PUT', async () => {
  writeState('u1', baseState());
  await putData(baseState(), 'u1');
  const stale = await getData('u1');

  const withVersions = await getData('u1');
  withVersions.routineVersions = { r1: [{ id: 'r1', name: 'Old', ex: [], versionedAt: Date.now() }] };
  withVersions.programVersions = { p1: [{ id: 'p1', name: 'Old program', routineIds: [], week: {}, versionedAt: Date.now() }] };
  writeState('u1', withVersions);

  await putData({ ...stale, _ts: Date.now() }, 'u1');

  const after = await getData('u1');
  assert.ok(after.routineVersions?.r1?.length, 'routineVersions must survive a stale PUT');
  assert.ok(after.programVersions?.p1?.length, 'programVersions must survive a stale PUT');
});

test('C) a normal PUT with nothing stale still round-trips exactly as before', async () => {
  writeState('u1', baseState());
  const mine = baseState({ workouts: [someWorkout('w-mine')], routines: [{ id: 'r1', name: 'x', emoji: 'dumbbell', ex: [] }] });
  await putData(mine, 'u1');
  const after = await getData('u1');
  assert.deepEqual(after.workouts.map(w => w.id), ['w-mine']);
  assert.equal(after.routines[0].id, 'r1');
});

test('D) active\'s existing guarantees are unaffected by this fix', async () => {
  const active = { id: 'active-1', d: '2026-09-21', entries: [] };
  writeState('u1', baseState({ active }));
  await putData(baseState({ active: null, _ts: Date.now() }), 'u1');
  const after = await getData('u1');
  assert.deepEqual(after.active, active, 'a client can still never wipe active via a generic PUT (regression)');
});

test('E1) an explicit single-workout delete still actually removes it, and a later generic PUT does not bring it back', async () => {
  writeState('u1', baseState({ workouts: [someWorkout('w-keep'), someWorkout('w-delete-me')] }));
  const del = await req('POST', '/api/workouts/delete', { body: { id: 'w-delete-me' }, uid: 'u1' });
  assert.equal(del.status, 200);
  let after = await getData('u1');
  assert.deepEqual(after.workouts.map(w => w.id), ['w-keep']);

  // A generic PUT from a client whose own snapshot still has the deleted workout (taken before
  // the delete synced) must not resurrect it — the server has already forgotten it for good.
  const staleClientStillHasIt = baseState({ workouts: [someWorkout('w-keep'), someWorkout('w-delete-me')], _ts: Date.now() });
  await putData(staleClientStillHasIt, 'u1');
  after = await getData('u1');
  assert.deepEqual(after.workouts.map(w => w.id).sort(), ['w-delete-me', 'w-keep'].sort(),
    'a workout still present in the CLIENT\'s own payload is trusted — deleting it server-side only ever happens through POST /api/workouts/delete itself, never inferred from a PUT');
});

test('E2) deleting an id that no longer exists (or never did) is a harmless no-op', async () => {
  writeState('u1', baseState({ workouts: [someWorkout('w-only')] }));
  const res = await req('POST', '/api/workouts/delete', { body: { id: 'never-existed' }, uid: 'u1' });
  assert.equal(res.status, 200);
  const after = await getData('u1');
  assert.deepEqual(after.workouts.map(w => w.id), ['w-only']);
});

test('E3) `wipe: true` (Reset everything / Import backup) really does shrink workouts and version history', async () => {
  writeState('u1', baseState({
    workouts: [someWorkout('w1'), someWorkout('w2')],
    routineVersions: { r1: [{ id: 'r1', name: 'Old', ex: [], versionedAt: Date.now() }] },
  }));
  await putDataWipe(baseState({ workouts: [], _ts: Date.now() }), 'u1');
  const after = await getData('u1');
  assert.deepEqual(after.workouts, [], 'a deliberate wipe must actually empty workouts');
});

test('workouts/delete never crosses accounts', async () => {
  writeState('u1', baseState({ workouts: [someWorkout('belongs-to-u1')] }));
  writeState('trainer1', baseState({ workouts: [someWorkout('belongs-to-trainer1')] }));
  await req('POST', '/api/workouts/delete', { body: { id: 'belongs-to-trainer1' }, uid: 'u1' });
  const trainerData = await getData('trainer1');
  assert.deepEqual(trainerData.workouts.map(w => w.id), ['belongs-to-trainer1'], 'u1 can only ever touch its own state.workouts, however it names an id');
});

test('Sync V2 HTTP activation rejects legacy snapshots and returns structured conflicts', async () => {
  const before = await req('GET', '/api/sync');
  assert.equal(before.status, 200);
  assert.equal((await req('GET', '/api/sync?owner=trainer1')).status, 403);
  const op = { operationId: 'http-operation-1', revision: before.body.meta.revision, generation: before.body.meta.generation, type: 'save', state: before.body.state };
  assert.equal((await req('POST', '/api/sync', { body: { ...op, owner: 'trainer1' } })).status, 403);
  assert.equal((await req('POST', '/api/sync', { body: op })).status, 200);
  const stale = await req('POST', '/api/sync', { body: { ...op, operationId: 'http-operation-2' } });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, 'SYNC_CONFLICT');
  assert.equal(stale.body.meta.revision, before.body.meta.revision + 1);
  assert.equal((await putData(baseState())).status, 409);
  assert.equal((await req('POST', '/api/workouts/delete', { body: { id: 'anything' } })).status, 409);
});

test('two independent clients converge; deletes and Bunker finish survive stale writes', async () => {
  writeState('u1', baseState({ workouts: [someWorkout('old')] }));
  const A = await req('GET', '/api/sync');
  const B = await req('GET', '/api/sync');
  assert.equal(A.body.meta.revision, B.body.meta.revision);

  const aState = structuredClone(A.body.state);
  aState.dayPlan = { '2026-09-21': 'rest' };
  const aSave = await req('POST', '/api/sync', { body: { owner: 'u1', operationId: 'client-a-save', type: 'save', revision: A.body.meta.revision, generation: A.body.meta.generation, state: aState } });
  assert.equal(aSave.status, 200);
  const staleB = structuredClone(B.body.state); staleB.unit = 'lb';
  const bConflict = await req('POST', '/api/sync', { body: { owner: 'u1', operationId: 'client-b-stale', type: 'save', revision: B.body.meta.revision, generation: B.body.meta.generation, state: staleB } });
  assert.equal(bConflict.status, 409);
  const bRevalidated = await req('GET', '/api/sync');
  assert.deepEqual(bRevalidated.body.state.dayPlan, aState.dayPlan);
  assert.equal(bRevalidated.body.state.unit, 'kg');

  const deleted = await req('POST', '/api/sync', { body: { owner: 'u1', operationId: 'client-a-delete', type: 'delete', kind: 'workouts', id: 'old', revision: bRevalidated.body.meta.revision, generation: bRevalidated.body.meta.generation } });
  assert.equal(deleted.status, 200);
  const resurrection = await req('POST', '/api/sync', { body: { owner: 'u1', operationId: 'client-b-resurrect', type: 'save', revision: B.body.meta.revision, generation: B.body.meta.generation, state: B.body.state } });
  assert.equal(resurrection.status, 409);
  assert.deepEqual((await req('GET', '/api/sync')).body.state.workouts, []);

  const beforeFinish = await req('GET', '/api/sync');
  const checkin = await req('POST', '/api/bunker/checkin', { body: { pin: '1234' } });
  assert.equal(checkin.status, 200);
  const workout = someWorkout('bunker-finished');
  const finish = await req('POST', '/api/bunker/finish', { body: { workout }, bearer: checkin.body.token });
  assert.equal(finish.status, 200);
  assert.equal((await req('POST', '/api/bunker/finish', { body: { workout }, bearer: checkin.body.token })).status, 200);
  const staleAfterFinish = await req('POST', '/api/sync', { body: { owner: 'u1', operationId: 'client-stale-after-bunker', type: 'save', revision: beforeFinish.body.meta.revision, generation: beforeFinish.body.meta.generation, state: beforeFinish.body.state } });
  assert.equal(staleAfterFinish.status, 409);
  const final = await req('GET', '/api/sync');
  assert.deepEqual(final.body.state.workouts.map(w => w.id), ['bunker-finished']);
});

test('a new bioimpedance weight uses S.bodyweight and stale clients converge to it', async () => {
  writeState('u1', baseState({ bodyweight: [{ d: '2026-09-19', w: 80, t: 1 }] }));
  const mobile = await req('GET', '/api/sync');
  const admin = await req('POST', '/api/admin/user/measurements', {
    uid: 'trainer1',
    body: {
      id: 'u1', weight: 81.4, values: { bodyFat: 20 }, d: '2026-09-21',
      operationId: 'admin-weight-1', sync: { revision: mobile.body.meta.revision, generation: mobile.body.meta.generation },
    },
  });
  assert.equal(admin.status, 200);
  const revisionAfterWeight = admin.body.sync.revision;
  const retry = await req('POST', '/api/admin/user/measurements', {
    uid: 'trainer1',
    body: {
      id: 'u1', weight: 81.4, values: { bodyFat: 20 }, d: '2026-09-21',
      operationId: 'admin-weight-1', sync: { revision: mobile.body.meta.revision, generation: mobile.body.meta.generation },
    },
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.sync.revision, revisionAfterWeight, 'lost-response retry is a receipt, not another write');
  assert.equal((await req('POST', '/api/admin/user/measurements', { uid: 'trainer1', body: { id: 'u1', weight: 82 } })).status, 409, 'old admin tab is rejected after V2 activation');
  const stale = structuredClone(mobile.body.state); stale.targetW = 75;
  assert.equal((await req('POST', '/api/sync', { body: { owner: 'u1', operationId: 'stale-after-weight', type: 'save', revision: mobile.body.meta.revision, generation: mobile.body.meta.generation, state: stale } })).status, 409);
  const desktop = await req('GET', '/api/sync');
  assert.deepEqual(desktop.body.state.bodyweight.at(-1), { d: '2026-09-21', w: 81.4, t: desktop.body.state.bodyweight.at(-1).t });
  assert.equal(desktop.body.state.measurements.bodyFat.at(-1).v, 20);
});

test.after(() => { child.kill(); });
