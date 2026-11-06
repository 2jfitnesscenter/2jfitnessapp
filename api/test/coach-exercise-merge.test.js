import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';

tempData();
const payload = await import('../coach/payload.js');

// sampleState trains 0001 (routine + one workout) and 0007 (routine only). Merging 0007 into 0001 is the fixture:
// the member's own history says "0007" happened, but the provider must only ever see 0001.
const merged = () => sampleState({
  exMerges: { '0007': '0001' },
  workouts: [{
    id: 'w1', d: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10), name: 'Full body A', start: 1000, end: 1000 + 45 * 60000, vol: 600, prs: [],
    entries: [
      { id: '0001', target: { sets: 3, reps: 10, weight: 20 }, sets: [{ w: 20, r: 10, done: true, rpe: 9 }] },
      { id: '0007', target: { sets: 2, sec: 45 }, sets: [{ w: 0, r: 0, sec: 45, done: true }] }
    ]
  }]
});

const ids = list => list.map(e => e.id);

test('a merged-away exercise is sent as its target in the plan and the workout history', () => {
  const p = payload.build(merged(), 'u-merge', { kind: 'review' });
  const planIds = p.plan.routines.flatMap(r => ids(r.ex));
  assert.ok(!planIds.includes('0007'), 'the merged-away id must not appear in the plan');
  assert.ok(planIds.includes('0001'));
  const sessionIds = p.window.workouts.flatMap(w => ids(w.entries));
  assert.ok(!sessionIds.includes('0007'), 'the merged-away id must not appear in the workouts');
  assert.equal(sessionIds.filter(id => id === '0001').length, 2, 'both entries count for the target');
});

test('the merged-away exercise is not offered as a library candidate, its target still is', () => {
  const pool = payload.librarySlice(merged(), []).map(e => e.id);
  assert.ok(!pool.includes('0007'), 'merged-away exercise must not be offered');
  assert.ok(pool.includes('0001'));
});

test('undo restores the original exercise in the payload (nothing stored was rewritten)', () => {
  const S = merged();
  const undone = { ...S };
  delete undone.exMerges;
  const planIds = payload.build(undone, 'u-merge', { kind: 'review' }).plan.routines.flatMap(r => ids(r.ex));
  assert.ok(planIds.includes('0007'));
  // The stored state itself is untouched by building the payload.
  assert.equal(S.routines[0].ex[1].id, '0007');
  assert.equal(S.workouts[0].entries[1].id, '0007');
});

test('chains resolve to the end; a mapping to a missing target is ignored', () => {
  const chain = sampleState({ exMerges: { '0007': '0002', '0002': '0001' } });
  assert.deepEqual(payload.applyExerciseMerges(chain).routines[0].ex.map(e => e.id), ['0001', '0001']);
  const dangling = sampleState({ exMerges: { '0007': 'no-such-exercise' } });
  assert.equal(payload.applyExerciseMerges(dangling).routines[0].ex[1].id, '0007');
});
