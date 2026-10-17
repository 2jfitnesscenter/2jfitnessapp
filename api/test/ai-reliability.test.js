/* AI reliability: the shared gateway (ai-run.js), the vision scans' consensus, the scan jobs, the
 * trainer/member job persistence and the internal metrics. Every provider is a deterministic fake
 * (a scripted adapter, or a scripted `fetch` standing in for Gemini): no network, no real AI.
 * The scenarios mirror the owner's list: 503→503→ok, 429→ok, timeout→ok, bad JSON→repair→ok,
 * protocol FAIL→repair→ok, 401 and 400 fail fast, concordant / contradictory vision reads, a
 * transient failure on the first read, fallback, exhausted budget, cancellation, and "nothing
 * private reaches the logs". */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const aiRun = await import('../coach/ai-run.js');
const metrics = await import('../lib/ai-metrics.js');
const auxAI = await import('../lib/aux-ai-config.js');
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const trainerAI = await import('../coach/trainer-ai.js');
const trainerJobs = await import('../coach/trainer-jobs.js');
const { adapterFor } = await import('../coach/adapters/index.js');
const { scanBioimpedanceImage } = await import('../lib/measurements-scan.js');
const { scanRoutineDocument } = await import('../lib/routine-scan.js');
const { scanMachineImage } = await import('../lib/machine-scan.js');
const scanJobs = await import('../lib/scan-jobs.js');
const { parseScanUpload } = await import('../lib/scan-routes.js');
const consensus = await import('../lib/measurements-consensus.js');
const { sanitizeRoutine } = await import('../lib/routine-validate.js');

aiRun.setBackoffForTests([0]);
const { POLICIES } = aiRun;

/* ---------- helpers ---------- */

function capture() {
  const lines = []; const log = console.log, err = console.error, warn = console.warn;
  const grab = (...a) => lines.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' '));
  console.log = grab; console.error = grab; console.warn = grab;
  return { lines, restore() { console.log = log; console.error = err; console.warn = warn; } };
}
const quiet = () => capture();

/** A scripted adapter: each call returns the next result (the last one repeats). */
const scripted = (results, onCall) => {
  let i = 0;
  const a = { id: 'fake', calls: 0, async invoke(args) { a.calls++; onCall?.(args); return typeof results === 'function' ? results(a.calls, args) : results[Math.min(i++, results.length - 1)]; } };
  return a;
};
const OK = { code: 0, text: '{"ok":true}', stderr: '', timedOut: false, spawnError: false };
const http = (status, extra = {}) => ({ code: 1, text: '', stderr: `HTTP ${status}`, status, timedOut: false, spawnError: false, ...extra });
const TIMEOUT = { code: -1, text: '', stderr: 'timed out', timedOut: true, spawnError: false };

/** Scripted stand-in for Gemini's generateContent. */
function gemini(steps) {
  const rec = { calls: 0, bodies: [] };
  let i = 0;
  globalThis.fetch = async (_url, opts) => {
    rec.calls++; rec.bodies.push(String(opts?.body || ''));
    const step = steps[Math.min(i++, steps.length - 1)];
    if (step.abort) { const e = new Error('aborted'); e.name = 'AbortError'; throw e; }
    if (step.status) return { ok: false, status: step.status, headers: { get: () => step.retryAfter || null }, json: async () => ({ error: { message: step.message || 'The model is overloaded. Please try again later.', status: 'UNAVAILABLE' } }) };
    const text = typeof step.json === 'string' ? step.json : JSON.stringify(step.json);
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) };
  };
  return rec;
}
const connectAux = () => { auxAI.reset(); auxAI.save({ enabled: true, log: [], usage: null, fallbackModel: null }); auxAI.setApiKey('aux-test-key'); };

const KEYS = consensus.SCAN_KEYS;
const meas = (over = {}) => ({ ...Object.fromEntries(KEYS.map(k => [k, null])), ...over });
const IMG = { data: Buffer.from('SECRETPHOTOBYTES').toString('base64'), mimeType: 'image/png', uid: 'u-scan' };

/* ================= the gateway: ai-run.js ================= */

test('1) 503 → 503 → success: three calls, the caller never sees a failure', async () => {
  const a = scripted([http(503), http(503), OK]); const q = quiet();
  const r = await aiRun.invokeWithRetry(a, {}, { flow: 't' }, POLICIES.member_routine); q.restore();
  assert.equal(a.calls, 3); assert.equal(r.failure, undefined); assert.equal(r.attempts, 3);
});

test('2) 429 (with a Retry-After) → success', async () => {
  const a = scripted([http(429, { retryAfterMs: 5 }), OK]); const q = quiet();
  const r = await aiRun.invokeWithRetry(a, {}, {}, POLICIES.trainer_routine); q.restore();
  assert.equal(a.calls, 2); assert.equal(r.failure, undefined);
});

