import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Trainer ↔ member scope on EVERY staff route that targets a member (legacy panel included):
 *   admin → any account · trainer → every member, independent of assignment · member → none of it.
 * Trainers cannot target unknown ids or staff accounts. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-acl-'));
const SECRET = 'a'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [
    { id: 'ma', name: 'Assigned Member', assignedTrainers: ['tr1'], created: '2026-01-01T00:00:00.000Z' }, { id: 'mb', name: 'Other Member', created: '2026-01-01T00:00:00.000Z' },
    { id: 'tr1', name: 'Trainer One', trainer: true }, { id: 'tr2', name: 'Trainer Two', trainer: true }, { id: 'ad', name: 'Admin', admin: true },
  ], creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const state = { routines: [{ id: 'r1', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 8 }] }], programs: [], workouts: [{ id: 'w1', d: '2026-09-01', routineId: 'r1', entries: [] }] };
for (const id of ['ma', 'mb']) fs.writeFileSync(path.join(dir, `state-${id}.json`), JSON.stringify(state));
// a routine and a program published by tr1, so "assign" can reach its member check
fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ routines: [
  { id: 'sr1', authorId: 'tr1', name: 'Pub', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }], customExDefs: [] },
  { id: 'sr2', authorId: 'tr2', name: 'Pub two', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }], customExDefs: [] },
], programs: [
  { id: 'sp1', authorId: 'tr1', name: 'Pub program', emoji: 'dumbbell', routines: [{ name: 'A', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }], customExDefs: [] }] },
  { id: 'sp2', authorId: 'tr2', name: 'Pub program two', emoji: 'dumbbell', routines: [{ name: 'A', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }], customExDefs: [] }] },
]}));
const PORT = 34883, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
}
const q = encodeURIComponent;
const LEGACY = (id, author = 'tr1') => [
  ['GET', `/api/trainer/routine-cycles?id=${q(id)}`],
  ['POST', '/api/admin/user/routine-cycle', { id, routineId: 'r1', due: '2030-01-01' }],
  ['POST', '/api/admin/user/routine-reviewed', { id, routineId: 'r1' }],
  ['GET', `/api/trainer/member-plan?id=${q(id)}`],
  ['POST', '/api/trainer/member-routine', { memberId: id, name: 'R', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }] }],
  ['POST', '/api/trainer/member-program', { memberId: id, name: 'P', routineIds: ['r1'] }],
  ['POST', '/api/trainer/assign-routine', { memberId: id, routineId: author === 'tr1' ? 'sr1' : 'sr2' }],
  ['POST', '/api/trainer/assign-program', { memberId: id, programId: author === 'tr1' ? 'sp1' : 'sp2' }],
  ['GET', `/api/trainer/routine-versions?memberId=${q(id)}&routineId=r1`],
  ['GET', `/api/trainer/program-versions?memberId=${q(id)}&programId=p1`],
  ['POST', '/api/trainer/ai/generate', { memberId: id, brief: {} }],
  ['GET', `/api/trainer/ai/status?memberId=${q(id)}`],
  ['POST', '/api/trainer/ai/discard', { memberId: id }],
  // the Coach V3 surface follows the same rule
  ['GET', `/api/trainer/followup/member?id=${q(id)}`],
  ['GET', `/api/trainer/followup/analysis?id=${q(id)}`],
  ['POST', '/api/trainer/followup/start', { id }],
  ['POST', '/api/trainer/followup/note', { id, text: 'x' }],
];
const call = (uid, [m, p, b]) => req(m, p, uid, b);

test('any trainer reaches assigned and unassigned members on every operational route', async () => {
  for (const trainer of ['tr1', 'tr2']) for (const id of ['ma', 'mb']) for (const r of LEGACY(id, trainer)) {
    const x = await call(trainer, r);
    assert.ok(x.status !== 403 && x.status !== 401, `${trainer} ${r[0]} ${r[1]} → ${x.status}`);
  }
});

test('unknown ids and staff accounts remain outside trainer member access', async () => {
  for (const id of ['ghost', 'tr2', 'ad']) for (const r of LEGACY(id)) {
    const x = await call('tr1', r);
    assert.equal(x.status, 403, `tr1 ${r[0]} ${r[1]} → ${x.status}`);
    assert.deepEqual(x.body, { error: 'prohibido' }, `${r[0]} ${r[1]}`);
  }
});

test('trainer can read and write operational state for an unassigned member', async () => {
  const plan = await req('GET', '/api/trainer/member-plan?id=mb', 'tr2');
  assert.equal(plan.status, 200);
  const routine = await req('POST', '/api/trainer/member-routine', 'tr2', { memberId: 'mb', name: 'Coach update', emoji: 'dumbbell', ex: [{ id: '0025', sets: 4, reps: 6 }] });
  assert.equal(routine.status, 200);
  const updated = await req('GET', '/api/trainer/member-plan?id=mb', 'tr1');
  assert.equal(updated.status, 200);
  assert.ok(JSON.stringify(updated.body).includes('Coach update'), 'another trainer sees the operational edit');
  const review = await req('POST', '/api/admin/user/routine-cycle', 'tr2', { id: 'mb', routineId: 'r1', due: '2030-01-01' });
  assert.ok([200, 409].includes(review.status), `routine review is no longer blocked by assignment: ${review.status}`);
});

