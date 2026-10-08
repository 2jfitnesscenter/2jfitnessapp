import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { followUpSummary } from '../lib/followup.js';

/* Routine review loop on the server: the shared engine is a byte copy of the app's, the staff summary raises a `routine_review` alert from the member's own
 * workouts, and "Rutina revisada" (admin-only) writes only S.routineReviews and restarts the cycle — the routine is never touched. */
test('api/lib/routine-review.js is byte-identical to the frontend engine', () => {
  const a = fs.readFileSync(new URL('../lib/routine-review.js', import.meta.url), 'utf8');
  const b = fs.readFileSync(new URL('../../frontend/src/lib/routine-review.js', import.meta.url), 'utf8');
  assert.equal(a, b);
});

const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra });
const FIRST = '2026-09-01';
const flat = [0, 1, 2, 3, 4].map(i => ({ id: 'w' + i, d: addDays(FIRST, i * 3), routineId: 'r1', entries: [
  { id: 'A', target: { sets: 2, reps: 8 }, sets: [set(60, 8), set(60, 8)] }, { id: 'B', target: { sets: 2, reps: 8 }, sets: [set(40, 8), set(40, 8)] }] }));
const member = over => ({ routines: [{ id: 'r1', name: 'Push day', ex: [] }], workouts: flat, week: {}, ...over });

test('the staff summary raises a routine_review alert (normal, early, none) from real workouts', () => {
  const early = followUpSummary(member(), null, addDays(FIRST, 21));
  const a = early.alerts.find(x => x.code === 'routine_review');
  assert.ok(a); assert.equal(a.early, true); assert.equal(a.week, 4); assert.equal(a.name, 'Push day'); assert.equal(a.late, false);
  assert.ok(a.reasons.some(r => r.code === 'stalled'));
  const normal = followUpSummary(member({ workouts: flat.map((w, i) => ({ ...w, entries: [
    { id: 'A', target: w.entries[0].target, sets: [set(60 + i * 2.5, 8)] }, { id: 'B', target: w.entries[1].target, sets: [set(40 + i * 2.5, 8)] }] })) }), null, addDays(FIRST, 28));
  assert.equal(normal.alerts.find(x => x.code === 'routine_review').early, false);
  assert.equal(followUpSummary(member(), null, addDays(FIRST, 14)).alerts.some(x => x.code === 'routine_review'), false);
  // members without any of this data are untouched
  assert.deepEqual(followUpSummary({}, null, '2026-10-06').summary.routineReviews, []);
  assert.equal(followUpSummary({ workouts: [{ d: '2026-09-01' }] }, null, '2026-10-06').alerts.some(x => x.code === 'routine_review'), false);
});

/* ---- real server: admin-only endpoint, replay-safe, never touches the routine ---- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-review-'));
const SECRET = 'e'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [
  { id: 'admin1', name: 'Admin', admin: true }, { id: 'trainer1', name: 'Trainer', trainer: true }, { id: 'member1', name: 'Member One' }, { id: 'member2', name: 'Member Two' }],
creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
const PORT = 34631, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, { body, uid = 'admin1' } = {}) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie: cookieFor(uid) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { /* empty */ }
  return { status: r.status, body: j };
}
const todayIso = () => new Date().toISOString().slice(0, 10);
const old = () => addDays(todayIso(), -40);
const seed = () => fs.writeFileSync(path.join(dir, 'state-member1.json'), JSON.stringify(member({
  workouts: [0, 1, 2, 3].map(i => ({ id: 'w' + i, d: addDays(old(), i * 3), routineId: 'r1', entries: [{ id: 'A', target: { sets: 1, reps: 8 }, sets: [set(60 + i * 5, 8)] }] })),
})));
const seedProgram = () => {
  const routines = [0, 1, 2, 3].map(i => ({ id: 'pr' + i, name: 'Program day ' + (i + 1), ex: [] }));
  const program = { id: 'active-p1', source: 'guided-v2', status: 'active', name: 'Four day strength', startedAt: Date.parse(addDays(todayIso(), -40) + 'T12:00:00Z'), weeks: [{ sessions: routines.map((r, i) => ({ day: i, routineId: r.id })) }] };
  const workouts = routines.map((r, i) => ({ id: 'pw' + i, d: addDays(todayIso(), -36 + i), routineId: r.id, src2j: { program: { programId: program.id, sessionId: `1:${i}:${i}` } }, entries: [] }));
  fs.writeFileSync(path.join(dir, 'state-member1.json'), JSON.stringify({ routines, programs: [program], activeProgramId: program.id, workouts, routineReviews: Object.fromEntries(routines.map(r => [r.id, { reviewedAt: addDays(todayIso(), -38) }])) }));
};

test('GET followup (admin) carries the alert and the sync revision the staff write must present', async () => {
  seed();
  const r = await req('GET', '/api/admin/user/followup?id=member1');
  assert.equal(r.status, 200);
  const a = r.body.alerts.find(x => x.code === 'routine_review');
  assert.ok(a && a.routineId === 'r1' && a.week >= 5);
  assert.ok(r.body.sync === null || Number.isSafeInteger(r.body.sync.revision));
});