test('3) timeout → success; and the wait grows exponentially with jitter inside ±25%', async () => {
  const a = scripted([TIMEOUT, OK]); const q = quiet();
  const r = await aiRun.invokeWithRetry(a, {}, {}, POLICIES.member_routine); q.restore();
  assert.equal(a.calls, 2); assert.equal(r.failure, undefined);
  aiRun.setBackoffForTests(null);
  try {
    const p = POLICIES.member_routine;
    for (const [n, base] of [[1, 1500], [2, 3000], [3, 6000], [4, 12000]]) {
      const lo = aiRun.backoffDelay(p, n, 0, () => 0), hi = aiRun.backoffDelay(p, n, 0, () => 0.999999);
      assert.ok(lo >= base * 0.74 && lo <= base * 0.76, `n=${n} low ${lo}`);
      assert.ok(hi >= base * 1.24 && hi <= base * 1.26, `n=${n} high ${hi}`);
    }
    assert.equal(aiRun.backoffDelay(p, 1, 9000, () => 0.5), 9000, 'a longer Retry-After wins');
    assert.equal(aiRun.backoffDelay(p, 1, 999999, () => 0.5), 15000, 'but only up to a cap');
  } finally { aiRun.setBackoffForTests([0]); }
});

test('6) 401 / 403: fails at once, never retried, never paid for twice', async () => {
  for (const r401 of [http(401), http(403), { code: 1, text: '', stderr: 'API Error: invalid x-api-key', timedOut: false, spawnError: false }]) {
    const a = scripted([r401, OK]); const q = quiet();
    const r = await aiRun.invokeWithRetry(a, {}, {}, POLICIES.member_routine); q.restore();
    assert.equal(a.calls, 1); assert.equal(r.failure.errorClass, 'auth'); assert.equal(r.failure.transient, false);
  }
});

test('7) a permanent 400 (bad request) is not retried either', async () => {
  const a = scripted([http(400), OK]); const q = quiet();
  const r = await aiRun.invokeWithRetry(a, {}, {}, POLICIES.member_routine); q.restore();
  assert.equal(a.calls, 1); assert.equal(r.failure.transient, false); assert.equal(r.failure.status, 400);
});

test('11) primary model exhausted → the configured fallback answers; no fallback configured → retries of the primary only', async () => {
  const a = scripted((n, args) => args.model === 'big' ? http(529) : OK);
  const q = quiet();
  const r = await aiRun.invokeWithRetry(a, { model: 'big' }, { flow: 't', fallbacks: [{ id: 'small', args: { model: 'small' } }] }, POLICIES.member_routine);
  assert.equal(r.failure, undefined); assert.equal(r.usedFallback, true);
  assert.equal(a.calls, POLICIES.member_routine.maxAttempts + 1, 'primary spent its attempts, then ONE fallback call');
  const b = scripted(() => http(529));
  const r2 = await aiRun.invokeWithRetry(b, { model: 'big' }, {}, POLICIES.member_routine); q.restore();
  assert.equal(b.calls, POLICIES.member_routine.maxAttempts); assert.equal(r2.usedFallback, false); assert.ok(r2.failure.transient);
});

test('11b) a bad credential on the primary still lets the fallback try (it may use another account/model)', async () => {
  const a = scripted((n, args) => args.model === 'p' ? http(401) : OK); const q = quiet();
  const r = await aiRun.invokeWithRetry(a, { model: 'p' }, { fallbacks: [{ id: 'f', args: { model: 'f' } }] }, POLICIES.trainer_routine); q.restore();
  assert.equal(r.failure, undefined); assert.equal(a.calls, 2);
});

test('12) budget: a call ceiling and a time ceiling both end the loop with a clean failure', async () => {
  const q = quiet();
  const tight = { maxAttempts: 50, maxCalls: 3, maxMs: Infinity, backoffMs: [0], maxTimeouts: 99, jitter: 0, minCallMs: 0 };
  const a = scripted(() => http(503));
  const r = await aiRun.invokeWithRetry(a, {}, {}, tight);
  assert.equal(a.calls, 3); assert.equal(r.failure.budget, true); assert.equal(r.failure.transient, true);

  aiRun.setBackoffForTests(null);
  try {
    const timed = { maxAttempts: 50, maxCalls: 50, maxMs: 60, backoffMs: [25], maxTimeouts: 99, jitter: 0, minCallMs: 0 };
    const b = scripted(() => http(503)); const t0 = Date.now();
    const r2 = await aiRun.invokeWithRetry(b, {}, {}, timed);
    assert.ok(Date.now() - t0 < 1000, 'ended by the clock, not by exhausting 50 attempts');
    assert.ok(b.calls >= 1 && b.calls < 10, `calls=${b.calls}`); assert.equal(r2.failure.budget, true);
  } finally { aiRun.setBackoffForTests([0]); q.restore(); }
});

test('13) cancellation: aborting during a backoff wait stops the request at once', async () => {
  aiRun.setBackoffForTests(null);
  const q = quiet();
  try {
    const ac = new AbortController();
    const a = scripted(() => http(503)); const t0 = Date.now();
    const p = aiRun.invokeWithRetry(a, {}, { signal: ac.signal }, { ...POLICIES.member_routine, backoffMs: [5000], jitter: 0 });
    setTimeout(() => ac.abort(), 40);
    const r = await p;
    assert.ok(Date.now() - t0 < 1500, 'did not sit out the 5 s wait');
    assert.equal(r.failure.cancelled, true); assert.equal(a.calls, 1);
  } finally { aiRun.setBackoffForTests([0]); q.restore(); }
});

