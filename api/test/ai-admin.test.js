// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The three AI profiles behind Admin → Artificial intelligence, over HTTP on a real server: the member Coach really runs
 * end to end (fixture provider → plan proposal), and the trainer-panel AI and the auxiliary AI keep answering their admin
 * endpoints with structured, honest states — including "no credential" and a rejected credential, which is what a failing
 * real provider looks like. Only an admin reaches any of them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-admin-'));
const SECRET = 'b'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'm1', name: 'Member' }, { id: 't1', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Admin', admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
fs.writeFileSync(path.join(dir, 'state-m1.json'), JSON.stringify({
  unit: 'kg', lang: 'en', onboarded: true, coach: { consent: { agreedAt: new Date().toISOString(), version: 1 }, profile: { goal: 'muscle', daysPerWeek: 3, equipment: ['dumbbell'] } },
  routines: [], week: {}, dayPlan: {}, exWeights: {}, bodyweight: [], customEx: [], workouts: [],
}));
const PORT = 34630, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base, FIXTURE_MODE: '' }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* booting */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
}
test.after(() => { child.kill(); });

const ADMIN_URLS = ['/api/admin/coach', '/api/admin/trainer-ai', '/api/admin/aux-ai'];

test('the three AI profiles are admin-only: anonymous 401, member and trainer 403', async () => {
  for (const u of ADMIN_URLS) {
    assert.equal((await req('GET', u)).status, 401, u);
    assert.equal((await req('GET', u, 'm1')).status, 403, u);
    assert.equal((await req('GET', u, 't1')).status, 403, u);
    assert.equal((await req('GET', u, 'ad')).status, 200, u);
    assert.equal((await req('POST', u + '/test', 'm1', {})).status, 403, u + '/test');
  }
});

test('each profile reports a state the admin screen can show: enabled, auth state, jobs today, last result', async () => {
  for (const u of ADMIN_URLS) {
    const d = (await req('GET', u, 'ad')).body;
    assert.equal(typeof d.enabled, 'boolean', u);
    assert.ok(d.auth && typeof d.auth.state === 'string', u);
    assert.equal(typeof d.jobsToday, 'number', u);
    assert.ok('lastError' in d && 'lastSuccess' in d, u);
  }
});

test('AI Coach (member): enabled with a provider, it answers a plan request end to end', async () => {
  assert.equal((await req('POST', '/api/admin/coach/config', 'ad', { enabled: true, provider: 'fixture' })).status, 200);
  const job = await req('POST', '/api/coach/plan', 'm1', { intake: { goal: 'muscle', daysPerWeek: 3, equipment: ['dumbbell'], experience: 'beginner' } });
  assert.equal(job.status, 202);
  let status;
  for (let i = 0; i < 40; i++) { await new Promise(r => setTimeout(r, 500)); status = (await req('GET', '/api/coach/status', 'm1')).body; if (status.pending) break; }
  assert.ok(status.pending, 'a proposal is waiting for the member: ' + JSON.stringify(status).slice(0, 200));
  assert.equal(status.pending.kind, 'create');
  assert.ok(status.pending.bundle && status.pending.bundle['2jfitness_plan'] === 1);
  const d = (await req('GET', '/api/admin/coach', 'ad')).body;
  assert.ok(d.jobsToday >= 1 && d.lastSuccess, 'the admin screen sees the successful run');
});

test('AI Coach: a provider without a credential or with a rejected one fails with the exact reason, never silently', async () => {
  await req('POST', '/api/admin/coach/config', 'ad', { provider: 'claude' });
  const none = (await req('POST', '/api/admin/coach/test', 'ad', {})).body;
  assert.equal(none.ok, false);
  assert.match(none.error, /Not logged in|login|credential|auth/i);
  const bad = (await req('POST', '/api/admin/coach/auth/setup-token', 'ad', { token: 'sk-ant-oat01-' + 'x'.repeat(60) })).body;
  assert.equal(bad.test.ok, false);
  assert.match(bad.test.error, /401|invalid|authenticate/i);
  await req('POST', '/api/admin/coach/config', 'ad', { provider: 'fixture' });
  assert.equal((await req('POST', '/api/coach/plan', 'm1', { intake: { goal: 'muscle' } })).status, 202, 'back on a working provider, requests are accepted again');
});

test('Trainer panel AI keeps working as before: config persists, test answers with a structured result', async () => {
  assert.equal((await req('POST', '/api/admin/trainer-ai/config', 'ad', { enabled: true })).status, 200);
  assert.equal((await req('GET', '/api/admin/trainer-ai', 'ad')).body.enabled, true);
  const r = (await req('POST', '/api/admin/trainer-ai/test', 'ad', {})).body;
  assert.equal(typeof r.ok, 'boolean');
  if (!r.ok) assert.ok(typeof r.error === 'string' && r.error.length > 0);
  assert.equal((await req('POST', '/api/admin/trainer-ai/config', 'ad', { enabled: false })).status, 200);
});

test('Auxiliary AI keeps working as before: capabilities listed, config persists, test says exactly what is missing', async () => {
  const d = (await req('GET', '/api/admin/aux-ai', 'ad')).body;
  assert.deepEqual(d.capabilities, ['exercise_import_matching', 'machine_scan', 'measurements_scan', 'routine_scan']);
  assert.equal((await req('POST', '/api/admin/aux-ai/config', 'ad', { enabled: true })).status, 200);
  assert.equal((await req('GET', '/api/admin/aux-ai', 'ad')).body.enabled, true);
  const r = (await req('POST', '/api/admin/aux-ai/test', 'ad', {})).body;
  assert.equal(r.ok, false);
  assert.match(r.error, /no API key connected/i);
});

test('the three stay isolated: switching one off or changing its provider does not touch the others', async () => {
  await req('POST', '/api/admin/aux-ai/config', 'ad', { enabled: false });
  assert.equal((await req('GET', '/api/admin/coach', 'ad')).body.enabled, true);
  assert.equal((await req('GET', '/api/admin/trainer-ai', 'ad')).body.enabled, false);
  assert.equal((await req('GET', '/api/admin/aux-ai', 'ad')).body.enabled, false);
});
