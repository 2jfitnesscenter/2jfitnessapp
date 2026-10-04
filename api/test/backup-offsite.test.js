import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const posix = p => p.split(path.sep).join('/');
const hasBash = spawnSync('bash', ['-c', 'command -v openssl tar gzip sha256sum >/dev/null']).status === 0;
const opts = { skip: hasBash ? false : 'bash/openssl not available' };

// A throw-away "repo": scripts/ copied in, a data/ folder with a secret and an encrypted-looking state file.
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), '2j-backup-'));
  fs.mkdirSync(path.join(root, 'scripts')); fs.mkdirSync(path.join(root, 'data'));
  for (const f of ['backup-data.sh', 'backup-offsite.sh', 'restore-backup.sh', 'disk-check.sh']) fs.copyFileSync(path.join(repo, 'scripts', f), path.join(root, 'scripts', f));
  fs.writeFileSync(path.join(root, 'data', 'secret'), 'TOP-SECRET-KEY-MATERIAL');
  fs.writeFileSync(path.join(root, 'data', 'state-u1.json'), 'ENCRYPTED-STATE-BLOB');
  fs.writeFileSync(path.join(root, 'data', 'db.json'), '{"users":[{"id":"u1"}]}');
  const pass = path.join(root, 'pass.txt'); fs.writeFileSync(pass, 'correct horse battery staple\n', { mode: 0o600 });
  const out = path.join(root, 'out'), remote = path.join(root, 'remote');
  const env = { ...process.env, BACKUP_PASSPHRASE_FILE: posix(pass), BACKUP_REMOTE: posix(remote), BACKUP_DIR: 'out', BACKUP_MIN_FREE_MB: '1', BACKUP_SKIP_MODE_CHECK: '1' };
  const run = (script, args = [], extra = {}) => spawnSync('bash', [posix(path.join(root, 'scripts', script)), ...args], { cwd: root, env: { ...env, ...extra }, encoding: 'utf8' });
  return { root, pass, out, remote, run };
}

test('off-site backup: encrypted, verified, uploaded; plaintext never leaves; restore rehearsal works', opts, () => {
  const f = fixture();
  const r = f.run('backup-offsite.sh');
  assert.equal(r.status, 0, r.stderr + r.stdout);
  const files = fs.readdirSync(f.remote);
  const enc = files.find(x => x.endsWith('.tar.gz.enc'));
  assert.ok(enc && files.includes(enc + '.sha256'), 'encrypted file and checksum uploaded');
  assert.ok(!files.some(x => x.endsWith('.tar.gz')), 'no plaintext tarball off-site');
  const blob = fs.readFileSync(path.join(f.remote, enc));
  assert.ok(!blob.includes('TOP-SECRET-KEY-MATERIAL') && !blob.includes('ENCRYPTED-STATE-BLOB'), 'ciphertext does not contain the data');
  assert.equal(blob.subarray(0, 8).toString(), 'Salted__');
  const status = JSON.parse(fs.readFileSync(path.join(f.out, 'last-offsite.json'), 'utf8'));
  assert.equal(status.file, enc);

  const verify = f.run('restore-backup.sh', ['--verify-only', posix(path.join(f.remote, enc))]);
  assert.equal(verify.status, 0, verify.stderr);
  const dest = path.join(f.root, 'restored');
  const rest = f.run('restore-backup.sh', [posix(path.join(f.remote, enc)), posix(dest)]);
  assert.equal(rest.status, 0, rest.stderr);
  assert.equal(fs.readFileSync(path.join(dest, 'data', 'secret'), 'utf8'), 'TOP-SECRET-KEY-MATERIAL');
  assert.equal(fs.readFileSync(path.join(dest, 'data', 'state-u1.json'), 'utf8'), 'ENCRYPTED-STATE-BLOB');
  assert.equal(f.run('restore-backup.sh', [posix(path.join(f.remote, enc)), posix(dest)]).status, 7, 'refuses a non-empty destination');
  assert.equal(fs.readFileSync(path.join(f.root, 'data', 'secret'), 'utf8'), 'TOP-SECRET-KEY-MATERIAL', 'live data untouched');
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('restore detects a wrong passphrase and a corrupted copy', opts, () => {
  const f = fixture();
  assert.equal(f.run('backup-offsite.sh').status, 0);
  const enc = path.join(f.remote, fs.readdirSync(f.remote).find(x => x.endsWith('.tar.gz.enc')));
  const other = path.join(f.root, 'other.txt'); fs.writeFileSync(other, 'wrong passphrase\n');
  assert.equal(f.run('restore-backup.sh', ['--verify-only', posix(enc)], { BACKUP_PASSPHRASE_FILE: posix(other) }).status, 5);
  const bytes = fs.readFileSync(enc); bytes[bytes.length - 5] ^= 0xff; fs.writeFileSync(enc, bytes);
  assert.equal(f.run('restore-backup.sh', ['--verify-only', posix(enc)]).status, 4, 'checksum mismatch');
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('refuses to run with a passphrase inside ./data, with no passphrase, or without enough disk', opts, () => {
  const f = fixture();
  const inside = path.join(f.root, 'data', 'pass.txt'); fs.writeFileSync(inside, 'x\n');
  assert.equal(f.run('backup-offsite.sh', [], { BACKUP_PASSPHRASE_FILE: posix(inside) }).status, 2);
  assert.equal(f.run('backup-offsite.sh', [], { BACKUP_PASSPHRASE_FILE: posix(path.join(f.root, 'missing.txt')) }).status, 2);
  assert.equal(f.run('backup-offsite.sh', [], { BACKUP_MIN_FREE_MB: '999999999' }).status, 3);
  assert.equal(fs.existsSync(f.remote), false, 'nothing uploaded when a precondition fails');
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('disk-check passes with a sane threshold and fails when the demand is impossible', opts, () => {
  const f = fixture();
  assert.equal(f.run('disk-check.sh', [posix(f.root), '0']).status, 0);
  assert.equal(f.run('disk-check.sh', [posix(f.root), '101']).status, 1);
  fs.rmSync(f.root, { recursive: true, force: true });
});