test('"Rutina revisada": staff (admin or trainer) closes the notice, the cycle restarts, the routine is untouched; a member gets 403', async () => {
  seed();
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'state-member1.json'), 'utf8')).routines;
  const denied = await req('POST', '/api/admin/user/routine-reviewed', { uid: 'member2', body: { id: 'member1', routineId: 'r1' } });
  assert.equal(denied.status, 403);
  assert.equal((await req('POST', '/api/admin/user/routine-reviewed', { body: { id: 'member1', routineId: 'nope' } })).status, 400);
  assert.equal((await req('POST', '/api/admin/user/routine-reviewed', { body: { id: 'ghost', routineId: 'r1' } })).status, 404);
  const sync = (await req('GET', '/api/admin/user/followup?id=member1')).body.sync;
  const res = await req('POST', '/api/admin/user/routine-reviewed', { body: { id: 'member1', routineId: 'r1', ...(sync ? { sync, operationId: crypto.randomUUID() } : {}) } });
  assert.equal(res.status, 200);
  const S = (await req('GET', '/api/data', { uid: 'member1' })).body.state;
  assert.equal(S.routineReviews.r1.reviewedAt, todayIso()); assert.equal(S.routineReviews.r1.by, 'admin1'); assert.equal(S.routineReviews.r1.n, 1);
  assert.deepEqual(S.routines, before, 'the routine itself is never edited');
  assert.equal((await req('GET', '/api/admin/user/followup?id=member1')).body.alerts.some(x => x.code === 'routine_review'), false);
});

test('a trainer can read the cycles, edit them and mark the routine reviewed (existing trainer permission); a member cannot; admin keeps working', async () => {
  seed();
  const sync = async uid => (await req('GET', '/api/trainer/routine-cycles?id=member1', { uid })).body.sync;
  assert.equal((await req('GET', '/api/trainer/routine-cycles?id=member1', { uid: 'member2' })).status, 403);
  assert.equal((await req('GET', '/api/trainer/routine-cycles?id=ghost', { uid: 'trainer1' })).status, 404);
  const read = await req('GET', '/api/trainer/routine-cycles?id=member1', { uid: 'trainer1' });
  assert.equal(read.status, 200); assert.equal(read.body.routineCycles[0].routineId, 'r1'); assert.equal(read.body.routineCycles[0].status, 'due');
  assert.equal(Object.keys(read.body).sort().join(), 'routineCycles,sync', 'nothing from the follow-up / health summary');
  const sh = async uid => { const sy = await sync(uid); return sy ? { sync: sy, operationId: crypto.randomUUID() } : {}; };
  const set = await req('POST', '/api/admin/user/routine-cycle', { uid: 'trainer1', body: { id: 'member1', routineId: 'r1', due: addDays(todayIso(), 20), ...(await sh('trainer1')) } });
  assert.equal(set.status, 200); assert.equal(set.body.cycle.dueManual, true);
  assert.equal((await req('POST', '/api/admin/user/routine-cycle', { uid: 'member2', body: { id: 'member1', routineId: 'r1', due: addDays(todayIso(), 1) } })).status, 403);
  assert.equal((await req('POST', '/api/admin/user/routine-cycle', { uid: 'admin1', body: { id: 'member1', routineId: 'r1', due: null, ...(await sh('admin1')) } })).status, 200);
  const done = await req('POST', '/api/admin/user/routine-reviewed', { uid: 'trainer1', body: { id: 'member1', routineId: 'r1', ...(await sh('trainer1')) } });
  assert.equal(done.status, 200);
  const S = (await req('GET', '/api/data', { uid: 'member1' })).body.state;
  assert.equal(S.routineReviews.r1.by, 'trainer1');
  // the follow-up summary itself (health, check-ins) stays admin-only
  assert.equal((await req('GET', '/api/admin/user/followup?id=member1', { uid: 'trainer1' })).status, 403);
});

