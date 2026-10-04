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
  assert.ok(!disk.startsWith('{') && !disk.includes('rodilla') && !disk.includes('m1'), 'no plaintext on disk');
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
