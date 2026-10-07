import test from 'node:test';
import assert from 'node:assert/strict';
import { countsForProgression, progressionWorkouts } from '../lib/workout-policy.js';

test('legacy workouts remain included while excluded and absent records are not progression inputs', () => {
  assert.equal(countsForProgression({ id: 'legacy' }), true);
  assert.equal(countsForProgression({ id: 'included', excludeFromProgression: false }), true);
  assert.equal(countsForProgression({ id: 'excluded', excludeFromProgression: true }), false);
  assert.equal(countsForProgression(null), false);
  assert.equal(countsForProgression(undefined), false);
  assert.deepEqual(progressionWorkouts([null, { id: 'old' }, { id: 'test', excludeFromProgression: true }]).map(x => x.id), ['old']);
});
