import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Constructor V2 block library: roles (existing ones only), server-side protocol validation,
 * official vs personal, snapshots, idempotent seed. Real spawned server, same harness as
 * followup.test.js. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blocks-'));
const SECRET = 'f'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'm1', name: 'Member' }, { id: 't1', name: 'Trainer', trainer: true }, { id: 't2', name: 'Trainer 2', trainer: true }, { id: 'ad', name: 'Admin', admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
fs.writeFileSync(path.join(dir, 'state-m1.json'), JSON.stringify({ unit: 'kg', routines: [], programs: [], workouts: [], week: {}, gymProfiles: { activeId: 'home', overrides: { home: ['bodyweight', 'dumbbell'] } }, health: { private: true } }));
const PORT = 34583, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* booting */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const good = { name: 'Glúteo express', goal: 'hypertrophy', level: 'intermediate', focus: 'glutes',
  ex: [{ id: '1409', sets: 3, mode: 'reps', reps: 10, targetRepsMin: 6, targetRepsMax: 10, rpe: [8, 8, 8], rest: 150 }, { id: '0597', sets: 3, mode: 'reps', reps: 15, targetRepsMin: 12, targetRepsMax: 15, rpe: [8, 8, 10], rest: 75 }] };

test('only trainers read the library; members and anonymous do not', async () => {
  assert.equal((await req('GET', '/api/blocks')).status, 401);
  assert.equal((await req('GET', '/api/blocks', 'm1')).status, 403);
  const r = await req('GET', '/api/blocks', 't1');
  assert.equal(r.status, 200);
  assert.ok(r.body.blocks.length >= 100, 'official seed served');
  assert.ok(r.body.blocks.every(b => b.official && b.active !== false));
  assert.equal(r.body.canEditOfficial, false);
});

test('trainer member-plan exposes only sanitized active equipment context for structural review', async () => {
  const r = await req('GET', '/api/trainer/member-plan?id=m1', 't1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.gym, { availableEquipment: ['bodyweight', 'dumbbell'] });
  assert.equal('workouts' in r.body, false);
  assert.equal('health' in r.body, false);
  assert.equal('gymProfiles' in r.body, false);
  assert.equal((await req('GET', '/api/trainer/member-plan?id=m1', 'm1')).status, 403);
});

test('personal blocks: validated, owned, never another trainer\'s (no IDOR)', async () => {
  const bad = await req('POST', '/api/blocks/save', 't1', { block: { ...good, goal: 'power', ex: [{ id: '0514', sets: 3, mode: 'reps', reps: 5, rpe: [10, 10, 10] }] } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.validation.result, 'FAIL', 'a FAIL is never stored');
  const made = await req('POST', '/api/blocks/save', 't1', { block: good });
  assert.equal(made.status, 200);
  const b = made.body.block;
  assert.equal(b.official, false);
  assert.equal(b.createdBy, 't1');
  assert.equal(b.estimatedMinutes > 0, true);
  assert.ok(!(await req('GET', '/api/blocks', 't2')).body.blocks.some(x => x.id === b.id), 'invisible to other trainers');
  for (const p of ['/api/blocks/save', '/api/blocks/active', '/api/blocks/delete'])
    assert.equal((await req('POST', p, 't2', p.endsWith('save') ? { block: { ...good, id: b.id } } : { id: b.id })).status, 403, p);
  assert.equal((await req('POST', '/api/blocks/save', 'm1', { block: good })).status, 403);
  // favorites and delete by the author
  assert.deepEqual((await req('POST', '/api/blocks/favorite', 't1', { id: b.id, on: true })).body.favorites, [b.id]);
  assert.equal((await req('POST', '/api/blocks/delete', 't1', { id: b.id })).status, 200);
});

test('official blocks: admin-only edits as an overlay; trainers duplicate instead', async () => {
  const lib = (await req('GET', '/api/blocks', 't1')).body.blocks;
  const off = lib.find(x => x.id === 'off-glutes-hypertrophy-intermediate-b');
  assert.ok(off);
  assert.equal((await req('POST', '/api/blocks/save', 't1', { block: { ...off, name: 'hack' } })).status, 403);
  assert.equal((await req('POST', '/api/blocks/active', 't1', { id: off.id, active: false })).status, 403);
  const dup = await req('POST', '/api/blocks/duplicate', 't1', { id: off.id });
  assert.equal(dup.status, 200);
  assert.equal(dup.body.block.official, false);
  assert.equal(dup.body.block.copiedFrom, off.id);
  // admin edits the official one — stored as an overlay, the seed file is untouched
  const edited = await req('POST', '/api/blocks/save', 'ad', { block: { ...off, ex: off.ex.slice(0, 4), description: 'Versión del gimnasio' } });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.block.ex.length, 4);
  assert.equal(edited.body.block.official, true);
  assert.equal((await req('POST', '/api/blocks/active', 'ad', { id: off.id, active: false })).status, 200);
  assert.ok(!(await req('GET', '/api/blocks', 't1')).body.blocks.some(x => x.id === off.id), 'deactivated for trainers');
  assert.ok((await req('GET', '/api/blocks', 'ad')).body.blocks.some(x => x.id === off.id && x.active === false), 'admin still sees it');
  assert.equal((await req('POST', '/api/blocks/delete', 'ad', { id: off.id })).status, 400, 'seed blocks are deactivated, not deleted');
  // the duplicate did not follow the master
  const mine = (await req('GET', '/api/blocks', 't1')).body.blocks.find(x => x.id === dup.body.block.id);
  assert.equal(mine.ex.length, off.ex.length);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'blocks.json'), 'utf8'));
  assert.equal(Object.keys(stored.overrides).length, 1, 'only the overlay is stored — the seed is never copied');
});

