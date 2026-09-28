import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const dir = tempData();
const { compactSignal, explainSignal, validExplanation } = await import('../coach/intelligence.js');
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
cfg.save({ enabled: true, provider: 'fixture' });

test('provider payload is a closed enum plus bounded numbers, without Health or Community', () => {
  const signal = compactSignal({ type: 'PROGRESSION_READY', facts: {
    sessions: 2, weight: 80, next: 82.5, note: 'private', health: { diagnosis: 'private' },
    community: 'private', exerciseId: 'personal-id', days: -1
  } });
  assert.deepEqual(signal, { type: 'PROGRESSION_READY', facts: { sessions: 2, weight: 80, next: 82.5 } });
  assert.equal(compactSignal({ type: 'MEDICAL_DIAGNOSIS' }), null);
  assert.equal(validExplanation('Tu recuperación WHOOP confirma que debes descansar hoy.'), null);
});

test('optional explanation succeeds but carries no decision or action', async () => {
  const calls = [];
  const adapter = { invoke: async args => {
    calls.push(args.prompt);
    return { code: 0, text: JSON.stringify({ explanation: 'Puedes mantener el plan y revisar cómo te encuentras antes de buscar progresión.' }) };
  } };
  const result = await explainSignal({ type: 'PROGRESSION_READY', facts: { sessions: 2, privateNote: 'secret' } }, { adapter });
  assert.equal(result.ok, true);
  assert.equal(Object.keys(result).sort().join(','), 'explanation,ok');
  assert.equal(calls.length, 1);
  assert.doesNotMatch(calls[0], /secret|privateNote|health|community/i);
});

test('unavailable provider and invalid response fall back to the existing deterministic card', async () => {
  const unavailable = await explainSignal({ type: 'PLATEAU' }, { adapter: { invoke: async () => ({ code: 1, text: '', stderr: 'HTTP 401 unauthorized' }) } });
  assert.equal(unavailable.ok, false);
  let attempts = 0;
  const invalid = await explainSignal({ type: 'PLATEAU' }, { adapter: { invoke: async () => {
    attempts++;
    return { code: 0, text: JSON.stringify({ explanation: 'Debes aumentar 20 kg porque estás sobreentrenado.' }) };
  } } });
  assert.deepEqual(invalid, { ok: false, error: 'unusable' });
  assert.equal(attempts, 2); // one existing-style repair round, no uncontrolled loop
});

test('server-side consent, single-flight and daily caps protect optional explanations', () => {
  writeState(dir, 'no-consent', sampleState({ coach: {} }));
  assert.throws(() => jobs.claimExplanation('no-consent'), e => e.code === 'consent');
  writeState(dir, 'consented', sampleState());
  cfg.save({ caps: { perProfileDaily: 1, instanceDaily: 0 } });
  const release = jobs.claimExplanation('consented');
  assert.throws(() => jobs.claimExplanation('consented'), e => e.code === 'busy');
  release();
  assert.throws(() => jobs.claimExplanation('consented'), e => e.code === 'cap');
});

test('HTTP explanation route rejects unauthenticated and unconsented callers before provider use', async () => {
  cfg.save({ caps: { perProfileDaily: 10, instanceDaily: 0 } });
  const { coachRoutes } = await import('../coach/routes.js');
  let response;
  const routes = coachRoutes({
    json: (_res, status, body) => { response = { status, body }; },
    readBody: async () => ({ type: 'PLATEAU' }),
    readSession: req => req.user || null,
    requireAdmin: () => false,
  });
  const route = routes['POST /api/coach/intelligence/explain'];
  await route({}, {});
  assert.equal(response.status, 401);
  await route({ user: { id: 'no-consent' } }, {});
  assert.equal(response.status, 403);
  assert.equal(response.body.code, 'consent');
});
