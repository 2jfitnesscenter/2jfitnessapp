/* The 2J protocol between any model and anyone's plan — end to end through the real queue,
   the real validators and a real child process; the only fake is the provider (fixture-cli). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, writeState, sampleState } from './helpers.mjs';

const DIR = tempData();
const cfg = await import('../coach/config.js');
const jobs = await import('../coach/jobs.js');
const payloadLib = await import('../coach/payload.js');
const gate = await import('../coach/protocol-gate.js');
cfg.save({ enabled: true, provider: 'fixture', caps: { perProfileDaily: 0, instanceDaily: 0 } });

async function settle(uid, ms = 15000) {
  const until = Date.now() + ms;
  while (Date.now() < until) { const s = jobs.status(uid); if (!s.job) return s; await new Promise(r => setTimeout(r, 25)); }
  throw new Error('job never finished');
}
const last = uid => jobs.readUser(uid).history.at(-1);
const create = (uid, intake = { goal: 'hypertrophy', daysPerWeek: 1, equipment: ['dumbbell'] }) => {
  writeState(DIR, uid, sampleState({ routines: [], week: {}, workouts: [] }));
  jobs.enqueue(uid, { kind: 'create', intake });
};

test('the model receives the relevant protocol slice and official blocks — not the docs', () => {
  const p = payloadLib.build(sampleState(), 'u-p', { kind: 'create', intake: { goal: 'hypertrophy', experience: 'new', restrictions: ['no-jumps', 'invented'] } });
  assert.equal(p.protocol.version, '1.0');
  assert.equal(p.protocol.goal, 'hypertrophy');
  assert.equal(p.protocol.level, 'beginner', 'a new lifter is handled as a beginner');
  assert.deepEqual(p.protocol.restrictions, ['no-jumps']);
  assert.ok(p.protocol.officialBlocks.length > 0 && p.protocol.officialBlocks.every(b => b.id.startsWith('off-')));
  assert.ok(!JSON.stringify(p.protocol).includes('Refalo'), 'no bibliography in the prompt');
  assert.ok(JSON.stringify(p.protocol).length < 12000);
  assert.equal(gate.protocolContext({}, { goal: 'fatloss' }).goal, 'general', 'fat loss is not a circuit mandate');
});

test('the model receives compact official guided programs and only summary progress for an active one', () => {
  const S = sampleState({ activeProgramId: 'gp-1', programs: [{ id: 'gp-1', source: 'guided-v2', status: 'active', name: 'Mobility', meta: { goal: 'general' }, weeks: [{ sessions: [{ day: 1, routineId: 'r2j-mobility-fullbody' }] }] }],
    workouts: [{ src2j: { program: { programId: 'gp-1', sessionId: '1:1:0' } } }] });
  const p = payloadLib.build(S, 'u-program', { kind: 'create', intake: { goal: 'general', experience: 'regular' } });
  assert.ok(p.protocol.officialPrograms.some(x => x.id === 'g2j-beginner-4w'));
  assert.deepEqual(p.protocol.activeProgram, { id: 'gp-1', name: 'Mobility', goal: 'general', status: 'active', completed: 1, total: 1, next: null });
  assert.equal(JSON.stringify(p.protocol.activeProgram).includes('sets'), false, 'progress summary does not copy workout/set history');
});

test('a plan that fails the protocol twice is never shown or saved', async () => {
  process.env.FIXTURE_MODE = 'protocol-fail';
  create('u-fail');
  const s = await settle('u-fail');
  delete process.env.FIXTURE_MODE;
  assert.equal(last('u-fail').outcome, 'failed');
  assert.equal(s.pending, null);
});

test('a protocol FAIL goes back to the model once, and a valid repair is accepted', async () => {
  process.env.FIXTURE_MODE = 'protocol-fail-then-valid';
  create('u-repair', { goal: 'hypertrophy', daysPerWeek: 3, equipment: ['dumbbell'] });
  const s = await settle('u-repair');
  delete process.env.FIXTURE_MODE;
  assert.equal(last('u-repair').outcome, 'ready');
  assert.ok(['PASS', 'PASS_WITH_REASON'].includes(s.pending.bundle.protocol.result));
  assert.equal(s.pending.bundle.protocol.v, '1.0');
});

test('official blocks are reused as copies, tagged as instances', async () => {
  process.env.FIXTURE_MODE = 'use-blocks';
  create('u-blocks');
  const s = await settle('u-blocks');
  delete process.env.FIXTURE_MODE;
  assert.equal(last('u-blocks').outcome, 'ready');
  const r = s.pending.bundle.routines[0];
  assert.equal(r.blocks.length, 1);
  assert.ok(r.blocks[0].src.startsWith('off-'));
  assert.ok(r.ex.length >= 2 && r.ex.every(e => e.blk === r.blocks[0].iid));
  assert.ok(r.ex.every(e => Array.isArray(e.rpe) && e.rpe.every(v => [4, 6, 8, 10].includes(v))));
});

test('explicit restrictions win over the model and over the library', () => {
  const plan = { name: 'x', routines: [{ id: 'r1', name: 'Legs', ex: [{ id: '0043', sets: 3, mode: 'reps', reps: 8 }] }], week: { 1: 'r1' } };
  const r = gate.gatePlan(plan, { goal: 'hypertrophy', level: 'intermediate', restrictions: ['no-deep-knee-flexion'], unavailableEq: [] });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /restriction/);
  assert.equal(gate.expandBlocks({ routines: [{ id: 'r1', blocks: ['off-nope'] }] }).errors.length, 1, 'unknown block ids go to repair');
  // An exercise the protocol can only guess about is never accepted from a model under a declared
  // restriction — it goes back for a verifiable alternative (a trainer would only get a warning).
  const guessed = { name: 'x', routines: [{ id: 'r1', name: 'Jumps', ex: [{ id: '3543', sets: 3, mode: 'reps', reps: 5 }] }], week: { 1: 'r1' } };
  const g = gate.gatePlan(guessed, { goal: 'general', level: 'intermediate', restrictions: ['no-jumps'], unavailableEq: [] });
  assert.equal(g.ok, false);
  assert.match(g.errors.join(' '), /restriction_unverified/);
  assert.equal(gate.gatePlan(guessed, { goal: 'general', level: 'intermediate', restrictions: [], unavailableEq: [] }).ok, true);
});

test('a review that would introduce a protocol FAIL is discarded; nothing changes silently', async () => {
  const uid = 'u-review';
  // A curated exercise (dumbbell curl): the FAIL is certain. On an uncurated one it would only be
  // 'unverified' — the validator never fails a plan on a name-based guess.
  writeState(DIR, uid, sampleState({ coach: { consent: { agreedAt: new Date().toISOString(), version: 1 }, profile: { goal: 'hypertrophy', daysPerWeek: 3 } },
    routines: [{ id: 'r1', name: 'Arms', emoji: '💪', prog: 'linear', ex: [{ id: '0294', sets: 3, reps: 10, mode: 'reps' }] }] }));
  process.env.FIXTURE_MODE = 'review-protocol-fail';
  jobs.enqueue(uid, { kind: 'review' });
  const s = await settle(uid);
  delete process.env.FIXTURE_MODE;
  assert.equal(last(uid).outcome, 'failed');
  assert.equal(s.pending, null);
  // pre-existing problems are not blamed on the model
  const plan = { routines: [{ id: 'r1', ex: [{ id: '0294', sets: 3, mode: 'reps', reps: 60 }] }] };
  assert.equal(gate.gateReview({ changes: [{ type: 'sets', target: { routineId: 'r1', exId: '0294' }, after: 4 }] }, plan, { goal: 'hypertrophy', level: 'intermediate', restrictions: [] }).ok, true);
});
