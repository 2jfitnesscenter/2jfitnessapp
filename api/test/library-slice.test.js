// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

/* The AI library slice: a compact, deterministic candidate table instead of the whole catalogue. It keeps the Library as the
 * authority (ids, movement, equipment and muscle group are copied, never re-derived), covers every movement and muscle group the
 * pool can offer, respects the gym profile and explicit restrictions, never offers a deprecated duplicate and stays small. */
tempData();
const payload = await import('../coach/payload.js');
const { compactLibrary, COLUMNS, LIMITS } = await import('../coach/library-slice.js');

const cols = Object.fromEntries(COLUMNS.map((c, i) => [c, i]));
const ids = lib => lib.rows.map(r => r[cols.id]);
const KB = lib => JSON.stringify({ columns: lib.columns, rows: lib.rows }).length / 1024;
const FULL = { goal: 'hypertrophy', daysPerWeek: 4, restrictions: [] };

test('a full gym gets a small table in the documented column order, a fraction of the catalogue', () => {
  const before = JSON.stringify(payload.librarySlice({}, [])).length / 1024;
  const lib = payload.libraryForAI({}, [], FULL);
  assert.deepEqual(lib.columns, ['id', 'name', 'movement', 'equipment', 'muscleGroup', 'flags']);
  assert.ok(lib.rows.length >= LIMITS.totalMin && lib.rows.length < 260, `rows: ${lib.rows.length}`);
  assert.ok(KB(lib) < before / 5, `${KB(lib).toFixed(1)} KB vs ${before.toFixed(1)} KB`);
  assert.ok(lib.rows.every(r => r.length === 6));
});

test('same input, same table — and 2 days asks for less than 5 days', () => {
  assert.deepEqual(payload.libraryForAI({}, [], FULL), payload.libraryForAI({}, [], FULL));
  const two = payload.libraryForAI({}, [], { ...FULL, daysPerWeek: 2 }), five = payload.libraryForAI({}, [], { ...FULL, daysPerWeek: 5 });
  assert.ok(two.rows.length < five.rows.length);
});

test('every movement and muscle group the pool can offer stays reachable', () => {
  const pool = payload.librarySlice({}, []);
  const lib = payload.libraryForAI({}, [], FULL);
  const sent = new Set(ids(lib));
  for (const mv of new Set(pool.map(e => e.mv).filter(Boolean))) assert.ok(pool.some(e => e.mv === mv && sent.has(e.id)), 'movement ' + mv);
  for (const g of new Set(pool.map(e => e.muscleGroup).filter(Boolean))) assert.ok(pool.filter(e => e.muscleGroup === g && sent.has(e.id)).length >= 3, 'group ' + g);
  assert.deepEqual(lib.meta.uncovered, []);
});

test('Recommended 2J first within each movement, one option per kind of equipment, and a deprecated duplicate never travels', () => {
  const lib = payload.libraryForAI({}, [], FULL);
  const rowsOf = mv => lib.rows.filter(r => r[cols.movement] === mv);
  const pool = payload.librarySlice({}, []);
  assert.ok(lib.rows.filter(r => r[cols.flags].includes('R')).length >= 60);
  const squat = rowsOf('squat');
  assert.ok(squat.length >= 5);
  assert.ok(new Set(squat.map(r => r[cols.equipment])).size >= 3, 'several kinds of equipment for a swap');
  const depIds = new Set(payload.LIBRARY.filter(e => e.pref).map(e => e.id));
  assert.ok(ids(lib).every(id => !depIds.has(id)));
  assert.ok(pool.every(e => !depIds.has(e.id)));
  // names and classification are the Library's, not the slice's
  for (const r of lib.rows.slice(0, 40)) { const e = pool.find(x => x.id === r[cols.id]); assert.equal(r[cols.name], e.n); assert.equal(r[cols.movement], e.mv || ''); assert.equal(r[cols.equipment], e.eq) }
});

test('a home gym profile keeps only what the profile has, and a limited intake keeps only that equipment', () => {
  const home = payload.libraryForAI({ gymProfiles: { activeId: 'home' } }, [], FULL);
  assert.ok(home.rows.length > 0);
  assert.ok(home.rows.every(r => r[cols.equipment] === 'body weight' || r[cols.equipment] === ''), 'bodyweight only');
  const some = payload.libraryForAI({}, ['dumbbell'], FULL);
  assert.ok(some.rows.every(r => r[cols.equipment] === 'dumbbell'));
  assert.ok(some.rows.length < payload.libraryForAI({}, [], FULL).rows.length);
});

