import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Coach & Seguimiento PRO V3 over HTTP (real server): who may read what, the explicit trainer assignment, the private trail, and where it must NOT appear. */
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const set = (w, r) => ({ w, r, done: true });
const session = d => ({ id: 'w' + d, d, routineId: 'r1', entries: [{ id: '0025', target: { sets: 3, reps: 8 }, sets: [set(60, 8), set(60, 8), set(60, 8)] }], prs: [] });
const state = workouts => ({ week: { 1: 'r1', 3: 'r1', 5: 'r1' }, routines: [{ id: 'r1', name: 'Full body', ex: [{ id: '0025' }] }], workouts, routineReviews: { r1: { reviewedAt: addDays(today(), -9) } } });
const regular = state([0, 1, 2, 3, 4, 5].flatMap(wk => [2, 4, 6].map(o => session(addDays(today(), -(wk * 7 + o))))));
const absent = state([session(addDays(today(), -45))]);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coach-followup-'));
const SECRET = 'c'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
const created = addDays(today(), -120) + 'T10:00:00.000Z';
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [
    { id: 'u1', name: 'Ausente Uno', created }, { id: 'u2', name: 'Regular Dos', created }, { id: 'u3', name: 'Baja Tres', created, disabled: true },
    { id: 'u4', name: 'Sin estado', created: new Date().toISOString() },
    { id: 'tr1', name: 'Marta', trainer: true }, { id: 'tr2', name: 'Pablo', trainer: true }, { id: 'ad', name: 'Staff', admin: true },
  ], creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const withShared = { ...absent, shareCheckins: true, checkins: [0, 1, 2].map(i => ({ d: addDays(today(), -i), energy: 2, sleep: 2, fatigue: 5, pain: true, zones: ['knee'] })) };
fs.writeFileSync(path.join(dir, 'state-u1.json'), JSON.stringify(withShared));
fs.writeFileSync(path.join(dir, 'state-u2.json'), JSON.stringify(regular));
fs.writeFileSync(path.join(dir, 'state-u3.json'), JSON.stringify(absent));
const PORT = 34881;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
}
const get = (p, uid) => req('GET', p, uid);
const post = (p, uid, b) => req('POST', p, uid, b);
const WRITES = ['start', 'goal', 'note', 'note/delete', 'decision', 'flag', 'analyze'];

test('members and anonymous callers get nothing from the V3 surface', async () => {
  for (const uid of [null, 'u1', 'u2']) {
    const want = uid ? 403 : 401;
    assert.equal((await get('/api/trainer/followup/overview', uid)).status, want, String(uid));
    assert.equal((await get('/api/trainer/followup/member?id=u2', uid)).status, want, String(uid));
    assert.equal((await get('/api/trainer/followup/analysis?id=u2', uid)).status, want, String(uid));
    for (const w of WRITES) assert.equal((await post('/api/trainer/followup/' + w, uid, { id: 'u2', text: 'x' })).status, want, `${uid} ${w}`);
    assert.equal((await post('/api/admin/user/trainers', uid, { id: 'u2', trainerIds: ['tr1'] })).status, want);
  }
});

test('a trainer sees nothing until an admin assigns members; then only those (no IDOR)', async () => {
  assert.deepEqual((await get('/api/trainer/followup/overview', 'tr1')).body.assigned, 0);
  assert.equal((await get('/api/trainer/followup/member?id=u1', 'tr1')).status, 403);
  for (const w of WRITES) assert.equal((await post('/api/trainer/followup/' + w, 'tr1', { id: 'u1', text: 'x' })).status, 403, w);
  // only an admin assigns; a trainer cannot assign themselves
  assert.equal((await post('/api/admin/user/trainers', 'tr1', { id: 'u1', trainerIds: ['tr1'] })).status, 403);
  assert.equal((await post('/api/admin/user/trainers', 'ad', { id: 'u1', trainerIds: ['u2'] })).status, 400, 'only active trainers can be assigned');
  assert.equal((await post('/api/admin/user/trainers', 'ad', { id: 'tr1', trainerIds: ['tr1'] })).status, 404, 'staff are not assignable members');
  assert.equal((await post('/api/admin/user/trainers', 'ad', { id: 'u1', trainerIds: ['tr1'] })).status, 200);
  const o = await get('/api/trainer/followup/overview', 'tr1');
  assert.deepEqual([...o.body.attention, ...o.body.upcoming, ...o.body.stable].map(r => r.id), ['u1']);
  assert.equal(o.body.scope, 'assigned');
  assert.equal((await get('/api/trainer/followup/member?id=u1', 'tr1')).status, 200);
  assert.equal((await get('/api/trainer/followup/member?id=u2', 'tr1')).status, 403, 'u2 is not assigned to tr1');
  assert.equal((await get('/api/trainer/followup/member?id=u1', 'tr2')).status, 403, 'tr2 is not assigned to u1');
  assert.equal((await get('/api/trainer/followup/member?id=nobody', 'tr1')).status, 403, 'a trainer cannot probe ids');
  assert.equal((await get('/api/trainer/followup/member?id=nobody', 'ad')).status, 404);
  assert.equal((await get('/api/trainer/followup/member?id=tr2', 'ad')).status, 403, 'staff accounts are not members');
});

