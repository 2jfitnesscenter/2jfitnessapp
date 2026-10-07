// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* AI stability: honest failure classes, retries only for transient failures, provider errors
 * never parsed as answers, tolerant JSON extraction, one protocol repair, isolated jobs. Member
 * review/create and trainer generation run end-to-end through the real queue with the fixture
 * provider; the Claude adapter's stream handling is fed fake SDK streams. No real AI calls. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const trainerAI = await import('../coach/trainer-ai.js');
const trainerJobs = await import('../coach/trainer-jobs.js');
const aiRun = await import('../coach/ai-run.js');
const { readStream } = await import('../coach/adapters/claude.js');
const { adapterFor } = await import('../coach/adapters/index.js');
const { extractJSON } = await import('../coach/validate.js');

aiRun.setBackoffForTests([0, 0]);
cfg.save({ enabled: true, provider: 'fixture' });
const quiet = () => { const log = console.log; console.log = () => {}; return () => { console.log = log; }; };

async function settle(uid, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = jobs.status(uid); if (!s.job) return s; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('job never finished');
}
async function runMember(uid, mode, kind = 'review') {
  writeState(DIR, uid, sampleState());
  process.env.FIXTURE_MODE = mode;
  const restore = quiet();
  try { jobs.enqueue(uid, { kind }); return await settle(uid); }
  finally { restore(); delete process.env.FIXTURE_MODE; }
}
const lastOf = uid => jobs.readUser(uid).history.at(-1);

/* ---------------- retry policy (unit) ---------------- */

const fake = results => { let i = 0; const a = { calls: 0, async invoke() { a.calls++; const r = results[Math.min(i++, results.length - 1)]; if (r instanceof Error) throw r; return r; } }; return a; };
const OK = { code: 0, text: '{"coach_contract":1}', stderr: '', timedOut: false, spawnError: false };

test('success on the first attempt: one call, no retry', async () => {
  const a = fake([OK]); const restore = quiet();
  const r = await aiRun.invokeWithRetry(a, {}, { flow: 't' }); restore();
  assert.equal(a.calls, 1); assert.equal(r.failure, undefined); assert.equal(r.attempts, 1);
});
test('timeout → retry → success', async () => {
  const a = fake([{ code: -1, text: '', stderr: 'timed out', timedOut: true }, OK]); const restore = quiet();
  const r = await aiRun.invokeWithRetry(a, {}, {}); restore();
  assert.equal(a.calls, 2); assert.equal(r.failure, undefined);
  // two timeouts in a row: stop there (a timeout window is minutes long), no third call
  const t = fake([{ code: -1, timedOut: true }, { code: -1, timedOut: true }, OK]); const r2 = quiet();
  const out = await aiRun.invokeWithRetry(t, {}, {}); r2();
  assert.equal(t.calls, 2); assert.equal(out.failure.errorClass, 'timeout');
});
test('5xx / 529 overloaded / 429 → retry → success', async () => {
  for (const err of [{ status: 503 }, { stderr: 'API Error: 529 {"type":"overloaded_error"}' }, { stderr: 'HTTP 429 Too Many Requests' }]) {
    const a = fake([{ code: 1, text: '', stderr: '', timedOut: false, spawnError: false, ...err }, OK]); const restore = quiet();
    const r = await aiRun.invokeWithRetry(a, {}, {}); restore();
    assert.equal(a.calls, 2, JSON.stringify(err)); assert.equal(r.failure, undefined);
  }
});
test('a crashed runtime and an empty answer are transient; at most 3 calls in total', async () => {
  const a = fake([new Error('Claude Code process exited with code 1'), { code: 0, text: '  ', stderr: '' }, { code: 1, text: '', stderr: 'API Error: 500' }]); const restore = quiet();
  const r = await aiRun.invokeWithRetry(a, {}, {}); restore();
  assert.equal(a.calls, 3); assert.equal(r.failure.errorClass, 'provider'); assert.equal(r.attempts, 3);
});
test('auth / config / missing runtime / bad request are never retried', async () => {
  const cases = [
    [{ code: 1, text: '', stderr: 'API Error: 401 authentication_error: invalid x-api-key' }, 'auth'],
    [{ code: 2, text: '', stderr: 'Incorrect API key provided', status: 401 }, 'auth'],
    [{ code: -1, text: '', stderr: 'spawn codex ENOENT', spawnError: true }, 'missing'],
    [{ code: 1, text: '', stderr: 'invalid_request: prompt is too long', status: 400 }, 'provider'],
  ];
  for (const [res, cls] of cases) {
    const a = fake([res, OK]); const restore = quiet();
    const r = await aiRun.invokeWithRetry(a, {}, {}); restore();
    assert.equal(a.calls, 1, res.stderr); assert.equal(r.failure.errorClass, cls); assert.equal(r.failure.transient, false);
  }
  // a dropped connection to port 443 is transient, not an HTTP 4xx
  assert.equal(aiRun.classify({ code: 1, stderr: 'connect ECONNREFUSED 10.0.0.1:443' }).transient, true)
  // "token" alone is not auth (e.g. max_tokens): classified as a plain provider error
  assert.equal(aiRun.classify({ code: 1, stderr: 'stop_reason max_tokens reached' }).errorClass, 'provider');
});

