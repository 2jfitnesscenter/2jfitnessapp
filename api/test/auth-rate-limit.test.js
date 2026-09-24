import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Public passkey/registration/recovery routes are limited per client IP (bunker/rate-limit.js's
 * authLimiters, the same AttemptLimiter the Bunker PIN uses). Real server.js child process: the
 * route table and its gates are not exported. The test connects from localhost (a private peer),
 * so the X-Forwarded-For hop is trusted exactly as it is behind Caddy+nginx in production, which
 * lets each case use its own simulated client address. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-rate-limit-'));
fs.writeFileSync(path.join(dir, 'secret'), 'f'.repeat(64), { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'u1', name: 'Member One' }], creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));

const PORT = 34572;
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

const post = (p, body, ip) => fetch(base + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
  body: JSON.stringify(body),
});

test('login/options: 30 challenges per minute per IP, then 429 with Retry-After', async () => {
  const ip = '203.0.113.10';
  for (let i = 0; i < 30; i++) assert.equal((await post('/api/login/options', {}, ip)).status, 200, `request ${i + 1}`);
  const blocked = await post('/api/login/options', {}, ip);
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.headers.get('retry-after')) >= 1);
});

test('the block is per IP: another client of the gym is unaffected', async () => {
  const res = await post('/api/login/options', {}, '203.0.113.11');
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.ok(body.cid && body.options?.challenge, 'normal passkey options still issued');
});

test('register/options shares the challenge budget and still works normally', async () => {
  const res = await post('/api/register/options', { name: 'Nuevo Socio' }, '203.0.113.12');
  assert.equal(res.status, 200);
  assert.ok((await res.json()).options?.challenge);
});

test('login/verify counts failed verifications only, blocking after 20', async () => {
  const ip = '203.0.113.20';
  for (let i = 0; i < 20; i++) assert.equal((await post('/api/login/verify', { cid: 'nope' }, ip)).status, 400);
  assert.equal((await post('/api/login/verify', { cid: 'nope' }, ip)).status, 429);
});

test('recover/request (writes db + pushes admins) is capped at 5 per 10 minutes per IP', async () => {
  const ip = '203.0.113.30';
  for (let i = 0; i < 5; i++) assert.equal((await post('/api/recover/request', { name: 'Alguien' }, ip)).status, 200);
  assert.equal((await post('/api/recover/request', { name: 'Alguien' }, ip)).status, 429);
});

test('recover/options token guessing is throttled like any other challenge route', async () => {
  const ip = '203.0.113.40';
  for (let i = 0; i < 30; i++) assert.equal((await post('/api/recover/options', { token: 'BAD' + i }, ip)).status, 400);
  assert.equal((await post('/api/recover/options', { token: 'BAD' }, ip)).status, 429);
});

test.after(() => { child.kill(); });