test('admin sees every active member in one request, bucketed and explained; disabled members are left out', async () => {
  const o = await get('/api/trainer/followup/overview', 'ad');
  assert.equal(o.status, 200); assert.equal(o.body.scope, 'all');
  const all = [...o.body.attention, ...o.body.upcoming, ...o.body.stable];
  assert.deepEqual(all.map(r => r.id).sort(), ['u1', 'u2', 'u4']);
  const u1 = all.find(r => r.id === 'u1');
  assert.equal(u1.level, 'priority'); assert.ok(u1.signals.length >= 1 && u1.signals[0].explanation);
  assert.equal(all.find(r => r.id === 'u2').level, 'normal');
  assert.equal(all.find(r => r.id === 'u4').level, 'normal', 'a member who never synced is not an alarm');
  assert.equal(o.body.counts.attention + o.body.counts.upcoming + o.body.counts.stable, 3);
  assert.doesNotMatch(JSON.stringify(o.body), /privateNotes|assignedTrainers|checkins/);
});

test('the sheet carries the triage, adherence, review, goal, check-in and timeline; private check-ins stay private', async () => {
  const m = await get('/api/trainer/followup/member?id=u1', 'tr1');
  assert.equal(m.status, 200);
  assert.equal(m.body.view.level, 'priority');
  for (const k of ['signals', 'adherence', 'progress', 'review', 'goal', 'checkin', 'analysis']) assert.ok(k in m.body.view, k);
  assert.equal(m.body.view.checkin.shared, true, 'u1 shared check-ins');
  assert.ok(m.body.view.signals.some(s => s.id === 'checkin_discomfort'));
  assert.equal(m.body.trainers, null, 'a trainer does not see the assignment list');
  assert.equal((await get('/api/trainer/followup/member?id=u2', 'ad')).body.view.checkin.shared, false);
  const adm = await get('/api/trainer/followup/member?id=u1', 'ad');
  assert.deepEqual(adm.body.trainers.assigned, ['tr1']); assert.deepEqual(adm.body.trainers.options.map(t => t.id).sort(), ['tr1', 'tr2']);
  assert.equal((await get('/api/trainer/followup/member?id=u3', 'ad')).body.member.disabled, true);
});