test('program review is one trainer-only cycle, closes into the next interval, and leaves its four routines unchanged', async () => {
  seedProgram();
  const seeded = JSON.parse(fs.readFileSync(path.join(dir, 'state-member1.json'), 'utf8'));
  const start = addDays(todayIso(), -28);
  seeded.programs[0].startedAt = Date.parse(start + 'T12:00:00Z');
  const sessionsPerWeek = [0, 1, 2, 3].map(i => ({ day: i, routineId: `pr${i}` }));
  seeded.programs[0].weeks = Array.from({ length: 8 }, () => ({ sessions: sessionsPerWeek }));
  seeded.workouts = Array.from({ length: 8 }, (_, i) => {
    const week = Math.floor(i / 2), day = i % 2;
    return { id: `elapsed-${i}`, d: addDays(start, week * 7 + day * 3), routineId: `pr${day}`, src2j: { program: { programId: 'active-p1', sessionId: `${week + 1}:${day}:${day}` } }, entries: [] };
  });
  fs.writeFileSync(path.join(dir, 'state-member1.json'), JSON.stringify(seeded));
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'state-member1.json'), 'utf8')).routines;
  const read = await req('GET', '/api/trainer/routine-cycles?id=member1', { uid: 'trainer1' });
  assert.equal(read.status, 200);
  assert.equal(read.body.routineCycles.length, 1);
  assert.equal(read.body.routineCycles[0].kind, 'program');
  assert.equal(read.body.routineCycles[0].routineIds.length, 4);
  assert.deepEqual(read.body.routineCycles[0].adherence, { completed: 8, total: 16, percent: 50 });
  assert.ok(read.body.routineCycles[0].status === 'due' || read.body.routineCycles[0].status === 'overdue');
  const sync = read.body.sync;
  const done = await req('POST', '/api/admin/user/routine-reviewed', { uid: 'trainer1', body: { id: 'member1', programId: 'active-p1', ...(sync ? { sync, operationId: crypto.randomUUID() } : {}) } });
  assert.equal(done.status, 200);
  const state = (await req('GET', '/api/data', { uid: 'member1' })).body.state;
  assert.equal(state.programReviews['active-p1'].by, 'trainer1');
  assert.equal(state.programReviews['active-p1'].nextReviewAt, addDays(todayIso(), 28));
  assert.deepEqual(state.routines, before);
  assert.equal((await req('GET', '/api/trainer/routine-cycles?id=member1', { uid: 'trainer1' })).body.routineCycles[0].status, 'upcoming');
  assert.equal((await req('POST', '/api/admin/user/routine-reviewed', { uid: 'member2', body: { id: 'member1', programId: 'active-p1' } })).status, 403);
});

test('manual cycle dates: staff-only, saved additively, they prevail, resetting goes back to automatic, "reviewed" clears them', async () => {
  seed();
  const post = (uid, payload) => req('POST', '/api/admin/user/routine-cycle', { uid, body: { id: 'member1', routineId: 'r1', ...payload } });
  const withSync = async payload => { const sync = (await req('GET', '/api/admin/user/followup?id=member1')).body.sync; return { ...payload, ...(sync ? { sync, operationId: crypto.randomUUID() } : {}) }; };
  assert.equal((await post('member2', { start: todayIso() })).status, 403, 'member');
  assert.equal((await post('admin1', {})).status, 400, 'nothing to change');
  assert.equal((await post('admin1', await withSync({ start: 'not-a-date' }))).status, 400);
  assert.equal((await post('admin1', await withSync({ start: todayIso(), due: addDays(todayIso(), -3) }))).status, 400, 'review before start');
  const readCycle = async () => (await req('GET', '/api/admin/user/followup?id=member1')).body.routineCycles.find(c => c.routineId === 'r1');
  const auto = await readCycle();
  assert.equal(auto.startManual, false); assert.equal(auto.dueManual, false); assert.equal(auto.status, 'due');
  // a far-future manual review date prevails: no alert any more
  const farDue = addDays(todayIso(), 30);
  const set = await post('admin1', await withSync({ due: farDue }));
  assert.equal(set.status, 200); assert.equal(set.body.cycle.dueManual, true); assert.equal(set.body.cycle.dueDate, farDue);
  let r = await req('GET', '/api/admin/user/followup?id=member1');
  assert.equal(r.body.alerts.some(x => x.code === 'routine_review'), false);
  const S1 = (await req('GET', '/api/data', { uid: 'member1' })).body.state;
  assert.equal(S1.routineReviews.r1.dueOverride, farDue); assert.equal(S1.routineReviews.r1.manualBy, 'admin1');
  // a past manual start moves the cycle start; a past manual review date makes it due again
  assert.equal((await post('admin1', await withSync({ start: addDays(todayIso(), -50), due: addDays(todayIso(), -1) }))).status, 200);
  const c2 = await readCycle(); assert.equal(c2.startManual, true); assert.equal(c2.status, 'due');
  assert.ok((await req('GET', '/api/admin/user/followup?id=member1')).body.alerts.some(x => x.code === 'routine_review'));
  // reset both to automatic: nothing manual is left behind
  assert.equal((await post('admin1', await withSync({ start: null, due: '' }))).status, 200);
  const S2 = (await req('GET', '/api/data', { uid: 'member1' })).body.state;
  assert.equal(S2.routineReviews, undefined); const c3 = await readCycle(); assert.equal(c3.startManual, false); assert.equal(c3.dueManual, false);
  // "Rutina revisada" clears the manual values of the closed cycle and restarts it
  await post('admin1', await withSync({ due: addDays(todayIso(), -2) }));
  assert.equal((await req('POST', '/api/admin/user/routine-reviewed', { body: await withSync({ id: 'member1', routineId: 'r1' }) })).status, 200);
  const S3 = (await req('GET', '/api/data', { uid: 'member1' })).body.state;
  assert.deepEqual(Object.keys(S3.routineReviews.r1).sort(), ['by', 'n', 'reviewedAt']);
  assert.equal((await readCycle()).dueManual, false);
});

test.after(() => { child.kill(); });
