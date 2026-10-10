import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newInstance, pauseInstance, planSession, originOf } from '../lib/premium-model.js';
import { overviewRow, memberView, aiFacts, premiumOf, AI_PAYLOAD_MAX } from '../lib/coach-followup.js';
import { tempData } from './helpers.mjs';

/* The Coach sheet, the roster row and both AIs read the running Premium program from one summary: no copy of the method, no raw state. */
tempData();
const { build } = await import('../coach/payload.js');
const seed = JSON.parse(fs.readFileSync(new URL('../lib/premium-official.json', import.meta.url), 'utf8')).programs;
const p531 = seed.find(p => p.slug === '531');
const TODAY = '2026-10-20';
const NOW = Date.parse('2026-10-11T10:00:00Z');
const inst = (over = {}) => ({ ...newInstance(p531, { id: 'pr-1', now: NOW, tm: { squat: 100, bench: 70, deadlift: 120, press: 50 } }), ...over });
const withPlan = () => {
  const i = inst(); const plan = planSession(i, []);
  const entries = plan.blocks.filter(b => b.kind === 'fixed').map(b => ({ id: b.exercise, sets: b.sets.map(s => ({ w: s.w, r: s.r, done: true, ...(s.amrap ? { amrap: true } : {}) })) }));
  return { S: { workouts: [{ id: 'w1', d: '2026-10-12', entries, premium: originOf(i, plan) }], premium: { v: 1, active: i, history: [] } } };
};
const u = { id: 'u1', name: 'Ana', created: '2026-06-01T10:00:00.000Z' };

test('the roster row, the sheet and the AI facts carry the label, version, phase, cycle and week', () => {
  const { S } = withPlan();
  const row = overviewRow({ S, u, today: TODAY });
  assert.match(row.premium.label, /^5\/3\/1 · C1 · W1\/4$/); assert.equal(row.premium.status, 'active');
  const view = memberView({ S, u, today: TODAY });
  assert.equal(view.premium.cycle, 1); assert.equal(view.premium.week, 1); assert.equal(view.premium.version, p531.version); assert.equal(view.premium.methodState.trainingMax.squat, 100);
  const facts = aiFacts(view);
  assert.deepEqual([facts.premiumProgram.program, facts.premiumProgram.programVersion, facts.premiumProgram.cycle, facts.premiumProgram.week], ['5/3/1', p531.version, 1, 1]);
  assert.ok(facts.premiumProgram.phase !== undefined);
  assert.ok(JSON.stringify(facts).length <= AI_PAYLOAD_MAX);
  assert.equal(JSON.stringify(facts).includes('Ana'), false, 'no name reaches the AI');
});

test('without a program, or with a corrupt one, the sheet simply has none and nothing throws', () => {
  assert.equal(premiumOf({}), null); assert.equal(overviewRow({ S: {}, u, today: TODAY }).premium, null);
  assert.equal(aiFacts(memberView({ S: {}, u, today: TODAY })).premiumProgram, null);
  assert.equal(premiumOf({ premium: { active: { junk: true } } }), null);
  assert.equal(premiumOf({ premium: { active: 'x' } }), null);
});

test('a paused program is shown as paused and flagged as an incident', () => {
  const { S } = withPlan(); S.premium.active = pauseInstance(S.premium.active, { now: NOW + 1000 });
  const p = premiumOf(S); assert.equal(p.status, 'paused'); assert.ok(p.incidents.includes('paused'));
});

test('the Coach AI payload names the method and its position, and the prompt tells the model to respect it', () => {
  const { S } = withPlan();
  const p = build(S, 'u1', { kind: 'create' });
  assert.equal(p.premiumProgram.program, '5/3/1'); assert.equal(p.premiumProgram.week, 1); assert.equal(p.premiumProgram.programVersion, p531.version);
  assert.equal(build({}, 'u1', { kind: 'create' }).premiumProgram, undefined);
  const prompt = fs.readFileSync(new URL('../coach/prompts/common.md', import.meta.url), 'utf8');
  assert.match(prompt, /premiumProgram/); assert.match(prompt, /never blocked/i);
});
