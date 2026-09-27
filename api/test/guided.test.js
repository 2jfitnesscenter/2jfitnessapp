import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Entrena con 2J: the official guided routines. Any signed-in person reads the catalogue;
 * trainers keep their own copies (private, no IDOR); only admins curate the official one and its
 * collections; a FAIL is never stored; the seed is read from the release, never rewritten.
 * Real spawned server, same harness as blocks.test.js. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-'));
const SECRET = 'e'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'm1', name: 'Member' }, { id: 't1', name: 'Trainer', trainer: true }, { id: 't2', name: 'Trainer 2', trainer: true }, { id: 'ad', name: 'Admin', admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const PORT = 34591, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* booting */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}
const SEED = JSON.parse(fs.readFileSync(path.resolve('lib/guided-official.json'), 'utf8'));
const seedText = fs.readFileSync(path.resolve('lib/guided-official.json'), 'utf8');

test('every signed-in person reads the catalogue; anonymous does not', async () => {
  assert.equal((await req('GET', '/api/guided')).status, 401);
  const m = await req('GET', '/api/guided', 'm1');
  assert.equal(m.status, 200);
  assert.equal(m.body.routines.length, 39);
  assert.equal(m.body.collections.length, 7);
  assert.equal(m.body.programs.length, 4);
  assert.ok(m.body.programs.every(p => p.weeks.length === p.weeksCount && p.weeks.every(w => w.sessions.length)));
  assert.deepEqual(m.body.mine, []);
  assert.equal(m.body.canEdit, false);
  assert.equal(m.body.canAssign, false);
  assert.deepEqual(m.body.seed, { protocolVersion: SEED.protocolVersion, seedVersion: 1, count: 39, collections: 7 });
  assert.ok(m.body.routines.every(r => r.official && r.validation.result === 'PASS' && r.ex.length && r.blocks.length));
  const t = await req('GET', '/api/guided', 't1');
  assert.equal(t.body.canAssign, true);
  assert.equal(t.body.canEdit, false);
  assert.equal((await req('GET', '/api/guided', 'ad')).body.canEdit, true);
  // reading twice changes nothing: the seed is served from the release, not copied into DATA
  assert.deepEqual((await req('GET', '/api/guided', 'm1')).body.routines.map(r => r.id), m.body.routines.map(r => r.id));
  assert.equal(fs.existsSync(path.join(dir, 'guided.json')), false);
});

test('/api/blocks serves exactly the official masters — routines add no blocks', async () => {
  const LIB = JSON.parse(fs.readFileSync(path.resolve('lib/blocks-official.json'), 'utf8'));
  const blocks = (await req('GET', '/api/blocks', 't1')).body.blocks;
  assert.equal(blocks.length, LIB.blocks.length);
  assert.equal(blocks.length, 155);
  assert.ok(!blocks.some(b => /^r2j/.test(b.id) || SEED.routines.some(r => r.blocks.some(x => x.iid === b.id))));
});

test('members cannot write anything', async () => {
  const r = SEED.routines[0];
  for (const [p, b] of [['/api/guided/save', { routine: { ...r, id: undefined } }], ['/api/guided/duplicate', { id: r.id }], ['/api/guided/active', { id: r.id, active: false }],
    ['/api/guided/delete', { id: r.id }], ['/api/guided/curate', { id: r.id, featured: 1 }], ['/api/guided/collection', { collection: { name: 'x' } }]])
    assert.equal((await req('POST', p, 'm1', b)).status, 403, p);
  assert.equal((await req('POST', '/api/trainer/member-program', 'm1', { memberId: 'm1', guidedProgramId: 'g2j-beginner-4w' })).status, 403);
});

