import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData } from './helpers.mjs';

const DIR = tempData();
const auxAI = await import('../lib/aux-ai-config.js');
const coachConfig = await import('../coach/config.js');
const trainerAI = await import('../coach/trainer-ai.js');

test('an unconfigured instance offers nothing', () => {
  assert.equal(auxAI.isEnabled(), false);
  assert.equal(auxAI.isConnected(), false);
  assert.equal(auxAI.publicConfig(), null);
});

test('declares the four V2 capabilities, and nothing more', () => {
  // exercise_import_matching was V2's first capability; machine_scan/measurements_scan/
  // routine_scan joined it once the three existing scanners migrated off the Coach's own
  // provider choice — see test/scanners-aux-ai.test.js for that migration's own coverage.
  assert.deepEqual(auxAI.CAPABILITIES, ['exercise_import_matching', 'machine_scan', 'measurements_scan', 'routine_scan']);
});

test('enabled but no key yet is still not connected', () => {
  auxAI.save({ enabled: true });
  assert.equal(auxAI.isEnabled(), true);
  assert.equal(auxAI.isConnected(), false);
});

test('an API key round-trips through encryption and is not on disk in the clear', () => {
  auxAI.setApiKey('AQ.some-gemini-key');
  assert.equal(auxAI.isConnected(), true);
  const onDisk = fs.readFileSync(`${DIR}/aux-ai.json`, 'utf8');
  assert.ok(!onDisk.includes('AQ.some-gemini-key'), 'the key never sits in the file in the clear');
  const env = auxAI.jobEnv();
  assert.equal(env.GEMINI_API_KEY, 'AQ.some-gemini-key');
});

test('an empty key is refused', () => {
  assert.throws(() => auxAI.setApiKey('   '), /API key/);
});

test('disconnect clears the credential and drops back to disconnected', () => {
  auxAI.disconnect();
  assert.equal(auxAI.isConnected(), false);
  assert.equal(auxAI.authStatus().state, 'disconnected');
});

test('lives in its own file, own encryption namespace — a Coach-encrypted blob does not decrypt here', () => {
  coachConfig.reset();
  const coachBlob = coachConfig.encrypt({ token: 'coach-secret' });
  assert.equal(auxAI.decrypt(coachBlob), null, 'a leaked blob from one profile is not readable with another\'s key');
  const trainerBlob = trainerAI.encrypt({ token: 'trainer-secret' });
  assert.equal(auxAI.decrypt(trainerBlob), null);
});

test('enabling/disabling this profile never touches the Coach or trainer-panel AI config', () => {
  coachConfig.save({ enabled: true, provider: 'claude', auth: { type: 'cli-token', data: coachConfig.encrypt({ token: 'x' }) } });
  trainerAI.save({ enabled: true, auth: { type: 'cli-token', data: trainerAI.encrypt({ token: 'y' }) } });
  auxAI.save({ enabled: false, auth: null });
  assert.equal(coachConfig.isConnected(), true, 'the Coach stays connected');
  assert.equal(trainerAI.isConnected(), true, 'the trainer AI stays connected');
  assert.equal(auxAI.isConnected(), false, 'only the auxiliary profile changed');
});

test('the instance job log records outcomes only, never a workout or an exercise name', () => {
  auxAI.save({ log: [] });
  auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'ready', ms: 800, detail: '3 items' });
  auxAI.logJob({ at: new Date().toISOString(), kind: 'exercise_import_matching', outcome: 'failed', errorClass: 'timeout', ms: 45000 });
  const log = auxAI.load().log;
  assert.equal(log.length, 2);
  assert.equal(auxAI.lastError().errorClass, 'timeout');
  assert.equal(auxAI.lastSuccess().outcome, 'ready');
  assert.ok(!JSON.stringify(log).includes('Press'), 'no exercise name ever reaches the instance log');
});