/* ================= job level (fixture provider): repair and persistence ================= */

async function settleMember(uid, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = jobs.status(uid); if (!s.job) return s; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('job never finished');
}
const lastOf = uid => jobs.readUser(uid).history.at(-1);

test('4) invalid answer → repair → success (member create) and 5) valid JSON that fails the 2J protocol → repair → success', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  const q = quiet();
  try {
    for (const [mode, kind, uid] of [['invalid-then-valid', 'review', 'rel-json'], ['protocol-fail-then-valid', 'create', 'rel-proto']]) {
      writeState(DIR, uid, sampleState()); process.env.FIXTURE_MODE = mode;
      jobs.enqueue(uid, { kind }); await settleMember(uid);
      assert.equal(lastOf(uid).outcome, 'ready', mode);
    }
  } finally { q.restore(); delete process.env.FIXTURE_MODE; }
});

test('a job reports its phase while it runs (queued → generating → …) and never a provider error before the budget is spent', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  writeState(DIR, 'rel-phase', sampleState()); process.env.FIXTURE_MODE = '503-twice-then-valid';
  const q = quiet(); const seen = new Set();
  try {
    jobs.enqueue('rel-phase', { kind: 'review' });
    const until = Date.now() + 20000;
    for (;;) { const s = jobs.status('rel-phase'); if (!s.job) break; seen.add(s.job.phase); assert.equal(s.last, null, 'no failure shown while it is still going'); if (Date.now() > until) throw new Error('stuck'); await new Promise(r => setTimeout(r, 5)); }
    assert.equal(lastOf('rel-phase').outcome, 'ready');
    assert.ok([...seen].every(p => ['queued', 'generating', 'retrying', 'validating', 'repairing', 'fallback'].includes(p)), [...seen].join());
  } finally { q.restore(); delete process.env.FIXTURE_MODE; }
});

test('a member job interrupted by a restart runs again once; a second interruption is closed honestly', async () => {
  cfg.save({ enabled: true, provider: 'fixture' });
  fs.mkdirSync(`${DIR}/coach`, { recursive: true });
  writeState(DIR, 'rel-resume', sampleState());
  const rec = resumes => ({ current: { id: 'jr' + resumes, kind: 'review', state: 'running', phase: 'generating', startedAt: Date.now() - 5000, resume: { kind: 'review', trigger: 'manual' }, resumes }, history: [] });
  const q = quiet();
  try {
    fs.writeFileSync(`${DIR}/coach/rel-resume.json`, JSON.stringify(rec(0)));
    jobs.recoverOnBoot();
    assert.ok(jobs.status('rel-resume').job, 'back in the queue');
    await settleMember('rel-resume');
    assert.equal(lastOf('rel-resume').outcome, 'ready');
    fs.writeFileSync(`${DIR}/coach/rel-resume.json`, JSON.stringify(rec(1)));
    jobs.recoverOnBoot();
    assert.equal(jobs.status('rel-resume').job, null);
    assert.equal(lastOf('rel-resume').errorClass, 'restart');
  } finally { q.restore(); }
});

async function settleTrainer(trainerId, memberId, ms = 20000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = trainerJobs.status(trainerId, memberId); if (!s.job) return s; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('trainer job never finished');
}
const BRIEF = { goal: 'hypertrophy', experience: 'intermediate', daysPerWeek: 3 };
const readJobsFile = () => JSON.parse(fs.readFileSync(`${DIR}/trainer-ai-jobs.json`, 'utf8'));

test('trainer jobs survive a restart (once), keep a finished draft, and drop the request once done', async () => {
  trainerAI.save({ enabled: true }); trainerAI.setSetupToken('fake-token-for-tests');
  trainerJobs.setAdapterForTests(adapterFor('fixture'));
  writeState(DIR, 'rel-mem-1', sampleState()); writeState(DIR, 'rel-mem-2', sampleState());
  const row = (memberId, resumes) => ({ id: 'tj-' + memberId, trainerId: 'coachR', memberId, state: 'running', phase: 'generating', startedAt: Date.now() - 1000, endedAt: 0, pending: null, errorClass: null, brief: BRIEF, resumes });
  const q = quiet();
  try {
    fs.writeFileSync(`${DIR}/trainer-ai-jobs.json`, JSON.stringify({ v: 1, jobs: [row('rel-mem-1', 0), row('rel-mem-2', 1)] }));
    assert.equal(trainerJobs.recoverOnBoot(), 1, 'only the first one is restarted');
    const s1 = await settleTrainer('coachR', 'rel-mem-1');
    assert.ok(s1.pending?.bundle?.routines?.length, 'the draft is there after the restart');
    assert.equal(trainerJobs.status('coachR', 'rel-mem-2').errorClass, 'restart');
    const saved = readJobsFile().jobs.find(j => j.memberId === 'rel-mem-1');
    assert.equal(saved.brief, null, 'the request is not kept once the job ended');
    assert.ok(saved.pending?.bundle, 'the finished draft is kept for the trainer');
  } finally { q.restore(); trainerJobs.setAdapterForTests(null); }
});

