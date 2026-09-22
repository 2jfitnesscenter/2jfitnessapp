import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const auxAI = await import('../lib/aux-ai-config.js');
const { matchImportExercises } = await import('../lib/import-exercise-match.js');

const CANDS = [
  { id: '0025', name: 'Press de banca con barra', equipment: 'barbell', muscles: ['chest'] },
  { id: '0047', name: 'Press inclinado con barra', equipment: 'barbell', muscles: ['chest'] },
];

/** Stubs global fetch to answer like Gemini's generateContent endpoint would, with the given
 *  parsed body (an object — JSON.stringify'd into the response the real adapter expects). */
function stubGemini(bodyOrText) {
  const text = typeof bodyOrText === 'string' ? bodyOrText : JSON.stringify(bodyOrText);
  const calls = [];
  globalThis.fetch = async (url, opts) => {
    calls.push({ url, opts });
    return {
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
    };
  };
  return calls;
}

function connectAux() {
  auxAI.save({ enabled: true, log: [], caps: { instanceDaily: 1000 } });
  auxAI.setApiKey('test-gemini-key');
}

function providerResponse(status, body = {}, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: { get: key => headers[key.toLowerCase()] }, json: async () => body };
}

test('not enabled at all: refuses cleanly, no fetch attempted', async () => {
  auxAI.save({ enabled: false, auth: null });
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not be called'); };
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }]);
  assert.equal(r.ok, false);
  assert.equal(called, false);
});

test('empty items short-circuits to an empty result without calling the provider', async () => {
  connectAux();
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error('should not be called'); };
  const r = await matchImportExercises([]);
  assert.deepEqual(r, { ok: true, results: [] });
  assert.equal(called, false);
});

test('a clean MATCH inside the given candidates is accepted', async () => {
  connectAux();
  stubGemini({ results: [{ externalName: 'Press banca con barra', status: 'MATCH', exerciseId: '0025', confidence: 0.93, reason: 'same lift, translated name' }] });
  const r = await matchImportExercises([{ name: 'Press banca con barra', source: 'hevy', candidates: CANDS }]);
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].status, 'MATCH');
  assert.equal(r.results[0].exerciseId, '0025');
  assert.equal(r.results[0].confidence, 0.93);
});

test('an invented exerciseId not in that item\'s own candidates is rejected, not trusted', async () => {
  connectAux();
  stubGemini({ results: [{ externalName: 'Press banca', status: 'MATCH', exerciseId: '9999-made-up', confidence: 0.99, reason: 'x' }] });
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }]);
  assert.equal(r.ok, true);
  assert.equal(r.results[0].status, 'NO_MATCH', 'downgraded to a safe outcome, never the invented id');
  assert.equal(r.results[0].exerciseId, null);
});

test('an exerciseId that belongs to a DIFFERENT item is rejected too', async () => {
  connectAux();
  stubGemini({
    results: [
      { externalName: 'Press banca', status: 'MATCH', exerciseId: '0025', confidence: 0.9, reason: 'ok' },
      { externalName: 'Curl bíceps', status: 'MATCH', exerciseId: '0025', confidence: 0.9, reason: 'wrong pool' },
    ],
  });
  const r = await matchImportExercises([
    { name: 'Press banca', source: 'hevy', candidates: CANDS },
    { name: 'Curl bíceps', source: 'hevy', candidates: [{ id: '0294', name: 'Curl de bíceps', equipment: 'dumbbell' }] },
  ]);
  assert.equal(r.results[0].exerciseId, '0025');
  assert.equal(r.results[1].status, 'NO_MATCH', '0025 was never in this item\'s own candidate list');
});

test('AMBIGUOUS and NO_MATCH pass through with no exerciseId', async () => {
  connectAux();
  stubGemini({
    results: [
      { externalName: 'A', status: 'AMBIGUOUS', exerciseId: null, confidence: 0.4, reason: 'two plausible' },
      { externalName: 'B', status: 'NO_MATCH', exerciseId: null, confidence: 0.1, reason: 'nothing close' },
    ],
  });
  const r = await matchImportExercises([
    { name: 'A', source: 'hevy', candidates: CANDS },
    { name: 'B', source: 'hevy', candidates: CANDS },
  ]);
  assert.equal(r.results[0].status, 'AMBIGUOUS');
  assert.equal(r.results[1].status, 'NO_MATCH');
  assert.equal(r.results[0].exerciseId, null);
});

