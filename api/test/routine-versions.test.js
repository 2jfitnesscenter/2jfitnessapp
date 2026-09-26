import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* V3 — routine/program versioning (traceability only). Hooked into the ONLY overwrite point
 * either one has: POST /api/trainer/member-routine and /member-program, when an existing
 * (id-matched) routine/program is saved again. A version is the OLD object, snapshotted right
 * before the overwrite — never the new one, and never created at all for a no-op re-save or for
 * a brand-new routine/program (nothing to snapshot yet). Same real-child-process harness as
 * test/active-discard.test.js. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-versions-'));
const SECRET = 'c'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [
    { id: 'trainer1', name: 'Trainer One', trainer: true },
    { id: 'member1', name: 'Member One' },
    { id: 'member2', name: 'Member Two' },
  ],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));

const PORT = 34569;
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
async function req(method, p, { body, uid = 'trainer1' } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookieFor(uid) };
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j };
}
const getData = uid => req('GET', '/api/data', { uid }).then(r => r.body.state);
const saveRoutine = payload => req('POST', '/api/trainer/member-routine', { body: payload });
const saveProgram = payload => req('POST', '/api/trainer/member-program', { body: payload });
const routineVersions = (memberId, routineId) => req('GET', `/api/trainer/routine-versions?memberId=${memberId}&routineId=${routineId}`);
const programVersions = (memberId, programId) => req('GET', `/api/trainer/program-versions?memberId=${memberId}&programId=${programId}`);

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, ...over,
});

test('creating a brand-new routine produces zero versions', async () => {
  writeState('member1', baseState());
  const { body } = await saveRoutine({ memberId: 'member1', name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const { body: v } = await routineVersions('member1', body.routineId);
  assert.equal(v.versions.length, 0);
  assert.equal(v.current.name, 'Push day');
});

test('a meaningful re-save creates exactly one version holding the PREVIOUS content', async () => {
  writeState('member1', baseState());
  const created = await saveRoutine({ memberId: 'member1', name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const routineId = created.body.routineId;
  await saveRoutine({ memberId: 'member1', routineId, name: 'Push day v2', emoji: 'dumbbell', ex: [{ id: '0001', sets: 4, reps: 8 }] });
  const { body: v } = await routineVersions('member1', routineId);
  assert.equal(v.versions.length, 1);
  assert.equal(v.versions[0].name, 'Push day');
  assert.equal(v.versions[0].ex[0].sets, 3);
  assert.ok(v.versions[0].versionedAt > 0);
  assert.equal(v.current.name, 'Push day v2', 'the CURRENT routine is the live one, not a version entry');
});

test('re-saving with byte-for-byte identical content creates no new version (no spam)', async () => {
  writeState('member1', baseState());
  const created = await saveRoutine({ memberId: 'member1', name: 'Leg day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const routineId = created.body.routineId;
  await saveRoutine({ memberId: 'member1', routineId, name: 'Leg day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const { body: v } = await routineVersions('member1', routineId);
  assert.equal(v.versions.length, 0);
});

test('several meaningful saves accumulate several versions, oldest last (newest-first)', async () => {
  writeState('member1', baseState());
  const created = await saveRoutine({ memberId: 'member1', name: 'v1', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const routineId = created.body.routineId;
  await saveRoutine({ memberId: 'member1', routineId, name: 'v2', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  await saveRoutine({ memberId: 'member1', routineId, name: 'v3', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const { body: v } = await routineVersions('member1', routineId);
  assert.deepEqual(v.versions.map(x => x.name), ['v2', 'v1']);
  assert.equal(v.current.name, 'v3');
});

test('finished workouts are never touched by a routine version snapshot', async () => {
  const workout = { id: 'w1', d: '2026-09-01', name: 'Push day', start: 1, end: 2, vol: 100, prs: [], entries: [{ id: '0001', target: { sets: 3, reps: 10 }, sets: [{ w: 20, r: 10, done: true }] }] };
  writeState('member1', baseState({ workouts: [workout] }));
  const created = await saveRoutine({ memberId: 'member1', name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  await saveRoutine({ memberId: 'member1', routineId: created.body.routineId, name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 5, reps: 5 }] });
  assert.deepEqual((await getData('member1')).workouts, [workout]);
});

test('program versioning follows the same rule: no version for a no-op save, one for a real change', async () => {
  writeState('member1', baseState());
  const r1 = await saveRoutine({ memberId: 'member1', name: 'Day A', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const r2 = await saveRoutine({ memberId: 'member1', name: 'Day B', emoji: 'dumbbell', ex: [{ id: '0002', sets: 3, reps: 10 }] });
  const created = await saveProgram({ memberId: 'member1', name: 'Split', emoji: 'folder', routineIds: [r1.body.routineId], week: { 1: r1.body.routineId } });
  const programId = created.body.programId;
  // no-op re-save
  await saveProgram({ memberId: 'member1', programId, name: 'Split', emoji: 'folder', routineIds: [r1.body.routineId], week: { 1: r1.body.routineId } });
  assert.equal((await programVersions('member1', programId)).body.versions.length, 0);
  // real change: add a second day
  await saveProgram({ memberId: 'member1', programId, name: 'Split', emoji: 'folder', routineIds: [r1.body.routineId, r2.body.routineId], week: { 1: r1.body.routineId, 3: r2.body.routineId } });
  const { body: v } = await programVersions('member1', programId);
  assert.equal(v.versions.length, 1);
  assert.equal(v.versions[0].routineIds.length, 1, 'the version holds the OLD (one-day) routineIds');
  assert.equal(v.current.routineIds.length, 2);
});

test('a non-trainer cannot read another member\'s version history', async () => {
  writeState('member1', baseState());
  const created = await saveRoutine({ memberId: 'member1', name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] });
  const res = await req('GET', `/api/trainer/routine-versions?memberId=member1&routineId=${created.body.routineId}`, { uid: 'member2' });
  assert.equal(res.status, 403);
});

test('a non-trainer cannot save into another member\'s routines', async () => {
  writeState('member1', baseState());
  const res = await req('POST', '/api/trainer/member-routine', { uid: 'member2', body: { memberId: 'member1', name: 'Hijack', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10 }] } });
  assert.equal(res.status, 403);
});

test.after(() => { child.kill(); });