/* ---------------- Claude adapter: SDK stream handling ---------------- */

const stream = (msgs, throwAfter) => (async function* () { for (const m of msgs) yield m; if (throwAfter) throw throwAfter; })();
const io = { stderr: '', timedOut: () => false };

test('Claude: an API error reported as a "success" result with is_error is a transient failure, not an answer', async () => {
  const r = await readStream(stream([
    { type: 'assistant', error: 'overloaded', message: {} },
    { type: 'result', subtype: 'success', is_error: true, api_error_status: 529, result: 'API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}' },
  ]), io);
  assert.equal(r.code, 1); assert.equal(r.text, ''); assert.equal(r.status, 529);
  assert.deepEqual(aiRun.classify(r), { ok: false, errorClass: 'provider', transient: true, status: 529 });
});
test('Claude: a 401 result is auth (no retry); a normal success is the answer', async () => {
  const bad = await readStream(stream([{ type: 'result', subtype: 'success', is_error: true, api_error_status: 401, result: 'Invalid API key · Please run /login' }]), io);
  assert.equal(aiRun.classify(bad).errorClass, 'auth');
  const good = await readStream(stream([{ type: 'result', subtype: 'success', is_error: false, result: '{"coach_contract":1}' }]), io);
  assert.equal(good.code, 0); assert.equal(good.text, '{"coach_contract":1}');
});
test('Claude: the runtime exiting non-zero AFTER a complete result keeps the result', async () => {
  const r = await readStream(stream([{ type: 'result', subtype: 'success', is_error: false, result: '{"coach_contract":1,"ok":true}' }], new Error('Claude Code process exited with code 1')), io);
  assert.equal(r.code, 0); assert.match(r.text, /coach_contract/);
});
test('Claude: a crash before any result is a retryable provider failure; a runtime that cannot start is "missing"', async () => {
  const crash = await readStream(stream([], new Error('Claude Code process exited with code 1')), io);
  assert.equal(crash.spawnError, false);
  assert.deepEqual(aiRun.classify(crash), { ok: false, errorClass: 'provider', transient: true, status: undefined });
  const missing = await readStream(stream([], new ReferenceError('Claude Code native binary not found')), io);
  assert.equal(aiRun.classify(missing).errorClass, 'missing');
  // the SDK's own internal retry recovered: the earlier assistant error does not stick
  const recovered = await readStream(stream([{ type: 'assistant', error: 'rate_limit' }, { type: 'result', subtype: 'success', is_error: false, result: '{"a":1}' }]), io);
  assert.equal(recovered.code, 0);
});

/* ---------------- parsing ---------------- */

test('JSON wrapped in prose and fences, with stray braces, is extracted; the contract object wins', () => {
  assert.deepEqual(extractJSON('Plan {draft}:\n```json\n{"coach_contract":1,"x":"a } b"}\n```\nBye').value, { coach_contract: 1, x: 'a } b' });
  assert.deepEqual(extractJSON('Example: {"a":1}\nAnswer: {"coach_contract":1,"b":2} done').value, { coach_contract: 1, b: 2 });
  assert.deepEqual(extractJSON('﻿{"coach_contract":1}').value, { coach_contract: 1 });
  assert.ok(extractJSON('no json here {at all').error);
});

/* ---------------- member Coach, end to end ---------------- */

