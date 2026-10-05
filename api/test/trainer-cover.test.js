import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Routine/program covers inside the EXISTING trainer saves (member-routine / member-program): the same `image` id the member's own editor stores, no new endpoint,
 * no new permission. Absent key keeps the member's cover (a rebuilt object must not drop it), null returns to the 2J cover, anything that is not a file this
 * server stored is refused. Same real-child-process harness as routine-versions.test.js. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-cover-'));
const SECRET = 'd'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [
    { id: 'trainer1', name: 'Trainer One', trainer: true },
    { id: 'admin1', name: 'Admin', admin: true },
    { id: 'member1', name: 'Member One' },
    { id: 'member2', name: 'Member Two' },
  ],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));

const PORT = 34625;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base },
  stdio: ['ignore', 'ignore', 'ignore'],
});
for (let i = 0; i < 50; i++) {
  try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ }
  await new Promise(r => setTimeout(r, 100));
}

const writeState = (uid, S) => fs.writeFileSync(path.join(dir, 'state-' + uid + '.json'), JSON.stringify(S));
const cookieFor = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};
async function req(method, p, { body, uid = 'trainer1' } = {}) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie: cookieFor(uid) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
}
const upload = async uid => (await req('POST', '/api/media/upload', { uid, body: { image: 'data:image/jpeg;base64,' + Buffer.from('cover-' + Math.random()).toString('base64') } })).body.id;
const stateOf = uid => req('GET', '/api/data', { uid }).then(r => r.body.state);
const baseState = () => ({ unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [], exWeights: {}, bodyweight: [], tests: [], badges: {} });
const ex = [{ id: '0001', sets: 3, reps: 10 }];
const saveRoutine = (payload, uid) => req('POST', '/api/trainer/member-routine', { uid, body: payload });
const saveProgram = (payload, uid) => req('POST', '/api/trainer/member-program', { uid, body: payload });

test('an authorised trainer sets, keeps, and clears a routine cover inside the normal save', async () => {
  writeState('member1', baseState());
  const img = await upload('trainer1');
  const created = await saveRoutine({ memberId: 'member1', name: 'Push', emoji: 'dumbbell', ex, image: img });
  assert.equal(created.status, 200);
  const id = created.body.routineId;
  assert.equal((await stateOf('member1')).routines[0].image, img, 'the cover persists in the member state');
  // a later save that does not mention the cover (Constructor V2, plan review, older client) must not drop it
  await saveRoutine({ memberId: 'member1', routineId: id, name: 'Push v2', emoji: 'dumbbell', ex: [{ id: '0001', sets: 4, reps: 8 }] });
  const kept = (await stateOf('member1')).routines[0];
  assert.equal(kept.name, 'Push v2'); assert.equal(kept.image, img); assert.equal(kept.id, id, 'ids never change');
  const img2 = await upload('trainer1');
  await saveRoutine({ memberId: 'member1', routineId: id, name: 'Push v2', emoji: 'dumbbell', ex: [{ id: '0001', sets: 4, reps: 8 }], image: img2 });
  assert.equal((await stateOf('member1')).routines[0].image, img2);
  await saveRoutine({ memberId: 'member1', routineId: id, name: 'Push v2', emoji: 'dumbbell', ex: [{ id: '0001', sets: 4, reps: 8 }], image: null });
  assert.equal('image' in (await stateOf('member1')).routines[0], false, 'back to the 2J cover');
});

test('the same for a program', async () => {
  writeState('member1', baseState());
  const r = await saveRoutine({ memberId: 'member1', name: 'A', emoji: 'dumbbell', ex });
  const img = await upload('trainer1');
  const p = await saveProgram({ memberId: 'member1', name: 'Split', emoji: 'folder', routineIds: [r.body.routineId], week: {}, image: img });
  assert.equal(p.status, 200);
  assert.equal((await stateOf('member1')).programs[0].image, img);
  await saveProgram({ memberId: 'member1', programId: p.body.programId, name: 'Split 2', emoji: 'folder', routineIds: [r.body.routineId], week: {} });
  assert.equal((await stateOf('member1')).programs[0].image, img, 'kept when the save does not mention it');
  await saveProgram({ memberId: 'member1', programId: p.body.programId, name: 'Split 2', emoji: 'folder', routineIds: [r.body.routineId], week: {}, image: '' });
  assert.equal('image' in (await stateOf('member1')).programs[0], false);
});

test('admin keeps today\'s permission; a member cannot use the trainer save to touch someone else\'s cover', async () => {
  writeState('member1', baseState());
  const img = await upload('admin1');
  const adminSave = await saveRoutine({ memberId: 'member1', name: 'Admin routine', emoji: 'dumbbell', ex, image: img }, 'admin1');
  assert.equal(adminSave.status, 200);
  assert.equal((await stateOf('member1')).routines[0].image, img);
  const denied = await saveRoutine({ memberId: 'member1', routineId: adminSave.body.routineId, name: 'Hijack', emoji: 'dumbbell', ex, image: null }, 'member2');
  assert.equal(denied.status, 403);
  const deniedP = await saveProgram({ memberId: 'member1', name: 'Hijack', emoji: 'folder', routineIds: [adminSave.body.routineId], week: {}, image: img }, 'member2');
  assert.equal(deniedP.status, 403);
  const after = (await stateOf('member1')).routines[0];
  assert.equal(after.image, img); assert.equal(after.name, 'Admin routine');
});

test('only files this server stored are accepted: no paths, no other extensions, no unknown names', async () => {
  writeState('member1', baseState());
  for (const bad of ['../secret', '..\\secret', '/etc/passwd', 'nope.jpg', 'x.png', 42, { a: 1 }]) {
    const res = await saveRoutine({ memberId: 'member1', name: 'Bad', emoji: 'dumbbell', ex, image: bad });
    assert.equal(res.status, 400, JSON.stringify(bad));
  }
  assert.equal((await stateOf('member1')).routines.length, 0, 'a refused cover saves nothing');
});

test('the member\'s own cover flow is unchanged: the upload endpoint still works for any signed-in user and the id serves back', async () => {
  const id = await upload('member1');
  assert.match(id, /^[A-Za-z0-9_-]+\.jpg$/);
  const r = await fetch(base + '/api/social/media?id=' + id, { headers: { cookie: cookieFor('member1') } });
  assert.equal(r.status, 200);
});

test.after(() => { child.kill(); });
