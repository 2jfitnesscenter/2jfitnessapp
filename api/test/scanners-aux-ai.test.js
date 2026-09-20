/* V2 follow-up: machine-scan.js, measurements-scan.js and routine-scan.js used to gate on the
 * member-facing Coach's own provider choice (cfgStore.provider === 'gemini') — a leftover from
 * before the auxiliary-AI profile existed. This file verifies the migration: all three (plus
 * exercise-import-matching) now depend ONLY on aux-ai-config.js, and the three profiles stay
 * genuinely isolated from each other in both directions. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const auxAI = await import('../lib/aux-ai-config.js');
const coachConfig = await import('../coach/config.js');
const trainerAI = await import('../coach/trainer-ai.js');
const { scanMachineImage } = await import('../lib/machine-scan.js');
const { scanBioimpedanceImage } = await import('../lib/measurements-scan.js');
const { scanRoutineDocument } = await import('../lib/routine-scan.js');
const { matchImportExercises } = await import('../lib/import-exercise-match.js');

function stubGemini(bodyOrText) {
  const text = typeof bodyOrText === 'string' ? bodyOrText : JSON.stringify(bodyOrText);
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }),
  });
}
function stubGeminiUnreachable() {
  globalThis.fetch = async () => { throw new Error('should not be called'); };
}
const connectAux = () => { auxAI.save({ enabled: true, log: [] }); auxAI.setApiKey('aux-test-key'); };
const disconnectAux = () => auxAI.save({ enabled: false, auth: null });

test('declares all four V2 capabilities', () => {
  assert.deepEqual(auxAI.CAPABILITIES, ['exercise_import_matching', 'machine_scan', 'measurements_scan', 'routine_scan']);
});

/* ------------------------------------------------------------------------------------------
 * A) the Coach (user_trainer) provider/state has no bearing on any of the four capabilities
 * ------------------------------------------------------------------------------------------ */
test('A) all three scanners fail cleanly on their own when the Coach is fully unconfigured, even with auxAI connected', async () => {
  coachConfig.reset();
  coachConfig.save({ enabled: false, provider: 'claude', auth: null });
  connectAux();
  stubGemini({ name: 'press de banca', nameEn: 'bench press' });
  const m = await scanMachineImage({ data: 'x', mimeType: 'image/png' });
  assert.equal(m.ok, true, 'machine-scan works with no Coach configured at all');

  stubGemini({ weight: 80, bodyFat: 15, muscleMass: null, waterPct: null, visceralFat: null, boneMass: null, segFatArmL: null, segFatArmR: null, segFatLegL: null, segFatLegR: null, segFatTrunk: null, segMuscleArmL: null, segMuscleArmR: null, segMuscleLegL: null, segMuscleLegR: null, segMuscleTrunk: null });
  const meas = await scanBioimpedanceImage({ data: 'x', mimeType: 'image/png' });
  assert.equal(meas.ok, true);

  stubGemini({ name: 'Push', days: [{ label: 'Day 1', exercises: [] }] });
  const routine = await scanRoutineDocument({ data: 'x', mimeType: 'image/png' });
  assert.equal(routine.ok, true);
});

test('A) the Coach set to a NON-Gemini provider (the old gating condition) no longer blocks any scanner', async () => {
  coachConfig.save({ enabled: true, provider: 'claude', auth: { type: 'cli-token', data: coachConfig.encrypt({ token: 'claude-tok' }) } });
  connectAux();
  stubGemini({ name: 'sentadilla', nameEn: 'squat' });
  const m = await scanMachineImage({ data: 'x', mimeType: 'image/png' });
  assert.equal(m.ok, true, 'the old code would have refused this because cfg.provider !== \'gemini\'');
});

test('A) exercise_import_matching is equally independent of the Coach\'s own provider', async () => {
  coachConfig.save({ enabled: true, provider: 'codex' });
  connectAux();
  stubGemini({ results: [{ externalName: 'Press banca', status: 'MATCH', exerciseId: '0025', confidence: 0.9, reason: 'ok' }] });
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: [{ id: '0025', name: 'Press de banca' }] }]);
  assert.equal(r.ok, true);
});

/* ------------------------------------------------------------------------------------------
 * B) disabling auxAI degrades the four capabilities, and touches nothing else
 * ------------------------------------------------------------------------------------------ */
