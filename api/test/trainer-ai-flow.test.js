import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* The trainer panel's "Generate with AI", end to end over HTTP against a real server process. Only the model call is replaced (the deterministic fixture provider,
 * loaded with node --import ./test/trainer-ai-preload.mjs): request → ACL → member's staff-AI consent → job → generateWithRepair → validation/protocol gate →
 * pending draft → the panel saves each routine (POST /api/trainer/member-routine, exactly like PlanReviewCard) → the member's plan shows them. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trainer-ai-flow-'));
const SECRET = 'c'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [
    { id: 'tr1', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Admin', admin: true },
    { id: 'm1', name: 'Member With Consent', created: '2026-01-01T00:00:00.000Z' }, { id: 'm2', name: 'Member Without Consent', created: '2026-01-01T00:00:00.000Z' },
    { id: 'm3', name: 'Another Member', created: '2026-01-01T00:00:00.000Z' },
  ], creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const OLD = [{ id: 'old', name: 'Rutina vieja', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 8 }] }];
const consent = { staffAi: { consent: { agreedAt: new Date().toISOString(), version: 1 } } };
const st = over => JSON.stringify({ routines: OLD, programs: [], workouts: [{ id: 'w1', d: '2026-09-01', routineId: 'old', entries: [] }], week: {}, ...over });
fs.writeFileSync(path.join(dir, 'state-m1.json'), st(consent));
fs.writeFileSync(path.join(dir, 'state-m2.json'), st({}));
fs.writeFileSync(path.join(dir, 'state-m3.json'), st(consent));
const PORT = 34897, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['--import', './test/trainer-ai-preload.mjs', 'server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
}
const setMode = m => fs.writeFileSync(path.join(dir, 'fixture-mode.txt'), m);
const calls = () => { try { return fs.readFileSync(path.join(dir, 'provider-calls.log'), 'utf8').trim().split('\n').filter(Boolean).length; } catch { return 0; } };
const BRIEF = { goal: 'hypertrophy', experience: 'regular', daysPerWeek: 3, preferredDays: [1, 3, 5], sessionMin: 45, equipment: [], limitations: '', likes: '', dislikes: '', notes: '', structuralAnalysis: [] };
const generate = (trainer, memberId) => req('POST', '/api/trainer/ai/generate', trainer, { memberId, brief: BRIEF });
async function settle(trainer, memberId, ms = 30000) {
  const until = Date.now() + ms; const states = [];
  while (Date.now() < until) {
    const s = await req('GET', `/api/trainer/ai/status?memberId=${memberId}`, trainer);
    states.push(s.body.job ? s.body.job.state : 'finished');
    if (!s.body.job) return { ...s.body, states };
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('the job never finished (stuck)');
}
const plan = (uid, memberId) => req('GET', `/api/trainer/member-plan?id=${memberId}`, uid).then(r => r.body);
// what PlanReviewCard sends for each routine of the draft
async function saveDraft(trainer, memberId, bundle) {
  let sync = (await plan(trainer, memberId)).sync; const ids = [];
  for (const r of bundle.routines) {
    const customExDefs = (bundle.customEx || []).filter(c => r.ex.some(e => e.id === c.id));
    const res = await req('POST', '/api/trainer/member-routine', trainer, { sync, memberId, name: r.name, emoji: r.emoji, ex: r.ex, customExDefs, prog: r.prog, blocks: r.blocks,
      meta: bundle.protocol ? { goal: bundle.protocol.goal, level: bundle.protocol.level } : undefined, operationId: crypto.randomUUID() });
    assert.equal(res.status, 200, JSON.stringify(res.body)); ids.push(res.body.routineId); sync = res.body.sync;
  }
  return ids;
}

test('1-9: an authorised trainer generates a routine for a member who allowed staff AI: job runs, draft is valid, it is saved on THAT member and shows in their plan', async () => {
  setMode('');
  const before = calls();
  const status0 = await req('GET', '/api/trainer/ai/status?memberId=m1', 'tr1');
  assert.equal(status0.body.consent, true, 'the panel is told the member allowed staff AI');
  const g = await generate('tr1', 'm1');
  assert.equal(g.status, 202); assert.ok(g.body.job.id, 'the job exists');
  const done = await settle('tr1', 'm1');
  assert.ok(done.states.some(s => s === 'queued' || s === 'running'), 'it was queued/running while it worked');
  assert.equal(done.errorClass, null);
  assert.ok(calls() > before, 'the provider was really called');
  const bundle = done.pending.bundle;
  assert.ok(bundle.routines.length >= 1 && bundle.routines.every(r => r.ex.length && r.ex.every(e => e.id && e.sets)), 'a valid draft (exercises with sets)');
  const ids = await saveDraft('tr1', 'm1', bundle);
  const p1 = await plan('tr1', 'm1');
  assert.equal(p1.routines.length, 1 + bundle.routines.length, 'the old routine stays, the new ones are added');
  for (const id of ids) assert.ok(p1.routines.some(r => r.id === id && r.ex.length > 0));
  assert.equal((await plan('tr1', 'm3')).routines.length, 1, 'another member is untouched');
  assert.equal((await req('GET', '/api/data', 'm1')).body.state.workouts.length, 1, 'history untouched');
  assert.equal((await req('POST', '/api/trainer/ai/discard', 'tr1', { memberId: 'm1' })).status, 200);
  assert.equal((await req('GET', '/api/trainer/ai/status?memberId=m1', 'tr1')).body.pending, null);
});

test('admin can generate too', async () => {
  setMode('');
  assert.equal((await generate('ad', 'm3')).status, 202);
  const done = await settle('ad', 'm3'); assert.ok(done.pending?.bundle?.routines?.length);
  await req('POST', '/api/trainer/ai/discard', 'ad', { memberId: 'm3' });
});

test('10: provider failure → the job ends failed with a class, no pending draft, no routine saved', async () => {
  setMode('auth');
  assert.equal((await generate('tr1', 'm3')).status, 202);
  const done = await settle('tr1', 'm3');
  assert.equal(done.errorClass, 'auth'); assert.equal(done.pending, null);
  assert.equal((await plan('tr1', 'm3')).routines.length, 1, 'nothing partial was saved');
  await req('POST', '/api/trainer/ai/discard', 'tr1', { memberId: 'm3' });
});

test('11: an answer that breaks the 2J protocol even after the repair rounds → failed (unusable), nothing saved, the repair was attempted', async () => {
  setMode('protocol-fail');
  const before = calls();
  assert.equal((await generate('tr1', 'm3')).status, 202);
  const done = await settle('tr1', 'm3');
  assert.equal(done.errorClass, 'unusable'); assert.equal(done.pending, null);
  assert.ok(calls() - before >= 2, 'the model was asked again with the errors (repair)');
  assert.equal((await plan('tr1', 'm3')).routines.length, 1);
  await req('POST', '/api/trainer/ai/discard', 'tr1', { memberId: 'm3' });
});

test('12: the member did not allow staff AI → 403 with code consent, the provider is never called, and the status tells the panel up front', async () => {
  setMode('');
  const before = calls();
  const s = await req('GET', '/api/trainer/ai/status?memberId=m2', 'tr1');
  assert.equal(s.body.consent, false);
  const g = await generate('tr1', 'm2');
  assert.equal(g.status, 403); assert.equal(g.body.code, 'consent'); assert.match(g.body.error, /consentimiento/);
  assert.equal(calls(), before, 'nothing about the member was sent');
});

test('13: no access → 403 (a member cannot use the trainer endpoints; anonymous → 401)', async () => {
  assert.equal((await generate('m1', 'm3')).status, 403);
  assert.equal((await req('GET', '/api/trainer/ai/status?memberId=m3', 'm1')).status, 403);
  assert.equal((await generate(null, 'm3')).status, 401);
  assert.equal((await generate('tr1', 'ghost')).status, 403);
});

test('14: no job is left running/queued: every job above ended, and the job file holds none', async () => {
  const f = path.join(dir, 'trainer-ai-jobs.json');
  const rows = JSON.parse(fs.readFileSync(f, 'utf8')).jobs;
  assert.ok(!rows.some(j => j.state === 'queued' || j.state === 'running'), JSON.stringify(rows.map(j => j.state)));
  assert.ok(rows.every(j => !j.brief), 'the request is dropped once the job ends');
});

test.after(() => { child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
