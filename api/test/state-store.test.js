/* lib/state-store.js — the module responsible for encrypting a member's health data at rest.
   Read-after-write alone isn't enough coverage for this one: it would pass just as well with
   the encryption step silently missing. Every test here checks the actual bytes on disk. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tempData, sampleState } from './helpers.mjs';

const DIR = tempData();
const store = await import('../lib/state-store.js');

test('a written state round-trips through readState unchanged', () => {
  const S = sampleState();
  store.writeState('u1', S);
  assert.deepEqual(store.readState('u1'), S);
});

test('the file on disk is not plaintext JSON', () => {
  store.writeState('u2', sampleState());
  const raw = fs.readFileSync(path.join(DIR, 'state-u2.json'), 'utf8');
  assert.equal(raw.trim().startsWith('{'), false, 'should be an opaque blob, not a JSON object');
  assert.equal(raw.includes('Full body'), false, 'a routine name from the fixture must not appear in clear text');
});

test('a legacy plaintext file (written before encryption existed) still reads back correctly', () => {
  const S = sampleState({ note: 'pre-migration profile' });
  fs.writeFileSync(path.join(DIR, 'state-legacy.json'), JSON.stringify(S));
  assert.deepEqual(store.readState('legacy'), S);
  // and the next write upgrades it in place
  store.writeState('legacy', S);
  const raw = fs.readFileSync(path.join(DIR, 'state-legacy.json'), 'utf8');
  assert.equal(raw.trim().startsWith('{'), false);
  assert.deepEqual(store.readState('legacy'), S);
});

test('a tampered file fails closed (null), never garbage or a crash', () => {
  store.writeState('u3', sampleState());
  const file = path.join(DIR, 'state-u3.json');
  const blob = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, blob.slice(0, -4) + 'AAAA'); // flip the tail — corrupts either ciphertext or the auth tag
  assert.equal(store.readState('u3'), null);
});

test('a missing file reads as null, same as before this feature existed', () => {
  assert.equal(store.readState('does-not-exist'), null);
});
