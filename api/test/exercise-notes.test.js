import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Shared exercise note: ONE text per member + exercise. The member and the staff who may reach them edit the same value; it does not live in a routine. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'exercise-notes-'));
const SECRET = 'b'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [
    { id: 'ma', name: 'Member A', created: '2026-01-01T00:00:00.000Z' }, { id: 'mb', name: 'Member B', created: '2026-01-01T00:00:00.000Z' },
    { id: 'tr1', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Admin', admin: true },
  ], creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const ex = [{ id: '0025', sets: 3, reps: 8 }];
const state = { routines: [{ id: 'r1', name: 'Push', ex }, { id: 'r2', name: 'Pull', ex }], programs: [], workouts: [{ id: 'w1', d: '2026-09-01', routineId: 'r1', entries: [] }], exWeights: { '0025': 80 } };
for (const id of ['ma', 'mb']) fs.writeFileSync(path.join(dir, `state-${id}.json`), JSON.stringify(state));
const PORT = 34891, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
}
const save = (uid, exerciseId, text, memberId) => req('POST', '/api/exercise-notes', uid, { exerciseId, text, ...(memberId ? { memberId } : {}) });
const read = (uid, memberId) => req('GET', '/api/exercise-notes' + (memberId ? '?memberId=' + memberId : ''), uid);

test('a member creates, edits and deletes their own note; it persists and is empty when absent', async () => {
  assert.deepEqual((await read('ma')).body.notes, {}, 'no note = empty, nothing breaks');
  assert.equal((await save('ma', '0025', 'Supino')).status, 200);
  assert.equal((await read('ma')).body.notes['0025'].text, 'Supino');
  await save('ma', '0025', 'Supino, asiento 4');
  assert.equal((await read('ma')).body.notes['0025'].text, 'Supino, asiento 4', 'last save wins');
  assert.equal((await save('ma', '0025', '   ')).body.note, null, 'an empty text deletes it');
  assert.deepEqual((await read('ma')).body.notes, {});
});

test('the trainer and the member share the SAME value, whoever saved last; the admin can edit it too', async () => {
  await save('ma', '0025', 'Supino');
  assert.equal((await read('tr1', 'ma')).body.notes['0025'].text, 'Supino', 'the trainer sees the member’s note');
  await save('tr1', '0025', 'Supino y neutro alternando series', 'ma');
  assert.equal((await read('ma')).body.notes['0025'].text, 'Supino y neutro alternando series', 'the member sees exactly the trainer’s value');
  await save('ma', '0025', 'Asiento 4');
  assert.equal((await read('tr1', 'ma')).body.notes['0025'].text, 'Asiento 4', 'and the trainer sees the member’s newer value');
  assert.equal((await save('ad', '0025', 'Admin edit', 'ma')).status, 200);
  assert.equal((await read('ma')).body.notes['0025'].text, 'Admin edit');
  assert.equal((await save('tr1', '0025', '', 'ma')).status, 200, 'staff can delete it');
  assert.deepEqual((await read('ma')).body.notes, {});
});

test('it is scoped by member + exercise, not by routine: deleting or duplicating a routine keeps it, and history is untouched', async () => {
  await save('ma', '0025', 'Agarre supino');
  await save('ma', '0030', 'Otro ejercicio');
  const dup = await req('POST', '/api/trainer/member-routine-duplicate', 'tr1', { memberId: 'ma', routineId: 'r1' });
  assert.equal(dup.status, 200);
  assert.equal((await req('POST', '/api/trainer/member-routine-delete', 'tr1', { memberId: 'ma', routineId: 'r1' })).status, 200);
  assert.equal((await req('POST', '/api/trainer/member-routine-delete', 'tr1', { memberId: 'ma', routineId: 'r2' })).status, 200);
  const notes = (await read('ma')).body.notes;
  assert.equal(notes['0025'].text, 'Agarre supino'); assert.equal(notes['0030'].text, 'Otro ejercicio');
  const s = (await req('GET', '/api/data', 'ma')).body.state;
  assert.deepEqual(s.workouts, state.workouts); assert.deepEqual(s.exWeights, state.exWeights);
  assert.ok(!JSON.stringify(s).includes('Agarre supino'), 'the note is not copied into the routine or the state');
  assert.equal((await read('mb')).body.notes['0025'], undefined, 'another member has their own, separate note');
});

test('permissions: no cross-member access, no anonymous access, staff targets are refused, input is validated', async () => {
  await save('ma', '0025', 'Privada');
  assert.equal((await read('mb', 'ma')).status, 403, 'a member cannot read another member’s notes');
  assert.equal((await save('mb', '0025', 'Intruso', 'ma')).status, 403, 'nor change them');
  assert.equal((await read('mb')).body.notes['0025'], undefined);
  assert.equal((await read(null)).status, 401); assert.equal((await save(null, '0025', 'x')).status, 401);
  assert.equal((await read('tr1', 'ad')).status, 403, 'a trainer cannot target an admin account');
  assert.equal((await read('tr1', 'ghost')).status, 403); assert.equal((await read('ad', 'ghost')).status, 404);
  assert.equal((await save('ma', '../etc', 'x')).status, 400); assert.equal((await save('ma', '0025', 5)).status, 400);
  const long = (await save('ma', '0025', 'x'.repeat(900))).body.note.text;
  assert.equal(long.length, 500, 'capped');
});

test('the account export includes the notes and erasing the account removes them (and only theirs)', async () => {
  process.env.DATA_DIR = dir;
  const notes = await import('../lib/exercise-notes.js');
  await save('mb', '0025', 'Mía'); await save('ma', '0025', 'De A');
  assert.equal(notes.exportUser('mb')['0025'].text, 'Mía');
  assert.equal(notes.removeUser('mb'), 1);
  assert.deepEqual((await read('ad', 'mb')).body.notes, {});
  assert.equal((await read('ma')).body.notes['0025'].text, 'De A');
});

test.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