test('13b) discarding a trainer job stops its retries and frees the member at once', async () => {
  trainerAI.save({ enabled: true }); trainerAI.setSetupToken('fake-token-for-tests');
  writeState(DIR, 'rel-mem-3', sampleState());
  aiRun.setBackoffForTests(null);                       // real waits: only cancellation can end this quickly
  const down = scripted(() => http(503));
  trainerJobs.setAdapterForTests(down);
  const q = quiet();
  try {
    trainerJobs.enqueue('coachC', 'rel-mem-3', BRIEF);
    await new Promise(r => setTimeout(r, 120));          // first call done, now waiting out the backoff
    assert.ok(trainerJobs.status('coachC', 'rel-mem-3').job);
    const t0 = Date.now();
    trainerJobs.discard('coachC', 'rel-mem-3');
    const until = Date.now() + 3000; let again = null;
    while (Date.now() < until && !again) { try { again = trainerJobs.enqueue('coachC', 'rel-mem-3', BRIEF); } catch (e) { if (e.code !== 'busy') throw e; await new Promise(r => setTimeout(r, 20)); } }
    assert.ok(again, 'the member is free again'); assert.ok(Date.now() - t0 < 2500);
    assert.equal(down.calls <= 3, true, `no further calls after cancelling (calls=${down.calls})`);
    trainerJobs.discard('coachC', 'rel-mem-3');
  } finally { aiRun.setBackoffForTests([0]); q.restore(); trainerJobs.setAdapterForTests(null); }
});

/* ================= vision scans: consensus ================= */

test('8) measurements: two reads that agree (62.1 vs 62.0) are accepted with no field flagged', async () => {
  connectAux();
  const r1 = meas({ weight: 82.4, bodyFat: 17.3, muscleMass: 62.1, waterPct: 55, confidence: 'low' });
  const r2 = meas({ weight: 82.4, bodyFat: 17.3, muscleMass: 62.0, waterPct: 55, confidence: 'high' });
  const g = gemini([{ json: r1 }, { json: r2 }]); const q = quiet();
  const r = await scanBioimpedanceImage(IMG); q.restore();
  assert.equal(r.ok, true); assert.equal(g.calls, 2);
  assert.equal(r.values.bodyFat, 17.3); assert.equal(r.values.weight, 82.4); assert.ok(Math.abs(r.values.muscleMass - 62.05) <= 0.06);
  assert.deepEqual(r.review, []);
});

test('9) measurements: contradictory reads are NOT accepted — no majority means null + "review"', async () => {
  connectAux();
  const base = { weight: 82.4, muscleMass: 40.1, waterPct: 55 };
  const g = gemini([{ json: meas({ ...base, bodyFat: 17.3, confidence: 'medium' }) }, { json: meas({ ...base, bodyFat: 37.3 }) }, { json: meas({ ...base, bodyFat: 25.0 }) }]);
  const q = quiet();
  const r = await scanBioimpedanceImage(IMG); q.restore();
  assert.equal(r.ok, true); assert.equal(g.calls, 3, 'a third read breaks the tie, never a fourth');
  assert.equal(r.values.bodyFat, null); assert.deepEqual(r.review, ['bodyFat']);
  assert.equal(r.values.weight, 82.4, 'the fields that did agree are kept');
});

test('9b) measurements: a physically impossible read (fat + muscle > weight) triggers more reads and the two that agree win', async () => {
  connectAux();
  const impossible = { weight: 82.4, bodyFat: 37.3, muscleMass: 62.1 };           // 30.7 kg fat + 62.1 kg muscle > 82.4 kg
  const g = gemini([{ json: meas(impossible) }, { json: meas({ ...impossible, bodyFat: 17.3 }) }, { json: meas({ ...impossible, bodyFat: 17.3 }) }]);
  const q = quiet();
  const r = await scanBioimpedanceImage(IMG); q.restore();
  assert.equal(g.calls, 3); assert.equal(r.values.bodyFat, 17.3); assert.deepEqual(r.review, []);
});

test('measurements: a clean, confident first read stops after ONE call (early exit)', async () => {
  connectAux();
  const g = gemini([{ json: meas({ weight: 80, bodyFat: 15, muscleMass: 40, confidence: 'high' }) }]); const q = quiet();
  const r = await scanBioimpedanceImage(IMG); q.restore();
  assert.equal(r.ok, true); assert.equal(g.calls, 1); assert.deepEqual(r.review, []);
});

