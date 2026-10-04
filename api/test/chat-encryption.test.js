import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const api = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const setup = (secret = 'a'.repeat(64)) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2j-chat-'));
  fs.writeFileSync(path.join(dir, 'secret'), secret);
  process.env.DATA_DIR = dir; delete process.env.SECRET_FILE;
  return dir;
};
const open = async () => {
  (await import('../lib/crypto.js')).resetKeyCache();
  return import('../chat/store.js?x=' + Math.random());
};
const LEGACY = { threads: [{ id: 't1', memberId: 'u1', status: 'open', createdAt: 1, updatedAt: 1, readBy: {} }], messages: [{ id: 'm1', threadId: 't1', authorId: 'u1', authorRole: 'member', text: 'me duele la rodilla', createdAt: 1 }] };

test('legacy plain chat.json is converted once, atomically, and still reads the same', async () => {
  const dir = setup();
  fs.writeFileSync(path.join(dir, 'chat.json'), JSON.stringify(LEGACY, null, 2));
  const chat = await open();
  const disk = fs.readFileSync(path.join(dir, 'chat.json'), 'utf8');
  assert.ok(!disk.startsWith('{') && !disk.includes('rodilla') && !disk.includes('threads'), 'no plaintext on disk');
  assert.equal(chat.messagesOf('t1')[0].text, 'me duele la rodilla');
  assert.ok(!fs.existsSync(path.join(dir, 'chat.json.tmp')));
});

test('new messages are written encrypted and survive a restart (dual read of the encrypted format)', async () => {
  const dir = setup();
  const chat = await open();
  const { thread } = chat.createThread('u9', 'hola entrenador');
  chat.addMessage(thread.id, 'u9', 'member', 'segundo mensaje secreto');
  const disk = fs.readFileSync(path.join(dir, 'chat.json'), 'utf8');
  assert.ok(!disk.includes('secreto') && !disk.includes('hola'));
  const again = await open();
  assert.deepEqual(again.messagesOf(thread.id).map(m => m.text), ['hola entrenador', 'segundo mensaje secreto']);
});

