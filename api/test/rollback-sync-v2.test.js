import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { readState, writeState } = await import('../lib/state-store.js');
const { openSync, mutate } = await import('../lib/sync.js');

test('the post-Sync rollback baseline preserves metadata and refuses stale resurrection', () => {
  writeState('rollback', { workouts: [{ id: 'keep' }, { id: 'deleted' }], routines: [], programs: [] });
  const initial = openSync('rollback');
  const deleted = mutate('rollback', {
    operationId: 'rollback-delete-operation',
    type: 'delete', kind: 'workouts', id: 'deleted',
    revision: initial.meta.revision, generation: initial.meta.generation,
  });
  const replaced = mutate('rollback', {
    operationId: 'rollback-generation-operation',
    type: 'replace', state: { workouts: [{ id: 'keep' }], routines: [], programs: [] },
    revision: deleted.meta.revision, generation: deleted.meta.generation,
  });
  const tombstoned = mutate('rollback', {
    operationId: 'rollback-delete-after-generation',
    type: 'delete', kind: 'workouts', id: 'keep',
    revision: replaced.meta.revision, generation: replaced.meta.generation,
  });

  // A rollback to the declared baseline still uses the same central writer. A narrow server
  // mutation may advance revision, but it cannot replace or lower any existing Sync V2 metadata.
  const baselineState = readState('rollback');
  baselineState.unit = 'lb';
  writeState('rollback', baselineState);
  const afterRollbackWrite = readState('rollback');
  assert.equal(afterRollbackWrite._sync.generation, tombstoned.meta.generation);
  assert.ok(afterRollbackWrite._sync.revision > tombstoned.meta.revision);
  assert.deepEqual(afterRollbackWrite._sync.tombstones.workouts, ['keep']);
  assert.deepEqual(Object.keys(afterRollbackWrite._sync.receipts).sort(), Object.keys(tombstoned.meta.receipts).sort());

  assert.throws(() => mutate('rollback', {
    operationId: 'rollback-stale-client', type: 'save',
    revision: initial.meta.revision, generation: initial.meta.generation,
    state: initial.state,
  }), { code: 'SYNC_CONFLICT' });

  const fresh = openSync('rollback');
  assert.throws(() => mutate('rollback', {
    operationId: 'rollback-resurrection', type: 'save',
    revision: fresh.meta.revision, generation: fresh.meta.generation,
    state: { ...fresh.state, workouts: [{ id: 'keep' }] },
  }), { code: 'ENTITY_DELETED' });
  assert.deepEqual(readState('rollback').workouts, []);
});