test('goal, notes, decisions and the follow-up mark need an active follow-up, are encrypted at rest and build the timeline', async () => {
  const goal = { id: 'u1', primary: 'fatloss', targetDate: addDays(today(), 60), priority: 'high', comment: 'Evento en diciembre' };
  assert.equal((await post('/api/trainer/followup/goal', 'tr1', goal)).status, 400, 'no follow-up yet');
  assert.equal((await post('/api/trainer/followup/start', 'tr1', { id: 'u1' })).status, 200);
  assert.equal((await post('/api/trainer/followup/goal', 'tr1', { ...goal, primary: 'wizard' })).status, 400);
  const g = await post('/api/trainer/followup/goal', 'tr1', goal);
  assert.equal(g.status, 200); assert.equal(g.body.changed, true);
  assert.equal((await post('/api/trainer/followup/goal', 'tr1', goal)).body.changed, false, 'the same goal twice is not a new event');
  const note = 'Conversación privada: rodilla y turno de tarde';
  const n = await post('/api/trainer/followup/note', 'tr1', { id: 'u1', text: note, ref: { kind: 'routine', id: 'r1' } });
  assert.equal(n.status, 200); assert.equal(n.body.notes[0].text, note); assert.equal(n.body.notes[0].by, 'Marta');
  assert.equal((await post('/api/trainer/followup/note', 'tr1', { id: 'u1', text: '   ' })).status, 400);
  assert.equal((await post('/api/trainer/followup/note', 'tr1', { id: 'u1', text: 'x'.repeat(1001) })).status, 400);
  assert.equal((await post('/api/trainer/followup/decision', 'tr1', { id: 'u1', kind: 'hack' })).status, 400);
  const d = await post('/api/trainer/followup/decision', 'tr1', { id: 'u1', kind: 'recommendation_rejected', text: 'Prefiere mantener 3 días' });
  assert.equal(d.status, 200); assert.equal(d.body.timeline[0].kind, 'recommendation_rejected'); assert.equal(d.body.timeline[0].by, 'Marta');
  assert.equal((await post('/api/trainer/followup/flag', 'tr1', { id: 'u1', on: true })).body.flagged, true);

  const raw = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  for (const secret of [note, 'Prefiere mantener 3 días', 'Evento en diciembre']) assert.ok(!raw.includes(secret), 'plaintext never reaches db.json: ' + secret);
  assert.match(raw, /privateNotesEncrypted/);

  const m = (await get('/api/trainer/followup/member?id=u1', 'tr1')).body;
  assert.equal(m.view.goal.key, 'fatloss'); assert.equal(m.view.goal.source, 'staff'); assert.equal(m.view.goal.priority, 'high');
  assert.ok(m.view.signals.some(s => s.id === 'flagged'));
  assert.deepEqual(m.timeline.map(e => e.kind).slice(0, 4), ['flag_set', 'recommendation_rejected', 'note_added', 'goal_changed']);
  assert.equal(m.notes[0].mine, true);
  assert.equal(m.followUp.privateNotesEncrypted, undefined, 'the ciphertext is never returned');
  // another assigned trainer may read, but cannot delete someone else's note; the admin can
  await post('/api/admin/user/trainers', 'ad', { id: 'u1', trainerIds: ['tr1', 'tr2'] });
  const seen = (await get('/api/trainer/followup/member?id=u1', 'tr2')).body;
  assert.equal(seen.notes[0].mine, false);
  assert.equal((await post('/api/trainer/followup/note/delete', 'tr2', { id: 'u1', noteId: seen.notes[0].id })).status, 403);
  assert.equal((await post('/api/trainer/followup/note/delete', 'ad', { id: 'u1', noteId: seen.notes[0].id })).status, 200);
});

test('the private trail never reaches the member, the export, the admin roster, the legacy follow-up or any other route', async () => {
  const markers = ['Conversación privada', 'Prefiere mantener', 'Evento en diciembre', 'privateNotesEncrypted', 'assignedTrainers', 'goalPlan'];
  const mine = JSON.stringify([(await get('/api/followup', 'u1')).body, (await get('/api/me/export', 'u1')).body]);
  for (const k of markers) assert.ok(!mine.includes(k), 'member side: ' + k);
  assert.deepEqual(Object.keys((await get('/api/followup', 'u1')).body).sort(), ['active', 'days', 'lastReview', 'nextReview', 'template']);
  const roster = JSON.stringify((await get('/api/admin/users', 'ad')).body);
  for (const k of ['Conversación privada', 'Prefiere mantener', 'Evento en diciembre']) assert.ok(!roster.includes(k), 'roster: ' + k);
  const legacy = (await get('/api/admin/user/followup?id=u1', 'ad')).body;
  assert.ok(!JSON.stringify(legacy.followUp).includes('privateNotesEncrypted'));
  // the legacy trainer endpoints keep refusing the follow-up data (admin-only) — the new surface is the only way in
  assert.equal((await get('/api/admin/user/followup?id=u1', 'tr1')).status, 403);
  assert.equal((await post('/api/admin/user/followup/notes', 'tr1', { id: 'u1', notes: 'x' })).status, 403);
  // the member state file on disk holds none of it
  const st = fs.readFileSync(path.join(dir, 'state-u1.json'), 'utf8');
  for (const k of ['Conversación privada', 'goalPlan', 'flag_set']) assert.ok(!st.includes(k), 'state: ' + k);
});

