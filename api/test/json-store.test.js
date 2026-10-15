import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readJsonStore } from '../lib/json-store.js';

test('JSON store allows only a missing file to use the first-boot value', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'db.json');
  assert.deepEqual(readJsonStore(file, { initial: { users: [] } }), { users: [] });
  fs.writeFileSync(file, '{"users":[{"id":"u1"}]}');
  assert.deepEqual(readJsonStore(file, { initial: { users: [] }, validate: value => Array.isArray(value.users) }), { users: [{ id: 'u1' }] });
});

test('corrupt, structurally invalid, and unreadable existing stores fail without changing bytes', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'json-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'critical.json');
  const corrupt = Buffer.from('{"users":');
  fs.writeFileSync(file, corrupt);
  assert.throws(() => readJsonStore(file, { initial: { users: [] } }), /critical\.json: existing store contains invalid JSON/);
  assert.deepEqual(fs.readFileSync(file), corrupt);

  const invalid = Buffer.from('{"users":{}}');
  fs.writeFileSync(file, invalid);
  assert.throws(() => readJsonStore(file, { initial: { users: [] }, validate: value => Array.isArray(value.users) }), /critical\.json: existing store has an invalid structure/);
  assert.deepEqual(fs.readFileSync(file), invalid);

  const directory = path.join(dir, 'directory.json');
  fs.mkdirSync(directory);
  assert.throws(() => readJsonStore(directory, { initial: {} }), /directory\.json: existing store could not be read/);
});