test('a routine keeps its copy of a block and its metadata; Bunker-facing entries stay flat', async () => {
  const plan = (await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body;
  const r = await req('POST', '/api/trainer/member-routine', 't1', {
    memberId: 'm1', sync: plan.sync, name: 'Día glúteo', emoji: 'dumbbell',
    ex: good.ex.map(e => ({ ...e, blk: 'kabc' })),
    blocks: [{ iid: 'kabc', src: 'off-glutes-hypertrophy-intermediate-b', name: 'Glúteo · Hipertrofia · Intermedio B', type: 'strength', goal: 'hypertrophy', level: 'intermediate', v: '1.0' }, { iid: 'unused', name: 'x' }],
    meta: { goal: 'hypertrophy', level: 'intermediate', restrictions: ['no-jumps', 'made-up'] },
  });
  assert.equal(r.status, 200);
  const routine = (await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body.routines.find(x => x.id === r.body.routineId);
  assert.deepEqual(routine.blocks.map(b => b.iid), ['kabc'], 'unused block metadata dropped');
  assert.deepEqual(routine.meta, { goal: 'hypertrophy', level: 'intermediate', restrictions: ['no-jumps'], v: '1.0' });
  assert.equal(routine.ex[0].rest, 150);
  assert.deepEqual(routine.ex[0].rpe, [8, 8, 8]);
});

test('manual-save policy is enforced by the server, not only by the builder', async () => {
  const save = async (ex, meta) => {
    const plan = (await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body;
    return req('POST', '/api/trainer/member-routine', 't1', { memberId: 'm1', sync: plan.sync, name: 'Policy', emoji: 'dumbbell', ex, meta });
  };
  const squat = [{ id: '0043', sets: 3, mode: 'reps', reps: 10, targetRepsMin: 6, targetRepsMax: 10, rpe: [8, 8, 8], rest: 150 }];
  // A declared restriction is never overridable here — not even with an override reason.
  const restricted = await save(squat, { goal: 'hypertrophy', level: 'intermediate', restrictions: ['no-deep-knee-flexion'], override: { reason: 'I really want to do this anyway', codes: ['restriction'] } });
  assert.equal(restricted.status, 400);
  assert.match(restricted.body.error, /restricción declarada/);
  assert.equal(restricted.body.validation.result, 'FAIL');
  // A methodological FAIL needs a conscious override with a reason.
  const allOut = [{ id: '0585', sets: 3, mode: 'reps', reps: 12, rpe: [10, 10, 10] }, { id: '0294', sets: 3, mode: 'reps', reps: 12, rpe: [10, 10, 10] }];
  assert.equal((await save(allOut, { goal: 'hypertrophy', level: 'intermediate' })).status, 400);
  assert.equal((await save(allOut, { goal: 'hypertrophy', level: 'intermediate', override: { reason: 'short' } })).status, 400, 'a token reason is not a reason');
  const ok = await save(allOut, { goal: 'hypertrophy', level: 'intermediate', override: { reason: 'Test week agreed with the member', codes: ['rpe10_all'] } });
  assert.equal(ok.status, 200);
  const stored = (await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body.routines.find(r => r.id === ok.body.routineId);
  assert.equal(stored.meta.override.reason, 'Test week agreed with the member');
  assert.deepEqual(stored.meta.override.codes, ['rpe10_all']);
  // Saves without protocol context (older trainer paths) behave as before.
  assert.equal((await save(allOut, undefined)).status, 200);
});

test.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