test('measurements: out-of-range numbers are dropped, never clamped; the deterministic checks live in one module', () => {
  const n = consensus.normalizeReading({ ...meas({ weight: 80, bodyFat: 180, visceralFat: '9' }), confidence: 'High' });
  assert.equal(n.values.bodyFat, null); assert.deepEqual(n.dropped, ['bodyFat']); assert.equal(n.values.visceralFat, 9); assert.equal(n.confidence, 'high');
  assert.ok(consensus.assessReading(n).reasons.includes('out_of_range'));
  assert.deepEqual(consensus.crossChecks({ weight: 70, bodyFat: 20, muscleMass: 60 }).map(c => c.id), ['fat_plus_muscle_over_weight']);
  assert.deepEqual(consensus.crossChecks({ weight: 70, bodyFat: 20, muscleMass: 40 }), []);
});

test('measurements: if the provider will not give a second opinion, only what nothing contradicts is returned', async () => {
  connectAux();
  const g = gemini([{ json: meas({ weight: 82.4, bodyFat: 37.3, muscleMass: 62.1, waterPct: 55 }) }, { status: 503 }]); const q = quiet();
  const r = await scanBioimpedanceImage(IMG); q.restore();
  assert.equal(r.ok, true);
  assert.equal(r.values.bodyFat, null); assert.equal(r.values.muscleMass, null);          // took part in the failed physical check
  assert.equal(r.values.weight, 82.4); assert.equal(r.values.waterPct, 55);
  assert.deepEqual(r.review.sort(), ['bodyFat', 'muscleMass']);
  assert.ok(g.calls >= 2);
});

/* ================= vision scans: transient failures ================= */

test('10) machine scan: the first read fails transiently, the retry succeeds — one tap, one answer', async () => {
  connectAux();
  const g = gemini([{ status: 503 }, { json: { name: 'Prensa de piernas', nameEn: 'leg press', confidence: 'high' } }]); const q = quiet();
  const r = await scanMachineImage(IMG); q.restore();
  assert.equal(r.ok, true); assert.equal(r.value.nameEn, 'leg press'); assert.equal(g.calls, 2);
});

test('3b/2b) a Gemini timeout, then a 429, then a valid answer: invisible to the member', async () => {
  connectAux();
  const g = gemini([{ abort: true }, { status: 429, message: 'Resource has been exhausted (e.g. check quota).', retryAfter: '0' }, { json: { name: 'Press de banca', nameEn: 'dumbbell bench press', confidence: 'high' } }]);
  const q = quiet();
  const r = await scanMachineImage(IMG); q.restore();
  assert.equal(r.ok, true); assert.equal(g.calls, 3);
});

test('machine scan: a doubtful first read gets a second look; two reads of the same exercise are accepted; different ones get a third', async () => {
  connectAux();
  let g = gemini([{ json: { name: 'Máquina rara', nameEn: 'zzqx contraption', confidence: 'low' } }, { json: { name: 'Prensa', nameEn: 'leg press', confidence: 'high' } }]); let q = quiet();
  let r = await scanMachineImage(IMG); q.restore();
  assert.equal(g.calls, 2); assert.equal(r.value.nameEn, 'leg press', 'the library-recognised read wins');
  g = gemini([{ json: { name: 'a', nameEn: 'zzqx machine', confidence: 'medium' } }, { json: { name: 'b', nameEn: 'qqxz thing', confidence: 'medium' } }, { json: { name: 'c', nameEn: 'dumbbell bench press', confidence: 'high' } }]); q = quiet();
  r = await scanMachineImage(IMG); q.restore();
  assert.equal(g.calls, 3, 'never more than three reads'); assert.equal(r.value.nameEn, 'dumbbell bench press');
  g = gemini([{ json: { name: null, nameEn: null } }, { json: { name: null, nameEn: null } }]); q = quiet();
  r = await scanMachineImage(IMG); q.restore();
  assert.equal(r.ok, false); assert.equal(r.code, 'NOTHING_FOUND'); assert.equal(g.calls, 2);
});

test('routine scan: a clean sheet costs ONE call; a garbled row is re-read alone (by position), not the whole page', async () => {
  connectAux();
  const clean = { name: 'PPL', days: [{ label: 'Push', exercises: [{ name: 'Press banca mancuernas', nameEn: 'dumbbell bench press', sets: 3, reps: 10 }, { name: 'Jalón al pecho', nameEn: 'lat pulldown', sets: 3, reps: 12 }] }] };
  let g = gemini([{ json: clean }]); let q = quiet();
  let r = await scanRoutineDocument(IMG); q.restore();
  assert.equal(r.ok, true); assert.equal(g.calls, 1);

  const dirty = { name: 'PPL', days: [{ label: 'Push', exercises: [{ name: 'Press banca mancuernas', nameEn: 'dumbbell bench press', sets: 3, reps: 10 }, { name: '#%@!!', nameEn: '', sets: 3, reps: 999 }] }] };
  g = gemini([{ json: dirty }, { json: { rows: [{ day: 1, exercise: 2, name: 'Jalón al pecho', nameEn: 'lat pulldown', sets: 3, reps: 12, unit: 'reps' }] } }]); q = quiet();
  r = await scanRoutineDocument(IMG); q.restore();
  assert.equal(g.calls, 2);
  assert.match(g.bodies[1], /day 1, exercise 2/); assert.ok(!/day 1, exercise 1/.test(g.bodies[1]), 'the clean row is not re-read');
  const rows = r.value.days[0].exercises;
  assert.equal(rows[0].nameEn, 'dumbbell bench press'); assert.equal(rows[1].nameEn, 'lat pulldown'); assert.equal(rows[1].reps, 12);
});

