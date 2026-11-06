import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SECRET = 'a'.repeat(64);
// Each case starts a fresh Node process and imports the complete server dependency graph.
// Keep a bounded deadline, but allow loaded Windows/CI hosts more than the former 5 seconds.
const SERVER_STARTUP_TIMEOUT_MS = 15_000;
const cases = [
  ['db.json', '{"users":'],
  ['db.json', '{"users":[{"id":"u1","personId":42}]}'],
  ['social.json', '{"wall":{} }'],
  ['hidden-exercises.json', '{}'],
  ['unavailable-equipment.json', '{}'],
  ['friends.json', '{"requests":{}}'],
  ['bunker.json', '{"pins":{}}'],
  ['notifications.json', '{"items":{}}'],
  ['social-sharing.json', '{"shares":{}}'],
  ['gym-profile.json', '{"v":1,"availableEquipment":{}}'],
  ['features.json', '{"off":{}}'],
  ['vapid.json', '{"publicKey":"present-but-private-key-missing"}'],
];

for (const [filename, contents] of cases) {
  test(`server refuses ${filename} corruption without replacing it or creating an empty db`, t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'critical-store-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
    const file = path.join(dir, filename);
    const original = Buffer.from(contents);
    fs.writeFileSync(file, original);

    const result = spawnSync(process.execPath, ['server.js'], {
      cwd: API_DIR,
      env: { ...process.env, PORT: String(39000 + Math.floor(Math.random() * 10000)), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: 'http://localhost:8080' },
      encoding: 'utf8',
      timeout: SERVER_STARTUP_TIMEOUT_MS,
      windowsHide: true
    });

    assert.notEqual(result.error?.code, 'ETIMEDOUT', `server stayed up with corrupt ${filename}`);
    assert.equal(result.status, 1, `unexpected exit status for ${filename}: ${result.stderr}`);
    assert.match(result.stderr, new RegExp(filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.deepEqual(fs.readFileSync(file), original, `${filename} must remain byte-identical`);
    if (filename !== 'db.json') assert.equal(fs.existsSync(path.join(dir, 'db.json')), false, 'failed startup must not create an empty db.json');
  });
}
