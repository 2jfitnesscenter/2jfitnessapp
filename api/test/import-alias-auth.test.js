import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* v1.3.1 — X1 fix. The gym-wide CSV-import alias table (db.importExerciseAliases) is read by
 * every member's future import, so writing to it moves from "any signed-in user" to
 * trainer/admin only. A regular member's own import still resolves and saves correctly either
 * way — applyImportResolutions (frontend) already rewrites THEIR OWN entries before this
 * endpoint is ever called — this only stops the shared table itself from being changed by
 * someone without the role for it. Same real-spawned-server pattern as the other server.js
 * route tests. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'import-alias-auth-'));
const SECRET = 'e'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [
    { id: 'member1', name: 'Member One' },
    { id: 'trainer1', name: 'Trainer One', trainer: true },
  ],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
fs.writeFileSync(path.join(dir, 'bunker.json'), JSON.stringify({
  pins: [], adminCodes: [], roomKey: null,
  settings: { columns: 4, header: 'x', enableRestEndBeep: true, highlightFinishedRest: true, hideWeightsInPublicView: false, autoLockSec: 60 },
}, null, 2));

const PORT = 34571;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base },
  stdio: ['ignore', 'ignore', 'ignore'],
});
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server child process never became healthy');
}
await waitForServer();

function cookieFor(uid) {
  const exp = Date.now() + 86400000;
  const payload = `${uid}:${exp}:0`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}
async function req(method, p, { body, uid } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (uid) headers.cookie = cookieFor(uid);
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j };
}
const getAliases = uid => req('GET', '/api/exercises/import-aliases', { uid }).then(r => r.body.aliases);
const postAlias = (payload, uid) => req('POST', '/api/exercises/import-alias', { body: payload, uid });

test('a regular member cannot write a new gym-wide alias', async () => {
  const res = await postAlias({ key: 'hevy|press banca', exerciseId: '0025', source: 'Hevy', externalName: 'Press banca' }, 'member1');
  assert.equal(res.status, 403);
  const aliases = await getAliases('trainer1');
  assert.equal(aliases.length, 0, 'nothing was written');
});

test('a trainer/admin can write a new gym-wide alias', async () => {
  const res = await postAlias({ key: 'hevy|press banca', exerciseId: '0025', source: 'Hevy', externalName: 'Press banca' }, 'trainer1');
  assert.equal(res.status, 200);
  const aliases = await getAliases('member1');
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].exerciseId, '0025');
});

test('a trainer/admin can correct an alias a previous confirmation got wrong', async () => {
  await postAlias({ key: 'hevy|sentadilla', exerciseId: '0001', source: 'Hevy', externalName: 'Sentadilla' }, 'trainer1');
  const res = await postAlias({ key: 'hevy|sentadilla', exerciseId: '0002', source: 'Hevy', externalName: 'Sentadilla' }, 'trainer1');
  assert.equal(res.status, 200);
  const aliases = await getAliases('trainer1');
  assert.equal(aliases.find(a => a.key === 'hevy|sentadilla').exerciseId, '0002');
});

test('a member trying to overwrite an EXISTING alias is refused too, not just a fresh one', async () => {
  const res = await postAlias({ key: 'hevy|sentadilla', exerciseId: '9999', source: 'Hevy', externalName: 'Sentadilla' }, 'member1');
  assert.equal(res.status, 403);
  const aliases = await getAliases('trainer1');
  assert.equal(aliases.find(a => a.key === 'hevy|sentadilla').exerciseId, '0002', 'the trainer-confirmed value is untouched');
});

test('an unauthenticated request is rejected before touching anything', async () => {
  const res = await postAlias({ key: 'hevy|x', exerciseId: '0001', source: 'Hevy', externalName: 'X' });
  assert.equal(res.status, 401);
});

test('reading the alias table is still open to any signed-in member — import behaviour is not broken', async () => {
  const res = await req('GET', '/api/exercises/import-aliases', { uid: 'member1' });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body.aliases));
  assert.ok(res.body.aliases.some(a => a.key === 'hevy|press banca'), 'a member can still read (and thus benefit from) aliases trainers have confirmed');
});

test.after(() => { child.kill(); });