test('member review: overloaded (529) on the first call, then fine → ready, one job', async () => {
  const s = await runMember('m-529', 'overloaded-then-valid');
  assert.equal(lastOf('m-529').outcome, 'ready');
  assert.ok(s.pending);
});
test('member review: 503 twice, then fine → ready (3 calls, the maximum)', async () => {
  await runMember('m-503x2', '503-twice-then-valid');
  assert.equal(lastOf('m-503x2').outcome, 'ready');
});
test('member review: a provider that stays down fails as "provider" and the status says so', async () => {
  const s = await runMember('m-down', '503-always');
  assert.deepEqual([lastOf('m-down').outcome, lastOf('m-down').errorClass], ['failed', 'provider']);
  assert.equal(s.pending, null);
  assert.deepEqual([s.last.outcome, s.last.errorClass], ['failed', 'provider']);
});
test('member review: auth failure is reported at once as "auth" (no retry, no repair)', async () => {
  await runMember('m-auth', 'auth');
  assert.deepEqual([lastOf('m-auth').outcome, lastOf('m-auth').errorClass], ['failed', 'auth']);
});
test('member review and create: an answer in prose + ```json fences is accepted', async () => {
  await runMember('m-fence-r', 'fenced', 'review');
  assert.equal(lastOf('m-fence-r').outcome, 'ready');
  await runMember('m-fence-c', 'fenced', 'create');
  assert.equal(lastOf('m-fence-c').outcome, 'ready');
});
test('member: permanently invalid JSON → one repair, then "unusable"', async () => {
  const s = await runMember('m-invalid', 'invalid');
  assert.deepEqual([lastOf('m-invalid').outcome, lastOf('m-invalid').errorClass], ['failed', 'unusable']);
  assert.equal(s.last.errorClass, 'unusable');
});
test('member create: protocol FAIL is repaired once; still FAIL → discarded', async () => {
  await runMember('m-pfix', 'protocol-fail-then-valid', 'create');
  assert.equal(lastOf('m-pfix').outcome, 'ready');
  await runMember('m-pfail', 'protocol-fail', 'create');
  assert.deepEqual([lastOf('m-pfail').outcome, lastOf('m-pfail').errorClass], ['failed', 'unusable']);
  assert.equal(jobs.readUser('m-pfail').pending, null);
});
test('two members at the same time: isolated jobs, both ready, no shared temp state', async () => {
  writeState(DIR, 'm-a', sampleState()); writeState(DIR, 'm-b', sampleState());
  process.env.FIXTURE_MODE = 'overloaded-then-valid';
  const restore = quiet();
  try {
    jobs.enqueue('m-a', { kind: 'review' }); jobs.enqueue('m-b', { kind: 'review' });
    await Promise.all([settle('m-a'), settle('m-b')]);
  } finally { restore(); delete process.env.FIXTURE_MODE; }
  assert.equal(lastOf('m-a').outcome, 'ready'); assert.equal(lastOf('m-b').outcome, 'ready');
});

/* ---------------- trainer panel, end to end ---------------- */

async function settleTrainer(tid, mid, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = trainerJobs.status(tid, mid); if (!s.job) return s; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('trainer job never finished');
}
test('trainer generation: transient 529 retried → draft ready; auth → reported once; busy while running', async () => {
  trainerAI.save({ enabled: true }); trainerAI.setSetupToken('fake-token-for-tests');
  trainerJobs.setAdapterForTests(adapterFor('fixture'));
  writeState(DIR, 'mem-t', sampleState());
  const brief = { goal: 'hypertrophy', experience: 'intermediate', daysPerWeek: 3 };
  const restore = quiet();
  try {
    process.env.FIXTURE_MODE = 'overloaded-then-valid';
    trainerJobs.enqueue('coach1', 'mem-t', brief);
    assert.throws(() => trainerJobs.enqueue('coach1', 'mem-t', brief), e => e.code === 'busy');
    let s = await settleTrainer('coach1', 'mem-t');
    assert.ok(s.pending?.bundle?.routines?.length, 'a draft is ready after the retry');
    assert.equal(s.errorClass, null);
    trainerJobs.discard('coach1', 'mem-t');
    process.env.FIXTURE_MODE = 'auth';
    trainerJobs.enqueue('coach1', 'mem-t', brief);
    s = await settleTrainer('coach1', 'mem-t');
    assert.equal(s.errorClass, 'auth');
  } finally { restore(); delete process.env.FIXTURE_MODE; trainerJobs.setAdapterForTests(null); }
});

/* Trainer AI uses professional permissions and plan-only data, independent of member Coach consent. */
test('trainer AI works without member AI consent and its provider payload excludes private history/profile data', async () => {
  trainerAI.save({ enabled: true }); trainerAI.setSetupToken('fake-token-for-tests');
  let prompt = '';
  const base = adapterFor('fixture');
  trainerJobs.setAdapterForTests({ ...base, invoke: async args => { prompt = args.prompt; return base.invoke(args); } });
  const brief = { goal: 'hypertrophy', experience: 'intermediate', daysPerWeek: 3 };
  const restore = quiet();
  try {
    writeState(DIR, 'mem-noconsent', sampleState({
      coach: { profile: { notes: 'PRIVATE_MEMBER_COACH_NOTE' } },
      workouts: [{ id: 'private', d: '2026-01-01', privateNote: 'PRIVATE_WORKOUT_NOTE', entries: [] }],
      checkins: [{ d: '2026-01-01', fatigue: 5, note: 'PRIVATE_CHECKIN' }],
      bodyweight: [{ d: '2026-01-01', w: 9876.5 }],
      sleep: [{ d: '2026-01-01', v: 240 }]
    }));
    trainerJobs.enqueue('coach1', 'mem-noconsent', brief);
    const result = await settleTrainer('coach1', 'mem-noconsent');
    assert.ok(result.pending?.bundle?.routines?.length);
    assert.match(prompt, /Full body A/);
    for (const secret of ['PRIVATE_MEMBER_COACH_NOTE', 'PRIVATE_WORKOUT_NOTE', 'PRIVATE_CHECKIN', '9876.5']) assert.ok(!prompt.includes(secret), `${secret} was not sent`);
  } finally { restore(); delete process.env.FIXTURE_MODE; trainerJobs.setAdapterForTests(null); }
});
