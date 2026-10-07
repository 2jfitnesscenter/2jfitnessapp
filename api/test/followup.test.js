import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { sanitizeFollowUp, followUpSummary, addReview, nextReview, templateKeys } from '../lib/followup.js';

/* Seguimiento V2 — deterministic summary/alerts, and the access model: admin staff only,
 * check-ins only with the member's consent, plain trainers and members get 403. */

const member = over => ({
  week: { mon: 'r1', wed: 'r2', fri: 'r3' },
  workouts: [
    { id: 'a', d: '2026-09-02', prs: [{}] },
    { id: 'b', d: '2026-09-10', prs: [{}, {}] },
    { id: 'c', d: '2026-09-12', prs: [] },
  ],
  bodyweight: [{ d: '2026-08-30', w: 82 }, { d: '2026-09-12', w: 80.6 }],
  measurements: { waist: [{ d: '2026-08-30', v: 90 }, { d: '2026-09-12', v: 88.5 }] },
  checkins: [
    { d: '2026-09-08', energy: 2, sleep: 2, fatigue: 5, pain: true, zones: ['knee'] },
    { d: '2026-09-10', energy: 3, sleep: 2, fatigue: 4, pain: true, zones: ['knee'] },
    { d: '2026-09-12', energy: 2, sleep: 3, fatigue: 4, pain: true, zones: ['knee'] },
  ],
  ...over,
});

test('templates, cadence and validation', () => {
  const today = '2026-09-01';
  assert.equal(sanitizeFollowUp({ template: 'x', cadence: 'weekly' }, null, today).error, 'plantilla no válida');
  assert.ok(sanitizeFollowUp({ template: 'basic', cadence: 'custom', days: 1 }, null, today).error);
  const f = sanitizeFollowUp({ template: 'custom', keys: ['waist', 'bogus', 'waist'], cadence: 'custom', days: 21 }, null, today).value;
  assert.deepEqual(f, { template: 'custom', keys: ['waist'], cadence: 'custom', days: 21, startedAt: today, reviews: [] });
  assert.ok(templateKeys({ template: 'pro' }).length > templateKeys({ template: 'intermediate' }).length);
  assert.equal(nextReview(f), '2026-09-22');
  const r = addReview(addReview(f, '2026-09-20', 's1'), '2026-09-20', 's1');
  assert.equal(r.reviews.length, 1);
  assert.equal(nextReview(r), '2026-10-11');
});

test('summary since the last review is facts only; check-ins need consent', () => {
  const f = { template: 'basic', cadence: 'weekly', days: 7, startedAt: '2026-09-01', reviews: [] };
  const { summary, alerts } = followUpSummary(member(), f, '2026-09-13');
  assert.equal(summary.from, '2026-09-01');
  assert.equal(summary.workouts, 3);
  assert.equal(summary.prs, 3);
  assert.equal(summary.plannedPerWeek, 3);
  assert.deepEqual(summary.weight, { start: 82, startDate: '2026-08-30', end: 80.6, endDate: '2026-09-12', delta: -1.4 });
  assert.equal(summary.measurements.waist.delta, -1.5);
  assert.equal(summary.checkins, null, 'not shared → not included');
  assert.deepEqual(alerts, [{ code: 'review_overdue', days: 5 }]);

  const shared = followUpSummary(member({ shareCheckins: true }), f, '2026-09-13');
  assert.equal(shared.summary.checkins.count, 3);
  assert.deepEqual(shared.alerts.map(a => a.code), ['review_overdue', 'high_fatigue', 'repeated_discomfort']);
  assert.doesNotMatch(JSON.stringify(shared), /injur|overtrain|risk|diagnos/i);

  const idle = followUpSummary(member(), null, '2026-10-01');
  assert.deepEqual(idle.alerts, [{ code: 'no_recent_workouts', days: 19 }]);
});

/* ---------- endpoints, real spawned server (same harness as put-data-reconciliation) ---------- */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'followup-'));
const SECRET = 'e'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'u1', name: 'Member' }, { id: 'u2', name: 'Other member' }, { id: 'tr', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Staff', admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
fs.writeFileSync(path.join(dir, 'state-u1.json'), JSON.stringify(member()));
const PORT = 34581;
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
const cookieFor = uid => {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
};
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch {}
  return { status: r.status, body: j };
}

test('only admin staff can read or change a member follow-up (no IDOR for trainers or members)', async () => {
  assert.equal((await req('GET', '/api/admin/user/followup?id=u1')).status, 401);
  for (const uid of ['u2', 'tr', 'u1']) {
    assert.equal((await req('GET', '/api/admin/user/followup?id=u1', uid)).status, 403, uid);
    assert.equal((await req('POST', '/api/admin/user/followup', uid, { id: 'u1', template: 'basic', cadence: 'weekly' })).status, 403, uid);
    assert.equal((await req('POST', '/api/admin/user/review', uid, { id: 'u1' })).status, 403, uid);
  }
  const set = await req('POST', '/api/admin/user/followup', 'ad', { id: 'u1', template: 'intermediate', cadence: 'biweekly' });
  assert.equal(set.status, 200);
  const got = await req('GET', '/api/admin/user/followup?id=u1', 'ad');
  assert.equal(got.body.followUp.days, 14);
  assert.equal(got.body.summary.checkins, null, 'check-ins stay private without consent');
  assert.equal((await req('POST', '/api/admin/user/review', 'ad', { id: 'u1' })).body.followUp.reviews.length, 1);
  // The member sees only their own schedule, never who reviewed.
  const mine = await req('GET', '/api/followup', 'u1');
  assert.equal(mine.body.active, true);
  assert.equal(JSON.stringify(mine.body).includes('ad'), false);
  assert.deepEqual((await req('GET', '/api/followup', 'u2')).body, { active: false });
  assert.equal((await req('POST', '/api/admin/user/followup', 'ad', { id: 'u1', stop: true })).body.followUp, null);
});

test('private follow-up notes are encrypted at rest and visible only on the admin follow-up route', async () => {
  assert.equal((await req('POST', '/api/admin/user/followup', 'ad', { id: 'u1', template: 'basic', cadence: 'monthly' })).status, 200);
  const note = 'Seguimiento privado - revisar adherencia';
  assert.equal((await req('POST', '/api/admin/user/followup/notes', 'tr', { id: 'u1', notes: note })).status, 403);
  assert.equal((await req('POST', '/api/admin/user/followup/notes', 'ad', { id: 'u1', notes: note })).status, 200);
  const rawDb = fs.readFileSync(path.join(dir, 'db.json'), 'utf8');
  assert.ok(!rawDb.includes(note), 'plaintext note is not persisted in db.json');
  assert.match(rawDb, /privateNotesEncrypted/);
  const adminView = await req('GET', '/api/admin/user/followup?id=u1', 'ad');
  assert.equal(adminView.body.privateNotes, note);
  assert.equal(adminView.body.privateHistory[0].action, 'note_updated');
  assert.equal((await req('GET', '/api/admin/users', 'ad')).body.users.some(u => JSON.stringify(u).includes(note)), false);
  const memberView = await req('GET', '/api/followup', 'u1');
  assert.deepEqual(Object.keys(memberView.body).sort(), ['active', 'days', 'lastReview', 'nextReview', 'template']);
  assert.equal(JSON.stringify(memberView.body).includes(note), false);
  assert.equal((await req('POST', '/api/admin/user/followup/notes', 'ad', { id: 'u1', notes: 'x'.repeat(2001) })).status, 400);
});

test.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
