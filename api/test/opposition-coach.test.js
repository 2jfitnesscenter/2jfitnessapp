import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newPlan, programFor, evaluate, recordEvaluation } from '../lib/opposition-model.js';
import { newInstance } from '../lib/premium-model.js';
import { oppositionOf, oppositionFacts, planAdherence } from '../lib/opposition-context.js';
import { overviewRow, memberView, aiFacts, AI_PAYLOAD_MAX } from '../lib/coach-followup.js';
import { tempData } from './helpers.mjs';

/* The Coach sheet, the roster row and both AIs read the running Oposiciones plan from one summary: real thresholds, no invented marks, no personal data. */
tempData();
const { build } = await import('../coach/payload.js');
const seed = JSON.parse(fs.readFileSync(new URL('../lib/opposition-official.json', import.meta.url), 'utf8')).profiles;
const cegc = seed.find(p => p.slug === 'bomberos-cegc');
const NOW = Date.parse('2026-10-11T10:00:00Z');
const TODAY = '2026-10-20';
const u = { id: 'u1', name: 'Ana Sensible', created: '2026-06-01T10:00:00.000Z' };
const INTAKE = { sex: 'f', age: 29, days: 4, minutes: 60, organism: 'CEGC (texto libre privado)', convocatoria: 'mi convocatoria privada', testVersion: '2025', restrictions: ['knee'], selfLevel: 'intermediate' };
const MARKS = { 'natacion-50': 58, dominadas: 5, 'press-banca': 9, 'velocidad-200': 44, 'resistencia-1500': 450 };

function member({ withMarks = true } = {}) {
  const r = newPlan({ profile: cegc, intake: INTAKE, marks: withMarks ? MARKS : {}, examDate: '2027-04-15', months: 6, now: NOW, id: 'opp-test' });
  assert.ok(!r.error, JSON.stringify(r));
  const inst = newInstance({ ...programFor(r.plan, r.block), id: 'opposition-opp-test-b1' }, { id: 'pr-1', now: NOW });
  return { S: { workouts: [], opposition: { v: 1, plan: r.plan, history: [] }, premium: { v: 1, active: inst, history: [] } }, plan: r.plan };
}

test('the summary carries profile + version, source date, exam date, phase, levels, marks, official thresholds and weak points', () => {
  const { S } = member();
  const o = oppositionOf(S, NOW + 10 * 86400000);
  assert.equal(o.oppositionId, 'opp-bomberos-cegc'); assert.equal(o.oppositionVersion, 1); assert.equal(o.sourceDate, '2025-12-22');
  assert.equal(o.examDate, '2027-04-15'); assert.equal(o.monthsPlan, 6); assert.equal(o.phase, 'base');
  assert.equal(o.levelGlobal, 'beginner'); assert.ok(o.levelByCapacity.pull && o.levelByCapacity.swim);
  assert.deepEqual(o.officialThresholds.dominadas, { minimum: 8, target: 8, unit: 'rep.' });
  assert.equal(o.officialThresholds['natacion-50'].minimum, 52); assert.equal(o.testResults.dominadas, 5);
  assert.equal(o.category, 'f');
  assert.deepEqual(o.missingData, []);
});

test('missing data is named, not filled in: no marks → no results, levels flagged as estimated', () => {
  const { S } = member({ withMarks: false });
  const o = oppositionOf(S, NOW);
  assert.equal(o.levelEstimated, true); assert.deepEqual(o.testResults, {}); assert.equal(o.missingData.length, 5);
  const f = oppositionFacts(o);
  assert.deepEqual(f.testResults, {}); assert.equal(f.missingData.length, 5); assert.equal(f.levelEstimated, true);
  // the thresholds are the official ones, never anything derived from nothing
  assert.equal(f.officialThresholds['resistencia-1500'].minimum, 420);
});

test('the AI facts never carry a name, the sex or age, the category, or any free text the member typed', () => {
  const { S } = member();
  const f = oppositionFacts(oppositionOf(S, NOW));
  const json = JSON.stringify(f);
  for (const bad of ['Ana Sensible', 'CEGC (texto libre', 'convocatoria privada', 'sex', 'age', 'category', 'intake', 'selfLevel']) assert.ok(!json.includes(bad), 'leaks ' + bad);
  assert.deepEqual(f.restrictionAreas, ['knee'], 'only coded areas');
  for (const k of ['oppositionId', 'oppositionVersion', 'examDate', 'monthsPlan', 'phase', 'week', 'testResults', 'weakPoints', 'levelByCapacity', 'officialThresholds', 'adherence']) assert.ok(k in f, k);
});

test('the roster row, the sheet and the AI payload carry the plan; the Coach prompt tells the model to use the real thresholds', () => {
  const { S } = member();
  const row = overviewRow({ S, u, today: TODAY });
  assert.equal(row.opposition.version, 1); assert.equal(row.opposition.phase, 'base'); assert.equal(typeof row.opposition.weeksLeft, 'number');
  const view = memberView({ S, u, today: TODAY });
  assert.equal(view.opposition.oppositionId, 'opp-bomberos-cegc');
  const facts = aiFacts(view);
  assert.equal(facts.oppositionPlan.oppositionVersion, 1); assert.ok(!('name' in facts.oppositionPlan));
  assert.ok(JSON.stringify(facts).length <= AI_PAYLOAD_MAX, 'fits the payload budget with everything else on');
  const p = build(S, 'u1', { kind: 'create' });
  assert.equal(p.oppositionPlan.oppositionId, 'opp-bomberos-cegc'); assert.equal(p.oppositionPlan.phase, 'base');
  assert.equal(build({}, 'u1', { kind: 'create' }).oppositionPlan, undefined);
  const prompt = fs.readFileSync(new URL('../coach/prompts/common.md', import.meta.url), 'utf8');
  assert.match(prompt, /oppositionPlan/); assert.match(prompt, /never invent a mark/i); assert.match(prompt, /missingData/);
});

test('no plan, a finished plan or a corrupt one simply read as none and nothing throws', () => {
  assert.equal(oppositionOf({}), null); assert.equal(overviewRow({ S: {}, u, today: TODAY }).opposition, null); assert.equal(aiFacts(memberView({ S: {}, u, today: TODAY })).oppositionPlan, null);
  assert.equal(oppositionOf({ opposition: { plan: { junk: true } } }), null);
  assert.equal(oppositionOf({ opposition: 'x' }), null);
  const { S } = member(); S.opposition.plan.status = 'finished';
  assert.equal(oppositionOf(S), null);
  assert.equal(planAdherence({}), null);
});

test('an evaluation moves the statuses, the weak points and the review alert into the summary', () => {
  const { S, plan } = member();
  const later = NOW + 36 * 86400000;
  const ev = evaluate(plan, { 'natacion-50': 58, dominadas: 5, 'press-banca': 9, 'velocidad-200': 44, 'resistencia-1500': 450 }, { now: later, adherence: 40, fatigue: 'high', pain: true });
  S.opposition.plan = recordEvaluation(plan, ev);
  const o = oppositionOf(S, later);
  assert.ok(o.weakPoints.length > 0, 'unchanged marks are stalled or at risk'); assert.ok(o.alerts.includes('review'));
  const f = oppositionFacts(o);
  assert.ok(Object.values(f.testStatus).some(s => ['stalled', 'at-risk'].includes(s)));
  assert.equal(overviewRow({ S, u, today: TODAY }).opposition.review, true);
});