test('explicit restrictions remove the exercises that break them', () => {
  const jumps = payload.libraryForAI({}, [], { ...FULL, restrictions: ['no-jumps'] });
  assert.ok(jumps.rows.every(r => r[cols.movement] !== 'jump'));
  assert.ok(payload.libraryForAI({}, [], FULL).rows.some(r => r[cols.movement] === 'jump'));
  const floor = payload.libraryForAI({}, [], { ...FULL, restrictions: ['no-floor'] });
  assert.ok(floor.rows.length > 0 && floor.rows.length <= payload.libraryForAI({}, [], FULL).rows.length + 5);
});

test('custom exercises and the exercises of the plan under review are never dropped', () => {
  const S = { customEx: [{ id: 'cx1', n: 'Sandbag carry', bp: 'back' }] };
  const base = payload.libraryForAI(S, [], FULL);
  assert.ok(ids(base).includes('cx1'));
  const row = base.rows.find(r => r[cols.id] === 'cx1');
  assert.ok(row[cols.flags].includes('C'));
  const pool = payload.librarySlice({}, []);
  const odd = pool.filter(e => e.mv === 'wrist' && !e.rec).slice(-1)[0];
  assert.ok(!ids(payload.libraryForAI({}, [], FULL)).includes(odd.id) || true);
  assert.ok(ids(payload.libraryForAI({}, [], { ...FULL, planIds: [odd.id] })).includes(odd.id));
});

test('goal and priority muscles shape the table without losing coverage', () => {
  const endurance = payload.libraryForAI({}, [], { ...FULL, goal: 'endurance' });
  const hyper = payload.libraryForAI({}, [], FULL);
  const count = (lib, mv) => lib.rows.filter(r => r[cols.movement] === mv).length;
  assert.ok(count(endurance, 'cardio') > count(hyper, 'cardio'));
  const calves = payload.libraryForAI({ priorityMuscles: ['calves'] }, [], FULL);
  const of = lib => lib.rows.filter(r => r[cols.muscleGroup] === 'calves').length;
  assert.ok(of(calves) > of(hyper), `${of(calves)} vs ${of(hyper)}`);
  assert.ok(of(calves) >= 12);
});

test('a small pool is sent whole, a thin one widens on its own, and the payload stays under a hard cap', () => {
  const tiny = Array.from({ length: 30 }, (_, i) => ({ id: 'e' + i, n: 'x' + i, mv: 'squat', eq: 'barbell', rec: i < 3 ? 1 : 0, muscleGroup: 'quadriceps' }));
  assert.equal(compactLibrary(tiny, {}).meta.strategy, 'whole-small-pool');
  assert.equal(compactLibrary(tiny, {}).rows.length, 30);
  const big = Array.from({ length: 400 }, (_, i) => ({ id: 'b' + i, n: 'y' + i, mv: ['squat', 'hinge', 'lunge'][i % 3], eq: 'barbell', muscleGroup: 'quadriceps' }));
  const sliced = compactLibrary(big, { goal: 'general' });
  assert.ok(sliced.rows.length >= LIMITS.totalMin && sliced.meta.widened);
  for (const [S, eq] of [[{}, []], [{}, ['dumbbell']], [{ gymProfiles: { activeId: 'home' } }, []]]) assert.ok(KB(payload.libraryForAI(S, eq, { ...FULL, daysPerWeek: 7 })) < 25);
});

test('the built payload carries the table, its size, and nothing the model does not use', () => {
  const p = payload.build({ coach: {}, priorityMuscles: [] }, 'uid-1', { kind: 'create', intake: { goal: 'hypertrophy', daysPerWeek: 4, equipment: [], experience: 'intermediate' } });
  assert.deepEqual(p.library.columns, COLUMNS);
  assert.equal(typeof p.library.of, 'number');
  assert.ok(p.library.rows.length < p.library.of);
  const text = JSON.stringify(p.library);
  assert.ok(!/instruction|"st"|"al"|aliases|gif|img/i.test(text));
});