test('trainer assigns an official multi-week program as a versioned member snapshot, with receipt replay', async () => {
  await req('GET', '/api/sync', 'm1'); // initialize this member's existing Sync V2 state
  const before = (await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body
  const body = { memberId: 'm1', guidedProgramId: 'g2j-beginner-4w', sync: before.sync, operationId: 'assign-guided-program-1' }
  const assigned = await req('POST', '/api/trainer/member-program', 't1', body)
  assert.equal(assigned.status, 200)
  assert.ok(assigned.body.programId)
  const plan = (await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body
  const program = plan.programs.find(p => p.id === assigned.body.programId)
  assert.ok(program)
  assert.equal(program.source, 'guided-v2')
  assert.equal(program.status, 'assigned')
  assert.equal(program.weeks.length, 4)
  assert.equal(Object.keys(program.routineSnapshots).length, 9)
  assert.equal(plan.routines.length, 9)
  assert.equal((await req('GET', '/api/data', 'm1')).body.state.activeProgramId || null, null)
  const replay = await req('POST', '/api/trainer/member-program', 't1', body)
  assert.equal(replay.status, 200)
  assert.equal((await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body.programs.length, 1)
  const latest = (await req('GET', '/api/trainer/member-plan?id=m1', 't1')).body
  assert.equal((await req('POST', '/api/trainer/member-program', 't1', { ...body, sync: latest.sync, guidedProgramId: 'not-a-program', operationId: 'assign-guided-program-2' })).status, 404)
});

test('trainers duplicate into their own private routines (no IDOR) and cannot touch official ones', async () => {
  const off = SEED.routines.find(r => r.id === 'r2j-tabata-start');
  assert.equal((await req('POST', '/api/guided/save', 't1', { routine: { ...off, name: 'hack' } })).status, 403);
  assert.equal((await req('POST', '/api/guided/active', 't1', { id: off.id, active: false })).status, 403);
  assert.equal((await req('POST', '/api/guided/curate', 't1', { id: off.id, featured: 1 })).status, 403);
  const dup = await req('POST', '/api/guided/duplicate', 't1', { id: off.id });
  assert.equal(dup.status, 200);
  const mine = dup.body.routine;
  assert.equal(mine.official, false);
  assert.equal(mine.copiedFrom, off.id);
  assert.equal(mine.createdBy, 't1');
  assert.ok(!('featured' in mine) && !('seedVersion' in mine));
  // edit it: facts are recomputed server-side, whatever the client sends
  const ed = await req('POST', '/api/guided/save', 't1', { routine: { ...mine, name: 'Mi Tabata', estimatedMinutes: 999, equipment: ['barbell'], ex: mine.ex.slice(0, -1) } });
  assert.equal(ed.status, 200);
  assert.equal(ed.body.routine.name, 'Mi Tabata');
  assert.notEqual(ed.body.routine.estimatedMinutes, 999);
  assert.deepEqual(ed.body.routine.equipment, ['body weight']);
  // private: another trainer neither sees nor edits it, and the member catalogue never shows it
  assert.ok(!(await req('GET', '/api/guided', 't2')).body.mine.length);
  assert.ok(!(await req('GET', '/api/guided', 'm1')).body.routines.some(r => r.id === mine.id));
  for (const p of ['/api/guided/save', '/api/guided/active', '/api/guided/delete', '/api/guided/duplicate'])
    assert.equal((await req('POST', p, 't2', p.endsWith('save') ? { routine: { ...mine } } : { id: mine.id })).status, 404, p);
  assert.equal((await req('GET', '/api/guided', 't1')).body.mine.length, 1);
  assert.equal((await req('POST', '/api/guided/delete', 't1', { id: mine.id })).status, 200);
  assert.equal((await req('GET', '/api/guided', 't1')).body.mine.length, 0);
});

test('a routine that FAILs the 2J protocol is never stored', async () => {
  const bad = { name: 'Potencia al fallo', category: 'circuit', goal: 'power', level: 'advanced', focus: 'fullbody',
    ex: [{ id: '0514', sets: 3, mode: 'reps', reps: 5, rpe: [10, 10, 10] }] };
  const r = await req('POST', '/api/guided/save', 't1', { routine: bad });
  assert.equal(r.status, 400);
  assert.equal(r.body.validation.result, 'FAIL');
  assert.equal((await req('GET', '/api/guided', 't1')).body.mine.length, 0);
});

test('admin curates: deactivate hides from members, featured/badge/order are merchandising only, seed file untouched', async () => {
  const id = 'r2j-core-start';
  assert.equal((await req('POST', '/api/guided/active', 'ad', { id, active: false })).status, 200);
  assert.ok(!(await req('GET', '/api/guided', 'm1')).body.routines.some(r => r.id === id), 'inactive hidden from members');
  assert.ok(!(await req('GET', '/api/guided', 'm1')).body.collections.some(c => c.routineIds.includes(id)), 'and from their collections');
  assert.ok((await req('GET', '/api/guided', 'ad')).body.routines.some(r => r.id === id && r.active === false), 'admin still sees it');
  assert.equal((await req('POST', '/api/guided/delete', 'ad', { id })).status, 400, 'seed routines are deactivated, not deleted');
  await req('POST', '/api/guided/active', 'ad', { id, active: true });
  const before = SEED.routines.find(r => r.id === id);
  const c = await req('POST', '/api/guided/curate', 'ad', { id, featured: 4, badge: 'new', order: 3 });
  assert.equal(c.status, 200);
  const after = (await req('GET', '/api/guided', 'm1')).body.routines.find(r => r.id === id);
  assert.equal(after.featured, 4);
  assert.equal(after.badge, 'new');
  assert.deepEqual(after.ex, before.ex, 'curation never changes the content');
  assert.equal((await req('POST', '/api/guided/curate', 'ad', { id, badge: 'popular' })).body.routine.badge, null, 'no invented badges');
  // content edit by admin is an overlay
  const ed = await req('POST', '/api/guided/save', 'ad', { routine: { ...before, scope: 'official', description: 'Versión del gimnasio' } });
  assert.equal(ed.status, 200);
  assert.equal((await req('GET', '/api/guided', 'm1')).body.routines.find(r => r.id === id).description, 'Versión del gimnasio');
  assert.equal(fs.readFileSync(path.resolve('lib/guided-official.json'), 'utf8'), seedText);
});

test('admin collections: create, edit, order, deactivate; unknown routine ids are dropped', async () => {
  const made = await req('POST', '/api/guided/collection', 'ad', { collection: { name: 'Verano', description: 'Para la playa', style: 'hiit', order: 1, routineIds: ['r2j-hiit-lowimpact', 'r2j-nope', 'r2j-hiit-lowimpact'] } });
  assert.equal(made.status, 200);
  const c = made.body.collections.find(x => x.name === 'Verano');
  assert.deepEqual(c.routineIds, ['r2j-hiit-lowimpact']);
  assert.equal((await req('POST', '/api/guided/collection', 'ad', { collection: { name: '' } })).status, 400);
  await req('POST', '/api/guided/collection', 'ad', { collection: { ...c, active: false } });
  assert.ok(!(await req('GET', '/api/guided', 'm1')).body.collections.some(x => x.id === c.id));
  const seedColl = SEED.collections[0];
  await req('POST', '/api/guided/collection', 'ad', { collection: { ...seedColl, order: 99 } });
  const list = (await req('GET', '/api/guided', 'm1')).body.collections;
  assert.equal(list.at(-1).id, seedColl.id, 'reordered');
});

test('the Coach receives compact official routines built from official blocks', async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'guided-ai-'));
  const gate = await import('../coach/protocol-gate.js');
  const LIB = JSON.parse(fs.readFileSync(path.resolve('lib/blocks-official.json'), 'utf8'));
  const p = gate.protocolPayload({ goal: 'general', level: 'beginner', restrictions: [], unavailableEq: [] });
  assert.ok(p.officialRoutines.length > 0 && p.officialRoutines.length <= 10);
  for (const r of p.officialRoutines) {
    assert.equal(r.level, 'beginner');
    assert.ok(r.blocks.length && r.blocks.every(id => LIB.blocks.some(b => b.id === id)));
  }
  assert.ok(JSON.stringify(p).length < 16000, 'payload stays compact');
  const noBike = gate.protocolPayload({ goal: 'general', level: 'intermediate', restrictions: [], unavailableEq: ['stationary bike'] });
  assert.ok(!noBike.officialRoutines.some(r => /bike/.test(r.id)), 'unavailable equipment excluded');
});

test.after(() => { child.kill(); });