test('an invalid confidence is clamped, not trusted verbatim', async () => {
  connectAux();
  stubGemini({ results: [{ externalName: 'Press banca', status: 'MATCH', exerciseId: '0025', confidence: 7, reason: 'x' }] });
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }]);
  assert.equal(r.results[0].confidence, 1);
});

test('a malformed status is refused (falls back to a safe outcome, not a crash)', async () => {
  connectAux();
  stubGemini({ results: [{ externalName: 'Press banca', status: 'YES_TOTALLY', exerciseId: '0025', confidence: 0.9 }] });
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }]);
  assert.equal(r.ok, true);
  assert.equal(r.results[0].status, 'NO_MATCH');
});

test('invalid JSON from the provider fails the whole batch cleanly, never partially', async () => {
  connectAux();
  stubGemini('this is not json at all, sorry');
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }]);
  assert.equal(r.ok, false);
  assert.ok(r.error);
});

test('a missing "results" array is treated the same as invalid JSON', async () => {
  connectAux();
  stubGemini({ somethingElse: true });
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }]);
  assert.equal(r.ok, false);
});

test('a transient 429 is retried once and then succeeds without reserving a second daily job', async () => {
  connectAux();
  const before = auxAI.jobsToday();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    if (calls === 1) return providerResponse(429, { error: { status: 'RESOURCE_EXHAUSTED', message: 'quota' } });
    return providerResponse(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ results: [{ externalName: 'Press banca', status: 'MATCH', exerciseId: '0025', confidence: .9, reason: 'same lift' }] }) }] }, finishReason: 'STOP' }] });
  };
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }], 'retry-user');
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  assert.equal(auxAI.jobsToday(), before + 1, 'retry belongs to the same reserved import job');
  const log = auxAI.load().log.at(-1);
  assert.equal(log.outcome, 'ready');
  assert.equal(log.attempts, 2);
});

test('a permanent provider rejection is not retried and logs only safe diagnostics', async () => {
  connectAux();
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    return providerResponse(400, { error: { status: 'INVALID_ARGUMENT', message: 'request details that must not enter the log' } });
  };
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }], 'permanent-user');
  assert.equal(r.ok, false);
  assert.equal(calls, 1);
  const log = auxAI.load().log.at(-1);
  assert.equal(log.diagnostic, 'request_rejected');
  assert.equal(log.providerStatus, 400);
  assert.equal(log.providerCode, 'INVALID_ARGUMENT');
  assert.equal(log.attempts, 1);
  assert.ok(!JSON.stringify(log).includes('request details'));
});

test('a transient 503 is attempted at most twice and retains the final safe status', async () => {
  connectAux();
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return providerResponse(503, { error: { status: 'UNAVAILABLE' } }); };
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: CANDS }], 'failed-retry-user');
  assert.equal(r.ok, false);
  assert.equal(calls, 2);
  const log = auxAI.load().log.at(-1);
  assert.equal(log.diagnostic, 'server_error');
  assert.equal(log.providerStatus, 503);
  assert.equal(log.attempts, 2);
});

test('the request body carries only the exercise name/source/candidates — never a uid, workout or history', async () => {
  connectAux();
  const calls = stubGemini({ results: [{ externalName: 'Press banca', status: 'MATCH', exerciseId: '0025', confidence: 0.9, reason: 'ok' }] });
  await matchImportExercises([{ name: 'Press banca', source: 'hevy', muscle: 'chest', candidates: CANDS }]);
  assert.equal(calls.length, 1);
  const sentBody = JSON.parse(calls[0].opts.body);
  const promptText = sentBody.contents[0].parts[0].text;
  // 'date' itself is deliberately not checked here — it's a substring of "candidates", the
  // payload's own legitimate field name, which would make this assertion a false positive.
  for (const forbidden of ['uid', 'email', 'weight', 'reps', 'rpe', 'workout', 'juanjo']) {
    assert.ok(!promptText.toLowerCase().includes(forbidden.toLowerCase()), `payload leaked "${forbidden}"`);
  }
  assert.ok(promptText.includes('Press banca'));
  assert.ok(promptText.includes('0025'));
});
