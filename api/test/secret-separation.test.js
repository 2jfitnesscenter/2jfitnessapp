import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tmp = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const fresh = async (data, secretFile) => {
  process.env.DATA_DIR = data;
  if (secretFile) process.env.SECRET_FILE = secretFile; else delete process.env.SECRET_FILE;
  const mod = await import('../lib/secret.js?x=' + Math.random());
  const crypto = await import('../lib/crypto.js');
  crypto.resetKeyCache();
  return { mod, crypto };
};

test('default: the secret is ./data/secret and encryption round-trips with it', async () => {
  const data = tmp('2j-sec-a-'); fs.writeFileSync(path.join(data, 'secret'), 'legacy-secret-value');
  const { mod, crypto } = await fresh(data);
  assert.equal(mod.secretIsSeparated(), false);
  assert.equal(mod.ensureSecret(), 'legacy-secret-value');
  assert.deepEqual(crypto.decrypt(crypto.encrypt({ a: 1 }, 'x'), 'x'), { a: 1 });
});

test('SECRET_FILE outside ./data: legacy value is copied (not moved) so existing ciphertext still decrypts', async () => {
  const data = tmp('2j-sec-b-'), out = path.join(tmp('2j-sec-b2-'), 'secrets', 'secret');
  fs.writeFileSync(path.join(data, 'secret'), 'legacy-secret-value');
  const before = await fresh(data);
  const blob = before.crypto.encrypt({ chat: 'hola' }, 'chat-store');
  const { mod, crypto } = await fresh(data, out);
  assert.equal(mod.secretIsSeparated(), true);
  assert.equal(crypto.decrypt(blob, 'chat-store')?.chat, 'hola', 'same key, same files');
  assert.equal(fs.readFileSync(out, 'utf8'), 'legacy-secret-value');
  assert.ok(fs.existsSync(path.join(data, 'secret')), 'legacy file untouched');
});

test('fresh install with SECRET_FILE generates the key outside ./data and writes nothing to it', async () => {
  const data = tmp('2j-sec-c-'), out = path.join(tmp('2j-sec-c2-'), 's', 'secret');
  const { mod } = await fresh(data, out);
  const s = mod.ensureSecret();
  assert.match(s, /^[0-9a-f]{64}$/);
  assert.equal(fs.readFileSync(out, 'utf8'), s);
  assert.deepEqual(fs.readdirSync(data), [], 'data folder has no key');
});

const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
test('separate-secret.sh copies without deleting, verifies, and refuses removal without the offline-copy ack', { skip: !hasBash }, () => {
  const root = tmp('2j-sec-d-'); fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'data'));
  fs.copyFileSync(path.join(repo, 'scripts/separate-secret.sh'), path.join(root, 'scripts/separate-secret.sh'));
  fs.writeFileSync(path.join(root, 'data/secret'), 'abc123');
  const run = (args = [], env = {}) => spawnSync('bash', ['scripts/separate-secret.sh', ...args], { cwd: root, env: { ...process.env, DATA_DIR: 'data', SECRETS_DIR: 'secrets', ...env }, encoding: 'utf8' });
  assert.equal(run().status, 0);
  assert.equal(fs.readFileSync(path.join(root, 'secrets/secret'), 'utf8'), 'abc123');
  assert.ok(fs.existsSync(path.join(root, 'data/secret')));
  assert.equal(run(['--remove-legacy']).status, 4, 'no ack, no removal');
  assert.ok(fs.existsSync(path.join(root, 'data/secret')));
  assert.equal(run(['--remove-legacy'], { I_SAVED_AN_OFFLINE_COPY: 'yes' }).status, 0);
  assert.ok(!fs.existsSync(path.join(root, 'data/secret')) && fs.existsSync(path.join(root, 'secrets/secret')));
  fs.writeFileSync(path.join(root, 'secrets/secret'), 'different'); fs.writeFileSync(path.join(root, 'data/secret'), 'abc123');
  assert.equal(run().status, 3, 'diverging copies are refused');
});
