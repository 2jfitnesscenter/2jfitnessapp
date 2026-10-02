// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Admin "App features" over HTTP on a real spawned server: defaults (everything on, nothing written),
 * authenticated read, admin-only write (members and trainers refused), validation, persistence in
 * features.json (never in a member's state) and that an older/absent/corrupt file keeps today's behaviour. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'features-'));
const SECRET = 'c'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'm1', name: 'Member' }, { id: 't1', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Admin', admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const PORT = 34620, base = `http://localhost:${PORT}`;
let child;
const boot = async () => {
  child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* booting */ } await new Promise(r => setTimeout(r, 100)); }
};
const stop = () => new Promise(r => { child.once('exit', r); child.kill(); });
await boot();
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
}
test.after(() => { child.kill(); });
const file = path.join(dir, 'features.json');
const { FEATURE_KEYS } = await import('../lib/features-store.js');

test('without a config file every feature is on and nothing is written; reading needs a session', async () => {
  assert.equal((await req('GET', '/api/features')).status, 401);
  const r = await req('GET', '/api/features', 'm1');
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body.features).sort(), [...FEATURE_KEYS].sort());
  assert.ok(Object.values(r.body.features).every(v => v === true));
  assert.equal(fs.existsSync(file), false);
});

test('only an admin writes: anonymous 401, member and trainer 403, and nothing changes', async () => {
  const body = { features: { coach: false } };
  assert.equal((await req('POST', '/api/admin/features', null, body)).status, 401);
  assert.equal((await req('POST', '/api/admin/features', 'm1', body)).status, 403);
  assert.equal((await req('POST', '/api/admin/features', 't1', body)).status, 403);
  assert.equal((await req('GET', '/api/features', 'm1')).body.features.coach, true);
  assert.equal(fs.existsSync(file), false);
});

test('the admin switches a feature off for everyone and back on', async () => {
  const off = await req('POST', '/api/admin/features', 'ad', { features: { coach: false, social: false } });
  assert.equal(off.status, 200);
  assert.equal(off.body.features.coach, false); assert.equal(off.body.features.health, true);
  for (const uid of ['m1', 't1', 'ad']) {
    const r = (await req('GET', '/api/features', uid)).body.features;
    assert.equal(r.coach, false, uid); assert.equal(r.social, false, uid); assert.equal(r.effort, true, uid);
  }
  assert.equal((await req('POST', '/api/admin/features', 'ad', { features: { social: true } })).body.features.social, true);
  assert.equal((await req('GET', '/api/features', 'm1')).body.features.social, true);
  assert.equal((await req('GET', '/api/features', 'm1')).body.features.coach, false, 'the other switch is untouched');
});

test('validation: unknown keys, non-booleans and empty bodies are refused without changing anything', async () => {
  const before = (await req('GET', '/api/features', 'ad')).body.features;
  for (const body of [{ features: { nope: false } }, { features: { coach: 'no' } }, { features: { coach: 0 } }, { features: {} }, { features: [] }, {}, { features: { coach: false, nope: false } }, null]) {
    assert.equal((await req('POST', '/api/admin/features', 'ad', body)).status, 400, JSON.stringify(body));
  }
  assert.deepEqual((await req('GET', '/api/features', 'ad')).body.features, before);
});

test('state lives in features.json only, and survives a restart', async () => {
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')).off, ['coach']);
  assert.ok(!fs.readdirSync(dir).some(f => /^state-/.test(f)), 'no member state touched (Sync V2 is separate)');
  await stop(); await boot();
  assert.equal((await req('GET', '/api/features', 'm1')).body.features.coach, false);
});

test('an older, unknown-key or corrupt file never turns anything off by accident', async () => {
  await stop();
  fs.writeFileSync(file, JSON.stringify({ v: 0, off: ['gone-feature', 'effort'] }));
  await boot();
  const f = (await req('GET', '/api/features', 'm1')).body.features;
  assert.equal(f.effort, false); assert.equal(f.coach, true); assert.ok(!('gone-feature' in f));
  await stop();
  fs.writeFileSync(file, '{ not json');
  await boot();
  assert.ok(Object.values((await req('GET', '/api/features', 'm1')).body.features).every(v => v === true), 'corrupt file = today’s behaviour');
});