test('routine scan: if the second look fails, the first transcription is kept (nothing invented, nothing lost)', async () => {
  connectAux();
  const dirty = { days: [{ label: 'A', exercises: [{ name: 'Sentadilla', nameEn: 'squat', sets: 50, reps: 10 }] }] };
  const g = gemini([{ json: dirty }, { status: 503 }]); const q = quiet();
  const r = await scanRoutineDocument(IMG); q.restore();
  assert.equal(r.ok, true); assert.equal(r.value.days[0].exercises[0].sets, null, 'an impossible 50 sets was dropped, not kept'); assert.ok(g.calls >= 2);
});

test('routine validation: caps days/rows, drops impossible numbers, flags only the odd-one-out unmatched name', () => {
  const s = sanitizeRoutine({ days: [{ exercises: [
    { name: 'Press banca con barra', nameEn: 'barbell bench press', sets: 4, reps: 8 },
    { name: 'Remo con barra', nameEn: 'barbell row', sets: 4, reps: 8 },
    { name: 'Extravagancia XYZ', nameEn: 'qwertyuiop asdfgh', sets: 3, reps: 12 }
  ] }] });
  assert.deepEqual(s.doubtful.map(d => d.reasons), [['no_library_match']]);
  const all = sanitizeRoutine({ days: [{ exercises: [{ name: 'qwertyuiop', nameEn: 'qwertyuiop' }, { name: 'asdfghjkl', nameEn: 'asdfghjkl' }] }] });
  assert.deepEqual(all.doubtful, [], 'when most rows are unmatched the gym just uses other names: no wasted calls');
});

/* ================= clean failures ================= */

test('12b) a provider that never recovers: ONE clean message (no 503 / overloaded / provider words), the daily slot is returned, the failure is counted', async () => {
  connectAux(); metrics.resetForTests();
  const g = gemini([{ status: 503, message: 'The model is overloaded. Please try again later.' }]); const q = quiet();
  const r = await scanBioimpedanceImage(IMG); q.restore();
  assert.equal(r.ok, false); assert.equal(r.code, 'AI_BUSY');
  assert.ok(!/503|overload|provider|proveedor|gemini|429|timeout/i.test(r.error), r.error);
  assert.ok(g.calls >= 3 && g.calls <= POLICIES.scan_sync.maxCalls + POLICIES.scan.maxCalls);
  assert.equal(auxAI.load().usage.total, 0, 'a failed scan does not use up the member\'s daily scans');
  const snap = metrics.snapshot().measurement_scan;
  assert.equal(snap.final_failure, 1); assert.ok(snap.http_503 >= 3);
});

test('bad credentials are an immediate, clean "unavailable" — not a retry storm and not the provider\'s words', async () => {
  connectAux();
  const g = gemini([{ status: 401, message: 'API key not valid. Please pass a valid API key.' }]); const q = quiet();
  const r = await scanMachineImage(IMG); q.restore();
  assert.equal(g.calls, 1); assert.equal(r.code, 'AI_UNAVAILABLE'); assert.ok(!/api key/i.test(r.error));
});

test('permanent 400 from Gemini (it refuses this very file): one call, "unreadable"', async () => {
  connectAux();
  const g = gemini([{ status: 400, message: 'Unable to process input image.' }]); const q = quiet();
  const r = await scanRoutineDocument(IMG); q.restore();
  assert.equal(g.calls, 1); assert.equal(r.code, 'UNREADABLE');
});

test('an optional fallback model is used for scans when the first stays overloaded', async () => {
  connectAux(); auxAI.save({ model: 'gem-a', fallbackModel: 'gem-b' });
  const urls = [];
  const orig = globalThis.fetch;
  let n = 0;
  globalThis.fetch = async (url) => {
    urls.push(String(url)); n++;
    if (String(url).includes('gem-a')) return { ok: false, status: 503, headers: { get: () => null }, json: async () => ({ error: { message: 'overloaded', status: 'UNAVAILABLE' } }) };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ name: 'Prensa', nameEn: 'leg press', confidence: 'high' }) }] }, finishReason: 'STOP' }] }) };
  };
  const q = quiet();
  try {
    const r = await scanMachineImage(IMG);
    assert.equal(r.ok, true);
    assert.ok(urls.some(u => u.includes('gem-b')) && urls.filter(u => u.includes('gem-a')).length >= 3);
  } finally { q.restore(); globalThis.fetch = orig; auxAI.save({ model: null, fallbackModel: null }); }
});

/* ================= scan jobs and the upload gate ================= */

