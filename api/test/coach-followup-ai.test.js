import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

/* "Analizar seguimiento" through the real queue and validator, with a fake provider: what it is sent, what it is allowed to return, caching, caps and failures. */
tempData();
const trainerAI = await import('../coach/trainer-ai.js');
const ai = await import('../coach/followup-ai.js');
const { memberView, aiFacts, AI_PAYLOAD_MAX } = await import('../lib/coach-followup.js');

const TODAY = new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const S = { week: { 1: 'r1', 3: 'r1' }, routines: [{ id: 'r1', ex: [{ id: '0025' }] }], workouts: [{ id: 'w', d: addDays(TODAY, -20), entries: [{ id: '0025', target: { sets: 3 }, sets: [{ w: 60, r: 8, done: true }] }] }] };
const facts = aiFacts(memberView({ S, u: { id: 'u1', name: 'NOMBRE-SECRETO', created: '2026-01-01T00:00:00.000Z', followUp: { template: 'basic', cadence: 'monthly', days: 30, startedAt: TODAY, reviews: [], goalPlan: { label: 'etiqueta' } } }, today: TODAY }));

const ANSWER = { coach_followup: 1, summary: ['Hace 20 días sin entrenar.'], keyData: [{ tag: 'fact', text: 'Último entreno hace 20 días.' }, { tag: 'inference', text: 'La adherencia es baja.' }, { tag: 'suggestion', text: 'Preguntar por disponibilidad.' }],
  review: [{ tag: 'suggestion', text: 'Revisar frecuencia.' }], proposal: [{ action: 'add_note', text: 'Registrar la conversación.' }] };
let calls = [], reply = () => ({ code: 0, text: JSON.stringify(ANSWER), stderr: '' });
ai.setAdapterForTests({ invoke: async args => { calls.push(args); return reply(args); } });
const settle = async (t, m) => { for (let i = 0; i < 200; i++) { const s = ai.status(t, m); if (!s.job) return s; await new Promise(r => setTimeout(r, 15)); } throw new Error('never finished'); };

test('off by default: nothing is sent, the caller keeps the deterministic analysis', () => {
  assert.equal(ai.available(), false);
  assert.throws(() => ai.enqueue('tr', 'u1', facts), e => e.code === 'off');
  assert.equal(calls.length, 0);
});

test('with the trainer AI connected: the provider receives only the compact facts, and the answer is validated and tagged', async () => {
  trainerAI.save({ enabled: true });
  trainerAI.setSetupToken('fake-token');
  assert.equal(ai.available(), true);
  const job = ai.enqueue('tr', 'u1', facts, 'es');
  assert.equal(job.cached, false);
  const s = await settle('tr', 'u1');
  assert.equal(s.errorClass, null);
  assert.equal(s.result.summary[0], ANSWER.summary[0]);
  assert.deepEqual(s.result.keyData.map(x => x.tag), ['fact', 'inference', 'suggestion']);
  assert.equal(s.result.proposal[0].action, 'add_note');
  assert.equal(calls.length, 1);
  const prompt = calls[0].prompt;
  assert.ok(prompt.length < AI_PAYLOAD_MAX + 6000, 'prompt = instructions + a bounded fact set');
  assert.ok(prompt.includes('FACTS (JSON)') && prompt.includes('lang: es'));
  const sent = JSON.parse(prompt.slice(prompt.indexOf('{', prompt.indexOf('FACTS (JSON)'))));
  assert.ok(!prompt.includes('NOMBRE-SECRETO'), 'no name');
  for (const k of ['workouts', 'entries', 'sets', 'notes', 'privateNotes', 'trainerNotes', 'name', 'id']) assert.ok(!(k in sent), 'no raw state key: ' + k);
  assert.match(prompt, /never change a program/i);
  assert.equal(calls[0].env.HOME, calls[0].jobDir, 'runs in its own job directory like every other AI job');
});

test('the same facts within the cache window cost no new provider call; different facts do', async () => {
  const before = calls.length;
  const again = ai.enqueue('tr', 'u1', facts, 'es');
  assert.equal(again.cached, true); assert.equal(calls.length, before);
  assert.equal(ai.status('tr', 'u1').result.cached, true);
  const other = { ...facts, today: addDays(TODAY, 1) };
  assert.equal(ai.enqueue('tr', 'u1', other, 'es').cached, false);
  await settle('tr', 'u1');
  assert.equal(calls.length, before + 1);
  assert.equal(ai.enqueue('tr', 'u1', other, 'en').cached, false, 'another language is another answer');
  await settle('tr', 'u1');
});

test('medical wording, a missing contract or an applicable change are refused (the screen keeps the deterministic analysis)', async () => {
  for (const bad of [
    { ...ANSWER, summary: ['Posible sobreentrenamiento.'] },
    { ...ANSWER, coach_followup: 2 },
    { ...ANSWER, apply: { routines: [] } },
    { ...ANSWER, keyData: ANSWER.keyData.slice(0, 1) },
  ]) {
    reply = () => ({ code: 0, text: JSON.stringify(bad), stderr: '' });
    ai.discard('tr', 'u9');
    ai.enqueue('tr', 'u9', { ...facts, today: Math.random().toString(36) });
    const s = await settle('tr', 'u9');
    assert.equal(s.result, null); assert.equal(s.errorClass, 'unusable');
  }
  reply = () => ({ code: 0, text: 'esto no es JSON', stderr: '' });
  ai.enqueue('tr', 'u8', { ...facts, today: 'x8' });
  assert.equal((await settle('tr', 'u8')).errorClass, 'unusable');
});

test('provider failures are classified, one analysis at a time per member, and the daily cap is shared with the trainer AI', async () => {
  reply = () => ({ code: 1, text: '', stderr: 'unauthorized 401' });
  ai.enqueue('tr', 'u7', { ...facts, today: 'x7' });
  assert.equal((await settle('tr', 'u7')).errorClass, 'auth');
  reply = () => new Promise(r => setTimeout(() => r({ code: 0, text: JSON.stringify(ANSWER), stderr: '' }), 120));
  ai.enqueue('tr', 'u6', { ...facts, today: 'x6' });
  assert.throws(() => ai.enqueue('tr', 'u6', { ...facts, today: 'x6b' }), e => e.code === 'busy');
  await settle('tr', 'u6');
  trainerAI.save({ caps: { instanceDaily: 1 } });
  assert.throws(() => ai.enqueue('tr', 'u5', { ...facts, today: 'x5' }), e => e.code === 'cap');
  trainerAI.save({ caps: { instanceDaily: 0 } });
  assert.throws(() => ai.enqueue('tr', 'u5', { ...facts, big: 'y'.repeat(AI_PAYLOAD_MAX) }), e => e.code === 'size');
  assert.deepEqual(trainerAI.load().log.map(e => e.flow).filter(Boolean).every(f => f === 'followup'), true);
  assert.doesNotMatch(JSON.stringify(trainerAI.load().log), /NOMBRE-SECRETO|FACTS/, 'the instance log has counts and outcomes only');
});
