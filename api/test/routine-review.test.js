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

test('GET followup (admin) carries the alert and the sync revision the staff write must present', async () => {
  seed();
  const r = await req('GET', '/api/admin/user/followup?id=member1');
  assert.equal(r.status, 200);
  const a = r.body.alerts.find(x => x.code === 'routine_review');
  assert.ok(a && a.routineId === 'r1' && a.week >= 5);
  assert.ok(r.body.sync === null || Number.isSafeInteger(r.body.sync.revision));
});

test('"Rutina revisada": admin closes the notice, the cycle restarts, the routine is untouched; others get 403', async () => {
  seed();
  const before = JSON.parse(fs.readFileSync(path.join(dir, 'state-member1.json'), 'utf8')).routines;
  for (const uid of ['member2', 'trainer1']) {
    const denied = await req('POST', '/api/admin/user/routine-reviewed', { uid, body: { id: 'member1', routineId: 'r1' } });
    assert.equal(denied.status, 403, uid);
  }
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

test.after(() => { child.kill(); });
