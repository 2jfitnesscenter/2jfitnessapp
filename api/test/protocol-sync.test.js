import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { validateAgainst2JProtocol, PROTOCOL_VERSION } from '../lib/protocol/index.js';

// The server validates with a generated copy of frontend/src/lib/protocol — never a fork.
test('api/lib/protocol is byte-identical to the frontend protocol', () => {
  execFileSync(process.execPath, ['../scripts/sync-protocol.mjs', '--check'], { stdio: 'pipe' });
});
test('the server copy validates with the library index it has', () => {
  assert.equal(PROTOCOL_VERSION, '1.0');
  const v = validateAgainst2JProtocol({ kind: 'block', goal: 'power', level: 'advanced', entries: [{ id: '0514', sets: 3, mode: 'reps', reps: 5, rpe: [10, 10, 10] }] }, { lookup: () => null });
  assert.equal(v.result, 'FAIL');
});
test('the official block library is reproducible from its matrix and passes the protocol', () => {
  // Rebuilds from scripts/protocol/official-blocks.matrix.mjs, re-validates every block, re-runs
  // the duplicate/diversity checks, and compares byte for byte with the committed JSON.
  execFileSync(process.execPath, ['../scripts/build-official-blocks.mjs', '--check'], { stdio: 'pipe' });
});