test('wrong or missing key: chat stays empty and READ-ONLY, the file is never overwritten, the right key restores everything', async () => {
  const dir = setup('b'.repeat(64));
  const chat = await open();
  chat.createThread('u1', 'texto privado');
  const good = fs.readFileSync(path.join(dir, 'chat.json'), 'utf8');
  fs.writeFileSync(path.join(dir, 'secret'), 'c'.repeat(64));
  const wrong = await open();
  assert.equal(wrong.isLocked(), true);
  assert.deepEqual(wrong.allThreads(), []);
  wrong.createThread('u2', 'esto no debe pisar nada');
  assert.equal(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8'), good, 'file untouched');
  fs.writeFileSync(path.join(dir, 'secret'), 'b'.repeat(64));
  const fixed = await open();
  assert.equal(fixed.isLocked(), false);
  assert.equal(fixed.allThreads().length, 1);
});

test('rollback script restores the legacy plain format only with --write, keeping an encrypted copy', async () => {
  const dir = setup();
  const chat = await open();
  chat.createThread('u1', 'mensaje para rollback');
  const run = args => spawnSync(process.execPath, [path.join(api, 'scripts/decrypt-chat.mjs'), ...args], { env: { ...process.env, DATA_DIR: dir }, encoding: 'utf8' });
  const dry = run([]);
  assert.equal(dry.status, 0, dry.stderr); assert.match(dry.stdout, /1 threads, 1 messages/);
  assert.ok(!fs.readFileSync(path.join(dir, 'chat.json'), 'utf8').startsWith('{'), 'dry run changes nothing');
  assert.equal(run(['--write']).status, 0);
  const plain = JSON.parse(fs.readFileSync(path.join(dir, 'chat.json'), 'utf8'));
  assert.equal(plain.messages[0].text, 'mensaje para rollback');
  assert.ok(fs.existsSync(path.join(dir, 'chat.json.enc-bak')));
  const back = await open();   // and the new release reads the plain file again (dual read) and re-encrypts it
  assert.equal(back.allThreads().length, 1);
});

/* ---- metadata preservation (Sprint 3 deploy finding: the runner compares owner:group:mode of every mutable data file before/after) ---- */
// File modes/ownership are only meaningful on POSIX. These tests still run everywhere (no skips): on Windows they check that metadata is unchanged, and the
// exact 0600 / uid / gid assertions are enforced on POSIX and by scripts/verify-chat-migration-docker.sh.
const IS_POSIX = process.platform !== 'win32'
const meta = f => { const s = fs.statSync(f); return { mode: s.mode & 0o7777, uid: s.uid, gid: s.gid }; };

test('plaintext -> AES keeps the original mode, uid and gid (not the temp file’s)', async () => {
  const dir = setup();
  const file = path.join(dir, 'chat.json');
  fs.writeFileSync(file, JSON.stringify(LEGACY, null, 2)); fs.chmodSync(file, 0o640);
  const before = meta(file);
  const chat = await open();
  assert.deepEqual(meta(file), before);
  assert.ok(!fs.readFileSync(file, 'utf8').startsWith('{'), 'converted');
  chat.addMessage('t1', 'u1', 'member', 'segundo');                       // later writes keep it too
  assert.deepEqual(meta(file), before);
});

test('a brand-new chat.json is created 0600', async () => {
  const dir = setup();
  const chat = await open();
  chat.createThread('u1', 'primer mensaje');
  if (IS_POSIX) assert.equal(meta(path.join(dir, 'chat.json')).mode, 0o600);
  else assert.ok(fs.existsSync(path.join(dir, 'chat.json')));
});

test('if ownership/mode cannot be preserved the replacement is aborted: original untouched, no rename, no temp left', async () => {
  const dir = setup();
  const file = path.join(dir, 'chat.json');
  const { atomicWrite } = await open();                          // (opening first: boot would otherwise convert the file itself)
  const original = JSON.stringify(LEGACY, null, 2);
  fs.writeFileSync(file, original);
  const calls = [];
  const io = new Proxy(fs, { get: (t, k) => k === 'chownSync' ? () => { throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' }); } : k === 'renameSync' ? (...a) => { calls.push('rename'); return t.renameSync(...a); } : t[k] });
  assert.throws(() => atomicWrite(file, 'NEW-CONTENT', io), /EPERM/);
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'original byte-for-byte');
  assert.deepEqual(calls, [], 'never renamed');
  assert.ok(!fs.existsSync(file + '.tmp'), 'temp removed');
});

test('a metadata mismatch after writing the temp file also aborts', async () => {
  const dir = setup();
  const file = path.join(dir, 'chat.json');
  fs.writeFileSync(file, 'ORIGINAL');
  const { atomicWrite } = await open();
  const real = fs.statSync(file);
  let statCalls = 0;
  const io = new Proxy(fs, { get: (t, k) => k === 'statSync' ? (p) => { const s = t.statSync(p); if (++statCalls === 2) return { mode: s.mode ^ 0o077, uid: s.uid, gid: s.gid }; return s; } : t[k] });
  assert.throws(() => atomicWrite(file, 'NEW', io), /metadata could not be preserved/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'ORIGINAL'); assert.ok(real); assert.ok(!fs.existsSync(file + '.tmp'));
});

test('a migration that cannot write leaves the plaintext original intact and fully usable; the next boot completes it (idempotent afterwards)', async () => {
  const dir = setup();
  const file = path.join(dir, 'chat.json');
  const original = JSON.stringify(LEGACY, null, 2);
  fs.writeFileSync(file, original);
  fs.mkdirSync(file + '.tmp');                                   // a real, cross-platform obstacle for the temp file
  const stuck = await open();
  assert.equal(fs.readFileSync(file, 'utf8'), original, 'postponed, not lost');
  assert.equal(stuck.messagesOf('t1')[0].text, 'me duele la rodilla', 'still readable meanwhile');
  fs.rmdirSync(file + '.tmp');
  const done = await open();
  assert.ok(!fs.readFileSync(file, 'utf8').startsWith('{'));
  assert.equal(done.messagesOf('t1').length, 1);
  const afterFirst = fs.readFileSync(file, 'utf8');
  const again = await open();                                    // already encrypted: a boot must not rewrite it
  assert.equal(fs.readFileSync(file, 'utf8'), afterFirst);
  assert.equal(again.messagesOf('t1').length, 1);
});
