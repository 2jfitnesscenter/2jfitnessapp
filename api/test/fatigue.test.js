import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { followUpSummary } from '../lib/followup.js';

/* Accumulated fatigue on the server (staff signal): the engine is a byte copy of the app's, the alert needs a real multi-signal trend, check-ins only count when
 * the member shared them, and a member without any of this data is untouched. */
test('api/lib/fatigue.js is byte-identical to the frontend engine', () => {
  for (const f of ['fatigue.js', 'routine-review.js']) {
    assert.equal(fs.readFileSync(new URL('../lib/' + f, import.meta.url), 'utf8'), fs.readFileSync(new URL('../../frontend/src/lib/' + f, import.meta.url), 'utf8'), f);
  }
});

const TODAY = '2026-10-20';
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra });
const sessions = (extra) => [0, 1, 2, 3, 4, 5].map(i => ({ id: 'f' + i, d: addDays(TODAY, -(6 - i) * 3), routineId: 'r1',
  entries: ['A', 'B'].map(id => ({ id, target: { id, sets: 2, reps: 8 }, sets: [set(60, 8, extra(i, id)), set(60, 8, extra(i, id))] })) }));
const rising = i => ({ rpe: 7 + i / 2 });
const high = () => sessions((i, id) => ({ ...rising(i), feel: i >= 4 && id === 'A' ? 'fail' : i >= 3 ? 'hard' : 'good' }));

test('a repeated, multi-signal trend raises fatigue_high; one bad session or a single family does not', () => {
  const r = followUpSummary({ workouts: high() }, null, TODAY);
  assert.equal(r.summary.fatigue.level, 'high');
  const a = r.alerts.find(x => x.code === 'fatigue_high');
  assert.ok(a); assert.equal(a.proposed, true); assert.ok(a.signals.some(s => s.code === 'effort_up'));
  const oneBad = followUpSummary({ workouts: sessions((i) => (i === 5 ? { rpe: 10, feel: 'fail' } : { rpe: 7, feel: 'good' })) }, null, TODAY);
  assert.equal(oneBad.summary.fatigue.level, 'normal'); assert.equal(oneBad.alerts.some(x => x.code === 'fatigue_high'), false);
  const onlyEffort = followUpSummary({ workouts: sessions(rising) }, null, TODAY);
  assert.equal(onlyEffort.summary.fatigue.level, 'elevated'); assert.equal(onlyEffort.alerts.some(x => x.code === 'fatigue_high'), false);
});

test('sleep from the state adds a signal; check-ins only with the member\'s consent; an active deload quiets the alert', () => {
  const nights = Array.from({ length: 5 }, (_, i) => ({ d: addDays(TODAY, -i), v: 330 }));
  const hardOnly = sessions((i) => ({ ...rising(i), feel: i >= 3 ? 'hard' : 'good' }));
  assert.equal(followUpSummary({ workouts: hardOnly }, null, TODAY).summary.fatigue.level, 'elevated');
  assert.equal(followUpSummary({ workouts: hardOnly, sleep: nights }, null, TODAY).summary.fatigue.level, 'high');
  const checkins = Array.from({ length: 3 }, (_, i) => ({ d: addDays(TODAY, -i), fatigue: 5 }));
  const w = sessions(rising);
  assert.ok(followUpSummary({ workouts: w, checkins, shareCheckins: true }, null, TODAY).summary.fatigue.signals.some(s => s.code === 'checkins'));
  assert.ok(!followUpSummary({ workouts: w, checkins }, null, TODAY).summary.fatigue.signals.some(s => s.code === 'checkins'), 'not shared → not read');
  const running = followUpSummary({ workouts: high(), deload: { from: addDays(TODAY, -1), until: addDays(TODAY, 6), volumeCut: 0.35, loadCut: 0.075, rir: 3 } }, null, TODAY);
  assert.deepEqual(running.summary.fatigue.deloadActive, { from: addDays(TODAY, -1), until: addDays(TODAY, 6) });
  assert.equal(running.alerts.some(x => x.code === 'fatigue_high'), false);
});

test('members with no or old data are untouched', () => {
  for (const S of [{}, { workouts: [] }, { workouts: [{ d: TODAY }, { d: TODAY, entries: [null, { id: 'A' }, { id: 'A', sets: [null] }] }], sleep: [null] }]) {
    const r = followUpSummary(S, null, TODAY);
    assert.equal(r.summary.fatigue.level, 'normal'); assert.equal(r.summary.fatigue.proposed, false);
    assert.equal(r.alerts.some(x => x.code === 'fatigue_high'), false);
  }
});
