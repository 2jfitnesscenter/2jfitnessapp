import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData, sampleState } from './helpers.mjs';
tempData();
const { readState, writeState } = await import('../lib/state-store.js');
const { openSync, mutate, pruneReceipts, RECEIPT_KEEP } = await import('../lib/sync.js');

test('pruneReceipts keeps the newest entries by revision, whatever the key order or key shape', () => {
  const r = {};
  for (let i = 1; i <= 12; i++) r[i % 2 ? `op-${i}` : String(10000000 + i)] = { digest: 'd' + i, revision: i };   // numeric-looking keys reorder in JS objects
  r['direct:routine:x'] = { digest: 'dx', result: { sync: { revision: 13 } } };
  const kept = pruneReceipts(r, 5);
  assert.deepEqual(Object.values(kept).map(x => x.digest).sort(), ['d10', 'd11', 'd12', 'd9', 'dx']);
  assert.equal(pruneReceipts(r, 100), r, 'under the limit nothing is copied or changed');
});

test('a long-lived account keeps a bounded receipt table; recent retries are still acknowledged, none is applied twice', () => {
  writeState('longlived', sampleState());
  let base = openSync('longlived');
  const ids = [];
  for (let i = 0; i < RECEIPT_KEEP + 25; i++) {
    const op = { operationId: 'operation-' + String(i).padStart(5, '0'), revision: base.meta.revision, generation: base.meta.generation, type: 'save', state: { ...structuredClone(base.state), unit: i % 2 ? 'lb' : 'kg' } };
    ids.push(op.operationId);
    base = mutate('longlived', op);
  }
  const meta = readState('longlived')._sync;
  assert.equal(Object.keys(meta.receipts).length, RECEIPT_KEEP);
  assert.ok(!(ids[0] in meta.receipts) && ids.at(-1) in meta.receipts);
  // lost response on the most recent operation: acknowledged, revision unchanged
  const again = mutate('longlived', { operationId: ids.at(-1), revision: meta.revision - 1, generation: meta.generation, type: 'save', state: { ...structuredClone(base.state), unit: (RECEIPT_KEEP + 24) % 2 ? 'lb' : 'kg' } });
  assert.equal(again.meta.revision, meta.revision);
  // an ancient, already-applied operation (receipt pruned) is refused by the revision check, never re-applied
  assert.throws(() => mutate('longlived', { operationId: ids[0], revision: 1, generation: meta.generation, type: 'save', state: { unit: 'lb' } }), { code: 'SYNC_CONFLICT' });
  assert.equal(readState('longlived').unit, base.state.unit);
});