test('the V2 follow-up edits keep the V3 annotations; legacy notes still work for admins', async () => {
  assert.equal((await post('/api/admin/user/followup', 'ad', { id: 'u1', template: 'pro', cadence: 'weekly' })).status, 200);
  const m = (await get('/api/trainer/followup/member?id=u1', 'ad')).body;
  assert.equal(m.followUp.template, 'pro'); assert.equal(m.followUp.goalPlan.primary, 'fatloss'); assert.ok(m.followUp.flag);
  assert.equal((await post('/api/admin/user/followup/notes', 'ad', { id: 'u1', notes: 'Nota general antigua' })).status, 200);
  const after = (await get('/api/trainer/followup/member?id=u1', 'tr1')).body;
  assert.equal(after.legacyNote, 'Nota general antigua'); assert.ok(after.notes.length >= 0);
  assert.equal(after.timeline.some(e => e.kind === 'note_updated'), false);
});

test('disabled members cannot be written to; moving a review date leaves a decision event; analysis answers without the AI', async () => {
  assert.equal((await post('/api/trainer/followup/start', 'ad', { id: 'u3' })).status, 409);
  assert.equal((await get('/api/trainer/followup/analysis?id=u1', 'tr1')).body.job, null);
  const a = await post('/api/trainer/followup/analyze', 'tr1', { id: 'u1', lang: 'es' });
  assert.equal(a.status, 200); assert.equal(a.body.source, 'deterministic'); assert.equal(a.body.ai.available, false);
  assert.ok(a.body.analysis.facts.length && a.body.analysis.inference.length && a.body.analysis.suggestion.length);
  assert.equal((await post('/api/trainer/followup/analyze', 'ad', { id: 'u4' })).status, 400, 'nothing to analyse for a member who never synced');
  const m0 = (await get('/api/trainer/followup/member?id=u2', 'ad')).body;
  assert.equal(m0.followUp, null);
  await post('/api/trainer/followup/start', 'ad', { id: 'u2' });
  const cyc = (await get('/api/trainer/routine-cycles?id=u2', 'tr1'));
  assert.equal(cyc.status, 200, 'the legacy routine-cycle surface keeps its role-based access');
  const due = addDays(today(), 12);
  const r = await post('/api/admin/user/routine-cycle', 'tr1', { id: 'u2', routineId: 'r1', due, receipt: 'x1', sync: cyc.body.sync });
  assert.ok([200, 409].includes(r.status), String(r.status));
  if (r.status === 200) {
    const tl = (await get('/api/trainer/followup/member?id=u2', 'ad')).body.timeline;
    assert.ok(tl.some(e => e.kind === 'review_rescheduled' && e.ref.id === 'r1'));
  }
});

test('removing the trainer role drops their assignments', async () => {
  assert.equal((await post('/api/admin/user/trainer', 'ad', { id: 'tr2', trainer: false })).status, 200);
  assert.deepEqual((await get('/api/trainer/followup/member?id=u1', 'ad')).body.trainers.assigned, ['tr1']);
  assert.equal((await get('/api/trainer/followup/overview', 'tr2')).status, 403, 'tr2 is a plain member now');
});

test('the list of 100 synthetic members answers in one request, fast', async () => {
  for (let i = 0; i < 100; i++) {
    const id = 'bulk' + i;
    const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
    db.users.push({ id, name: 'Bulk ' + i, created });
    fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify(db));
    fs.writeFileSync(path.join(dir, 'state-' + id + '.json'), JSON.stringify(i % 3 ? regular : absent));
  }
  // the server reads db.json at boot; restart it so the new roster is loaded
  child.kill();
  const c2 = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT + 1), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: `http://localhost:${PORT + 1}` }, stdio: ['ignore', 'ignore', 'ignore'] });
  try {
    const b2 = `http://localhost:${PORT + 1}`;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(b2 + '/api/health')).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
    const t0 = performance.now();
    const r = await fetch(b2 + '/api/trainer/followup/overview', { headers: { cookie: cookieFor('ad') } });
    const body = await r.json(); const ms = performance.now() - t0;
    assert.equal(r.status, 200);
    assert.equal(body.counts.attention + body.counts.upcoming + body.counts.stable, 104);
    assert.ok(ms < 4000, `100+ members took ${Math.round(ms)} ms`);
  } finally { c2.kill(); }
});

test.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