test('the admin reaches every member on every route; an unknown id is a plain 404 only for the admin', async () => {
  // (assign-* only lets a staff member assign what they published themselves — that is its own rule, reported with its own message, never "prohibido")
  for (const id of ['ma', 'mb']) for (const r of LEGACY(id)) { const x = await call('ad', r); assert.ok(x.status !== 401 && !(x.status === 403 && x.body?.error === 'prohibido'), `admin ${r[0]} ${r[1]} → ${x.status} ${x.body?.error}`); }
  const ghost = [['GET', `/api/trainer/member-plan?id=ghost`], ['GET', `/api/trainer/routine-cycles?id=ghost`], ['GET', `/api/trainer/followup/member?id=ghost`]];
  for (const r of ghost) assert.equal((await call('ad', r)).status, 404, r[1]);
});

test('a member (and an anonymous caller) reaches none of it; a member keeps their own data', async () => {
  for (const uid of ['ma', 'mb', null]) for (const r of LEGACY('ma')) assert.equal((await call(uid, r)).status, uid ? 403 : 401, `${uid} ${r[0]} ${r[1]}`);
  assert.equal((await req('GET', '/api/data', 'ma')).status, 200);
  assert.equal((await req('GET', '/api/followup', 'ma')).status, 200);
  assert.equal((await req('GET', '/api/data', null)).status, 401);
});

test('the member picker lists every member for every trainer, but stays non-admin', async () => {
  assert.deepEqual((await req('GET', '/api/trainer/members', 'tr1')).body.members.map(m => m.id), ['ma', 'mb']);
  assert.deepEqual((await req('GET', '/api/trainer/members', 'tr2')).body.members.map(m => m.id), ['ma', 'mb']);
  assert.deepEqual((await req('GET', '/api/trainer/members', 'ad')).body.members.map(m => m.id).sort(), ['ad', 'ma', 'mb', 'tr1', 'tr2']);
});

test('assignments are organizational only; role demotion still revokes trainer access', async () => {
  assert.equal((await req('GET', '/api/trainer/member-plan?id=mb', 'tr1')).status, 200);
  assert.equal((await req('POST', '/api/admin/user/trainers', 'ad', { id: 'mb', trainerIds: ['tr1'] })).status, 200);
  assert.equal((await req('GET', '/api/trainer/member-plan?id=mb', 'tr1')).status, 200);
  assert.equal((await req('POST', '/api/admin/user/trainers', 'ad', { id: 'mb', trainerIds: [] })).status, 200);
  assert.equal((await req('GET', '/api/trainer/member-plan?id=mb', 'tr1')).status, 200);
  assert.equal((await req('POST', '/api/admin/user/trainer', 'ad', { id: 'tr1', trainer: false })).status, 200);
  assert.equal((await req('GET', '/api/trainer/member-plan?id=ma', 'tr1')).status, 403, 'a demoted trainer is a plain member');
});

test('trainers cannot access admin-only user, role, assignment or operations controls', async () => {
  for (const [method, route, body] of [
    ['GET', '/api/admin/users'], ['GET', '/api/admin/ops'],
    ['POST', '/api/admin/user/role', { id: 'mb', role: 'admin' }],
    ['POST', '/api/admin/user/trainers', { id: 'mb', trainerIds: ['tr2'] }],
  ]) assert.equal((await req(method, route, 'tr2', body)).status, 403, `${method} ${route}`);
  assert.equal((await req('GET', '/api/admin/users', 'ad')).status, 200, 'admin access is unchanged');
});

/* ---- completeness: a new member-targeting trainer route cannot slip in unscoped ---- */
// Routes gated by requireTrainer that are NOT about one member. Each one, and why it is safe role-only:
const GLOBAL_ROLE_ONLY = {
  'POST /api/social/board': 'gym-wide notice board post (no member data read or written)',
  'POST /api/social/challenges/new': 'gym-wide challenge (authored content, no member data)',
  'POST /api/exercises/alias': 'gym-wide machine → exercise alias (key, exercise id, name); no member id, no member data',
  'POST /api/exercises/import-alias': 'gym-wide import alias for exercise names; no member id, no member data',
  'GET /api/trainer/members': 'the member picker; only member accounts, no admin-only profile fields',
  'GET /api/trainer/followup/overview': 'scoped inside the handler (all active member accounts; no staff)',
};
test('every requireTrainer route either scopes its member through the shared guard or is a documented global route', () => {
  const server = fs.readFileSync(path.resolve('server.js'), 'utf8').replace(/\r\n/g, '\n');
  const routes = [...server.matchAll(/^  '((?:GET|POST|PUT|DELETE) \/api\/[^']+)': async \(req, res\) => \{\n([\s\S]*?)\n  \},?\n/gm)];
  const staffRoutes = routes.filter(m => /requireTrainer\(req, res\)/.test(m[2]));
  assert.ok(staffRoutes.length >= 12, 'found the trainer routes: ' + staffRoutes.length);
  const unscoped = staffRoutes.filter(m => !/memberFor\(|canAccessMember\(/.test(m[2])).map(m => m[1]).filter(k => !(k in GLOBAL_ROLE_ONLY));
  assert.deepEqual(unscoped, [], 'trainer routes without the member guard (scope them, or document them as global): ' + unscoped.join(', '));
  // the route modules the server composes in: blocks / guided are gym-wide content libraries (no member id anywhere)
  for (const f of ['lib/blocks-routes.js', 'lib/guided-routes.js']) assert.ok(!/memberId|db\.users|readState/.test(fs.readFileSync(path.resolve(f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')), f + ' is gym-wide content only');
});

test.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