test('scan upload: the per-file consent is enforced by the server, whatever the screen did', () => {
  const file = 'data:image/png;base64,' + Buffer.from('x').toString('base64');
  assert.equal(parseScanUpload({ file }).status, 428);
  assert.equal(parseScanUpload({ file, externalAiConsent: 'yes' }).status, 428);
  assert.equal(parseScanUpload({ file: 'data:text/html;base64,AAAA', externalAiConsent: 'external-ai-scan-v1' }).status, 400);
  assert.ok(parseScanUpload({ file, externalAiConsent: 'external-ai-scan-v1' }).image);
});

test('scan job: running → done; the photo is dropped the moment it ends; nobody else can read it; cancel stops it; erasure removes it', async () => {
  let release; const gate = new Promise(r => { release = r; });
  const job = scanJobs.startScanJob({ uid: 'jA', kind: 'machine', image: { data: 'PHOTO' }, run: async (image, ctx) => { await gate; return { ok: true, value: { name: 'x', nameEn: 'y' } }; } });
  assert.equal(scanJobs.scanJobStatus('jA', job.id).state, 'running');
  assert.equal(scanJobs.scanJobStatus('jB', job.id), null, 'another member sees nothing');
  assert.throws(() => scanJobs.startScanJob({ uid: 'jA', kind: 'machine', image: {}, run: async () => ({ ok: true }) }), e => e.code === 'busy', 'one scan at a time per member');
  release(); await new Promise(r => setTimeout(r, 20));
  const done = scanJobs.scanJobStatus('jA', job.id);
  assert.equal(done.state, 'done'); assert.equal(scanJobs._jobsForTests.get(job.id).image, null, 'the image is no longer held');

  let seenSignal;
  const j2 = scanJobs.startScanJob({ uid: 'jC', kind: 'routine', image: { data: 'P2' }, run: (img, ctx) => new Promise(res => { seenSignal = ctx.signal; ctx.signal.addEventListener('abort', () => res({ ok: false, code: 'CANCELLED', error: 'x' })); }) });
  await new Promise(r => setTimeout(r, 5));
  assert.equal(scanJobs.cancelScanJob('jC', j2.id), true); await new Promise(r => setTimeout(r, 20));
  assert.equal(seenSignal.aborted, true); assert.equal(scanJobs.scanJobStatus('jC', j2.id).state, 'cancelled');

  scanJobs.dropScanJobsFor('jA');
  assert.equal(scanJobs.scanJobStatus('jA', job.id), null);
});

test('scan job: a run that throws becomes a clean failure, never an unhandled error', async () => {
  const job = scanJobs.startScanJob({ uid: 'jT', kind: 'machine', image: {}, run: async () => { throw new Error('boom with secret'); } });
  await new Promise(r => setTimeout(r, 20));
  const st = scanJobs.scanJobStatus('jT', job.id);
  assert.equal(st.state, 'failed'); assert.ok(!/boom|secret/.test(JSON.stringify(st)));
});

/* ================= metrics and privacy ================= */

test('metrics: first_try / retry / repair / fallback / final_failure are counted per flow, numbers only', () => {
  metrics.resetForTests();
  const mk = (flow, fn) => { const t = metrics.begin(flow); fn(t); return t.finish(true); };
  assert.equal(mk('member_routine', t => t.call(null)), 'first_try_success');
  assert.equal(mk('member_routine', t => { t.call({ status: 503, errorClass: 'provider' }); t.retried(); t.call(null); }), 'retry_success');
  assert.equal(mk('member_routine', t => { t.repaired(); t.call(null); }), 'repair_success');
  assert.equal(mk('trainer_routine', t => { t.usedFallback(); t.call(null); }), 'fallback_success');
  const bad = metrics.begin('trainer_routine'); bad.call({ status: 429, errorClass: 'provider' }); bad.call({ errorClass: 'timeout' }); bad.badJson(); bad.validationFailure();
  assert.equal(bad.finish(false), 'final_failure'); assert.equal(bad.finish(true), undefined, 'closing twice counts once');
  const s = metrics.snapshot();
  assert.equal(s.member_routine.requests, 3); assert.equal(s.member_routine.first_try_success, 1); assert.equal(s.member_routine.retry_success, 1); assert.equal(s.member_routine.repair_success, 1);
  assert.equal(s.trainer_routine.fallback_success, 1); assert.equal(s.trainer_routine.final_failure, 1);
  assert.equal(s.trainer_routine.http_429, 1); assert.equal(s.trainer_routine.timeout, 1); assert.equal(s.trainer_routine.bad_json, 1); assert.equal(s.trainer_routine.validation_failure, 1);
  assert.equal(s.member_routine.http_503, 1); assert.ok(s.member_routine.avgAttempts >= 1);
  metrics.flushNow();
  const file = JSON.parse(fs.readFileSync(`${DIR}/ai-metrics.json`, 'utf8'));
  const leaf = v => typeof v === 'object' ? Object.values(v).every(leaf) : typeof v === 'number' || ['v', 'updatedAt'].includes(v) || typeof v === 'string';
  assert.ok(Object.values(file.flows).every(row => Object.values(row).every(x => typeof x === 'number')), 'the flow rows hold numbers only');
  assert.ok(leaf(file));
});