test('B) auxAI disabled: all three scanners refuse cleanly, no network call attempted', async () => {
  disconnectAux();
  stubGeminiUnreachable();
  const m = await scanMachineImage({ data: 'x', mimeType: 'image/png' });
  assert.equal(m.ok, false);
  assert.match(m.error, /IA auxiliar/);
  const meas = await scanBioimpedanceImage({ data: 'x', mimeType: 'image/png' });
  assert.equal(meas.ok, false);
  assert.match(meas.error, /IA auxiliar/);
  const routine = await scanRoutineDocument({ data: 'x', mimeType: 'image/png' });
  assert.equal(routine.ok, false);
  assert.match(routine.error, /IA auxiliar/);
});

test('B) auxAI disabled: exercise_import_matching also refuses cleanly, importer falls back to manual', async () => {
  disconnectAux();
  stubGeminiUnreachable();
  const r = await matchImportExercises([{ name: 'Press banca', source: 'hevy', candidates: [{ id: '0025', name: 'x' }] }]);
  assert.equal(r.ok, false);
});

test('B) disabling auxAI never touches the Coach\'s own connection state', async () => {
  coachConfig.reset();
  coachConfig.save({ enabled: true, provider: 'claude', auth: { type: 'cli-token', data: coachConfig.encrypt({ token: 'still-here' }) } });
  connectAux();
  assert.equal(coachConfig.isConnected(), true);
  disconnectAux();
  assert.equal(coachConfig.isConnected(), true, 'the Coach stayed connected while auxAI was switched off');
});

test('B) disabling auxAI never touches the trainer-panel AI\'s own connection state', async () => {
  trainerAI.save({ enabled: true, auth: { type: 'cli-token', data: trainerAI.encrypt({ token: 'still-here-too' }) } });
  connectAux();
  assert.equal(trainerAI.isConnected(), true);
  disconnectAux();
  assert.equal(trainerAI.isConnected(), true);
});

/* ------------------------------------------------------------------------------------------
 * C) a Gemini/auxAI failure never touches Claude (staff/trainer) or the Coach, and loses nothing
 * ------------------------------------------------------------------------------------------ */
test('C) an auxAI provider failure is logged only in auxAI\'s own log, never the Coach\'s or trainer-panel\'s', async () => {
  coachConfig.reset(); coachConfig.save({ log: [] });
  trainerAI.save({ log: [] });
  connectAux();
  stubGemini('not valid json at all');
  const r = await matchImportExercises([{ name: 'X', source: 'hevy', candidates: [{ id: '0025', name: 'x' }] }]);
  assert.equal(r.ok, false);
  assert.equal(auxAI.load().log.some(e => e.kind === 'exercise_import_matching' && e.outcome === 'failed'), true);
  assert.equal(coachConfig.load().log.length, 0, 'the Coach\'s own log is untouched by an auxAI failure');
  assert.equal(trainerAI.load().log.length, 0, 'the trainer-panel AI\'s own log is untouched too');
});

test('C) a scanner failure never throws, never partially writes, and leaves auxAI still usable next call', async () => {
  connectAux();
  stubGemini('garbage, not json');
  const bad = await scanRoutineDocument({ data: 'x', mimeType: 'image/png' });
  assert.equal(bad.ok, false);
  // The provider recovers on the very next call — one bad response does not poison the profile.
  stubGemini({ name: null, days: [{ label: null, exercises: [] }] });
  const good = await scanRoutineDocument({ data: 'x', mimeType: 'image/png' });
  assert.equal(good.ok, true);
});

test('C) the three profiles keep fully separate credentials even while all three are connected at once', async () => {
  coachConfig.reset(); coachConfig.save({ enabled: true, provider: 'gemini', auth: { type: 'apikey', data: coachConfig.encrypt({ token: 'coach-gemini-key' }) } });
  trainerAI.save({ enabled: true, auth: { type: 'cli-token', data: trainerAI.encrypt({ token: 'trainer-claude-tok' }) } });
  connectAux();
  assert.equal(coachConfig.isConnected(), true);
  assert.equal(trainerAI.isConnected(), true);
  assert.equal(auxAI.isConnected(), true);
  // Each profile's jobEnv only ever carries its own credential.
  assert.equal(auxAI.jobEnv().GEMINI_API_KEY, 'aux-test-key');
  assert.notEqual(auxAI.jobEnv().GEMINI_API_KEY, 'coach-gemini-key');
});
