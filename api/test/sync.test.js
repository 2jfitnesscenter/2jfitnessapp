import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData, sampleState } from './helpers.mjs';
tempData();
const { readState, writeState, stateFile } = await import('../lib/state-store.js');
const { openSync, mutate, trainerReceipt, saveTrainer } = await import('../lib/sync.js');
let sequence = 0;
const operation = (base, extra = {}) => ({ operationId: 'operation-' + (++sequence), revision: base.meta.revision, generation: base.meta.generation, type: 'save', state: structuredClone(base.state), ...extra });

test('old state migrates without changing domain data or encryption', () => {
  const before = sampleState();
  fs.writeFileSync(stateFile('migration'), JSON.stringify(before));
  const migrated = openSync('migration');
  assert.deepEqual(migrated.state, before);
  assert.equal(migrated.meta.schemaVersion, 2);
  assert.ok(!fs.readFileSync(stateFile('migration'), 'utf8').startsWith('{'));
});
test('two clients at N: first edit wins, stale second edit conflicts', () => {
  writeState('race', sampleState());
  const base = openSync('race');
  const a = operation(base); a.state.unit = 'lb';
  const b = operation(base); b.state.unit = 'kg';
  const result = mutate('race', a);
  assert.equal(result.meta.revision, base.meta.revision + 1);
  assert.throws(() => mutate('race', b), { code: 'SYNC_CONFLICT' });
  assert.equal(readState('race').unit, 'lb');
});
test('two queued concurrent requests on the same revision have exactly one winner', async () => {
  const base = openSync('concurrent');
  const results = await Promise.allSettled([operation(base), operation(base)].map(op => Promise.resolve().then(() => mutate('concurrent', op))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('lost response: stable operationId acknowledges without applying twice', () => {
  const base = openSync('retry');
  const op = operation(base);
  const first = mutate('retry', op), second = mutate('retry', op);
  assert.equal(second.meta.revision, first.meta.revision);
  assert.equal(second.acknowledged, op.operationId);
  assert.throws(() => mutate('retry', { ...op, state: { unit: 'lb' } }), { code: 'OPERATION_REUSED' });
});
for (const kind of ['workouts', 'routines', 'programs']) test(`${kind}: explicit deletion survives a stale and a freshly rebased resurrection`, () => {
  const uid = 'delete-' + kind;
  writeState(uid, { [kind]: [{ id: 'victim' }] });
  const base = openSync(uid);
  const gone = mutate(uid, operation(base, { type: 'delete', kind, id: 'victim' }));
  assert.ok(gone.meta.tombstones[kind].includes('victim'));
  assert.throws(() => mutate(uid, operation(base)), { code: 'SYNC_CONFLICT' });
  assert.throws(() => mutate(uid, operation(gone, { state: base.state })), { code: 'ENTITY_DELETED' });
});
test('trainer programming advances revision and stale member cannot revert versions or routine', () => {
  writeState('trainer', { routines: [{ id: 'r', name: 'old' }] });
  const member = openSync('trainer');
  const s = readState('trainer'); s.routines[0].name = 'trainer edit'; s.routineVersions = { r: [{ name: 'old' }] };
  writeState('trainer', s);
  assert.throws(() => mutate('trainer', operation(member)), { code: 'SYNC_CONFLICT' });
  assert.equal(readState('trainer').routines[0].name, 'trainer edit');
});
test('reset/replace advance generation; retries are idempotent and old generations cannot write', () => {
  const base = openSync('replace');
  const op = operation(base, { type: 'replace', state: { workouts: [{ id: 'backup' }] } });
  const imported = mutate('replace', op);
  assert.equal(imported.meta.generation, base.meta.generation + 1);
  assert.equal(mutate('replace', op).meta.revision, imported.meta.revision);
  assert.throws(() => mutate('replace', operation(base)), { code: 'SYNC_CONFLICT' });
  assert.deepEqual(mutate('replace', operation(imported, { type: 'reset', state: { workouts: [] } })).state.workouts, []);
});
test('save omissions are not deletes, explicit delete lists are; active and versions remain server-owned', () => {
  writeState('preserve', { workouts: [{ id: 'w' }], active: { id: 'active' }, routineVersions: { r: [1] } });
  const base = openSync('preserve');
  const saved = mutate('preserve', operation(base, { state: { workouts: [], active: null, routineVersions: {} } }));
  assert.deepEqual(saved.state.workouts, [{ id: 'w' }]);
  assert.equal(saved.state.active.id, 'active');
  assert.deepEqual(saved.state.routineVersions, { r: [1] });
  const deleted = mutate('preserve', operation(saved, { state: { workouts: [] }, deletes: { workouts: ['w'] } }));
  assert.deepEqual(deleted.state.workouts, []);
});
test('corrupt file never becomes an empty state even via sync activation', () => {
  fs.writeFileSync(stateFile('broken'), '{bad');
  assert.throws(() => openSync('broken'), { code: 'STATE_CORRUPT' });
  assert.equal(fs.readFileSync(stateFile('broken'), 'utf8'), '{bad');
});

test('trainer receipt handles a lost response before checking obsolete revision', () => {
  openSync('trainer-retry');
  const state = readState('trainer-retry');
  const body = { operationId: 'trainer-retry-1', sync: { revision: state._sync.revision, generation: state._sync.generation }, name: 'new' };
  assert.equal(trainerReceipt(state, body, 'routine'), null);
  state.routines = [{ id: 'r', name: 'new' }];
  saveTrainer('trainer-retry', state, body, 'routine', { routineId: 'r' });
  assert.equal(trainerReceipt(readState('trainer-retry'), body, 'routine').routineId, 'r');
  assert.throws(() => trainerReceipt(readState('trainer-retry'), { ...body, operationId: 'another-trainer' }, 'routine'), { code: 'SYNC_CONFLICT' });
});

test('metadata growth is linear: retries do not add receipts and tombstones stay unique', () => {
  let current = openSync('growth');
  for (let i = 0; i < 40; i++) {
    const op = operation(current, { state: { workouts: [{ id: 'w' + i }] } });
    current = mutate('growth', op);
    assert.equal(mutate('growth', op).meta.revision, current.meta.revision);
  }
  const del = operation(current, { type: 'delete', kind: 'workouts', id: 'w39' });
  current = mutate('growth', del);
  assert.equal(mutate('growth', del).meta.revision, current.meta.revision);
  assert.equal(Object.keys(current.meta.receipts).length, 41);
  assert.deepEqual(current.meta.tombstones.workouts, ['w39']);
});