test('14) no photo, prompt, answer or credential reaches the logs, the aux log or the metrics file', async () => {
  connectAux(); metrics.resetForTests();
  const answer = { weight: 80, bodyFat: 15, muscleMass: 40, waterPct: 55, confidence: 'low', note: 'PRIVATE_MODEL_ANSWER_MARKER' };
  gemini([{ status: 503, message: 'overloaded SECRETPHOTOBYTES' }, { json: answer }, { json: answer }]);
  const c = capture();
  let r, jobResult;
  try {
    r = await scanBioimpedanceImage(IMG);
    // a Coach job (fixture provider) on a profile with private notes
    cfg.save({ enabled: true, provider: 'fixture' });
    writeState(DIR, 'rel-priv', sampleState({ coach: { consent: { agreedAt: new Date().toISOString(), version: 1 }, profile: { goal: 'muscle', daysPerWeek: 3, equipment: ['dumbbell'], notes: 'PRIVATE_NOTE_MARKER' } } }));
    jobs.enqueue('rel-priv', { kind: 'review' }); jobResult = await settleMember('rel-priv');
  } finally { c.restore(); }
  assert.equal(r.ok, true);
  const out = c.lines.join('\n') + JSON.stringify(auxAI.load().log) + fs.readFileSync(`${DIR}/ai-metrics.json`, 'utf8').toString().replace(/^$/, '');
  metrics.flushNow();
  const all = out + fs.readFileSync(`${DIR}/ai-metrics.json`, 'utf8') + JSON.stringify(jobs.readUser('rel-priv').history);
  for (const secret of ['SECRETPHOTOBYTES', Buffer.from('SECRETPHOTOBYTES').toString('base64'), 'aux-test-key', 'PRIVATE_MODEL_ANSWER_MARKER', 'PRIVATE_NOTE_MARKER', 'bioimpedance', 'data:image'])
    assert.ok(!all.includes(secret), `${secret} must not be logged`);
  assert.ok(c.lines.some(l => l.includes('AI_ATTEMPT')), 'but the attempts themselves are logged');
});

/* ================= the HTTP surface ================= */

test('scan routes end to end: consent first, start → poll → done, sync endpoint answers with a clean error', async () => {
  const { scanRoutes } = await import('../lib/scan-routes.js');
  let user = { id: 'httpU' }, body = {};
  const out = {};
  const json = (res, code, obj) => { out.code = code; out.body = obj; };
  const routes = scanRoutes({ json, readBody: async () => body, readSession: () => user });
  const run = async (key, url = '/x') => { out.code = 0; out.body = null; await routes[key]({ url }, { on() {}, writableFinished: true }); return { code: out.code, body: out.body }; };
  const file = 'data:image/png;base64,' + Buffer.from('SECRETPHOTOBYTES').toString('base64');
  connectAux();

  user = null;
  assert.equal((await run('POST /api/scan/start')).code, 401);
  user = { id: 'httpU' };
  body = { kind: 'machine', file };
  assert.equal((await run('POST /api/scan/start')).code, 428, 'no consent → nothing is read or sent');
  body = { kind: 'nope', file, externalAiConsent: 'external-ai-scan-v1' };
  assert.equal((await run('POST /api/scan/start')).code, 400);

  gemini([{ status: 503 }, { json: { name: 'Prensa', nameEn: 'leg press', confidence: 'high' } }]);
  body = { kind: 'machine', file, externalAiConsent: 'external-ai-scan-v1' };
  const q = quiet();
  const started = await run('POST /api/scan/start');
  assert.equal(started.code, 202);
  const id = started.body.job.id;
  let st;
  for (let i = 0; i < 100; i++) { st = await run('GET /api/scan/status', '/api/scan/status?id=' + id); if (st.body.state !== 'running') break; await new Promise(r => setTimeout(r, 10)); }
  q.restore();
  assert.equal(st.body.state, 'done'); assert.equal(st.body.nameEn, 'leg press');
  user = { id: 'someone-else' };
  assert.equal((await run('GET /api/scan/status', '/api/scan/status?id=' + id)).code, 404);

  // the original synchronous endpoint (older app versions): same engine, clean failure
  user = { id: 'httpU2' };
  gemini([{ status: 503 }]);
  body = { file, externalAiConsent: 'external-ai-scan-v1' };
  const q2 = quiet();
  const r = await run('POST /api/exercises/scan-machine');
  q2.restore();
  assert.equal(r.code, 503); assert.equal(r.body.code, 'AI_BUSY'); assert.ok(!/503|overload|gemini|provider/i.test(r.body.error));
  body = { file };
  assert.equal((await run('POST /api/exercises/scan-machine')).code, 428);
});

test('erasing a member also drops their trainer drafts', () => {
  trainerJobs.forgetMember('rel-mem-1');
  assert.equal(trainerJobs.status('coachR', 'rel-mem-1').pending, null);
  assert.ok(!readJobsFile().jobs.some(j => j.memberId === 'rel-mem-1'));
});
