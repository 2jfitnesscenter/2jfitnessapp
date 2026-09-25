import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWorkouts } from '../whoop/client.js';
import { SCOPE } from '../whoop/oauth.js';

// Fitness V1: WHOOP workouts are read with read:workout, paginated by next_token, and only the
// fields 2J uses leave this module — never the rest of the payload.
const page = (records, next) => ({ ok: true, status: 200, json: async () => ({ records, next_token: next }) });

test('asks for read:workout alongside the existing read-only scopes', () => {
  for (const s of ['read:recovery', 'read:sleep', 'read:workout', 'offline']) assert.ok(SCOPE.split(' ').includes(s), s);
});

test('paginates and keeps only the fields 2J uses', async () => {
  const calls = [];
  const rec = (id, extra = {}) => ({ id, start: '2026-09-20T16:01:00Z', end: '2026-09-20T17:10:00Z', sport_name: 'weightlifting', score_state: 'SCORED', user_id: 999, secret: 'x',
    score: { strain: 12, kilojoule: 2000, average_heart_rate: 140, max_heart_rate: 180, percent_recorded: 100, zone_durations: { zone_one_milli: 60000 } }, ...extra });
  const fetchImpl = async url => { calls.push(url); return calls.length === 1 ? page([rec('a')], 'tok') : page([rec('b')], null); };
  const r = await fetchWorkouts('T', { start: '2026-09-01T00:00:00Z', fetchImpl });
  assert.equal(r.scopeMissing, false);
  assert.deepEqual(r.workouts.map(w => w.id), ['a', 'b']);
  assert.match(calls[1], /nextToken=tok/);
  assert.equal(r.workouts[0].user_id, undefined);
  assert.equal(r.workouts[0].secret, undefined);
  assert.deepEqual(Object.keys(r.workouts[0].score).sort(), ['average_heart_rate', 'kilojoule', 'max_heart_rate', 'strain', 'zone_durations']);
});

test('an older connection without read:workout is reported, not thrown', async () => {
  const r = await fetchWorkouts('T', { start: 'x', fetchImpl: async () => ({ ok: false, status: 403 }) });
  assert.deepEqual(r, { scopeMissing: true, workouts: [] });
  await assert.rejects(fetchWorkouts('T', { start: 'x', fetchImpl: async () => ({ ok: false, status: 500 }) }));
});
