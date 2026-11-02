import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

// Session level `home`: a request carrying only the Home cookie (2j_member) becomes a member-level session, never staff.
const DIR = tempData();
const API_ROOT = path.resolve('.');
const COOKIE = 'H'.repeat(43);
const PERSON = '22222222-2222-4222-8222-222222222222';
const users = { plain: 'uid-plain', env: 'uid-envadmin', db: 'uid-dbadmin', none: 'uid-none' };
fs.writeFileSync(path.join(DIR, 'db.json'), JSON.stringify({
  users: [
    { id: users.plain, name: 'Plain', username: 'plain' },
    { id: users.env, name: 'Env admin', username: 'envadmin' },
    { id: users.db, name: 'Db admin', username: 'dbadmin', admin: true, trainer: true },
  ], creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));

// Fake Platform: answers the member-session verify call by cookie value.
const verdicts = new Map();      // cookie -> { status, body }
const platform = http.createServer((req, res) => {
  const chunks = []; req.on('data', c => chunks.push(c));
  req.on('end', () => {
    const { cookie } = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    const verdict = req.url === '/api/internal/platform/v2/member-session/verify' && verdicts.get(cookie);
    if (!verdict) { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"session_invalid"}'); }
    res.writeHead(verdict.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(verdict.body));
  });
});
await new Promise(resolve => platform.listen(0, '127.0.0.1', resolve));
const live = trainingUserId => ({ status: 200, body: { personId: PERSON, trainingUserId, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } });
const cookieFor = (name, uid) => { const value = (name + '-').padEnd(43, 'x'); verdicts.set(value, live(uid)); return value; };

async function freePort() {
  return new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });
}
async function startTraining(extraEnv = {}) {
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_ROOT,
    env: { ...process.env, PORT: String(port), DATA_DIR: DIR, SECRET_FILE: path.join(DIR, 'secret'), RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: users.env,
      PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.address().port}`, PLATFORM_API_KEY_ID: 'bunker-1', PLATFORM_API_KEY_SECRET: crypto.randomBytes(32).toString('base64url'), ...extraEnv },
    stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true,
  });
  for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  return { base, stop: () => child.kill() };
}
const server = await startTraining();
const plain = await startTraining({ PLATFORM_API_BASE_URL: '', PLATFORM_API_KEY_ID: '', PLATFORM_API_KEY_SECRET: '' });   // no Platform configured
after(() => { server.stop(); plain.stop(); platform.close(); });

const get = async (srv, route, cookie) => {
  const response = await fetch(srv.base + route, { headers: cookie ? { cookie } : {} });
  const text = await response.text(); let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: response.status, json };
};

test('only 2j_member: the session level is home, admin false, trainer false', async () => {
  const c = cookieFor('plain', users.plain);
  const me = await get(server, '/api/me', `2j_member=${c}`);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.id, users.plain);
  assert.equal(me.json.user.authLevel, 'home');
  assert.equal(me.json.user.admin, false);
  assert.equal(me.json.user.trainer, false);
});

test('an ADMIN_UIDS member arriving with a home session still has admin false and no staff routes', async () => {
  const c = cookieFor('env', users.env);
  const me = await get(server, '/api/me', `2j_member=${c}`);
  assert.equal(me.status, 200);
  assert.equal(me.json.user.authLevel, 'home');
  assert.equal(me.json.user.admin, false);
  assert.equal(me.json.user.trainer, false);
  assert.equal((await get(server, '/api/admin/users', `2j_member=${c}`)).status, 403);
});

test('a db admin/trainer flagged account is also member-level under a home session', async () => {
  const c = cookieFor('db', users.db);
  const me = await get(server, '/api/me', `2j_member=${c}`);
  assert.equal(me.json.user.admin, false);
  assert.equal(me.json.user.trainer, false);
  assert.equal((await get(server, '/api/admin/users', `2j_member=${c}`)).status, 403);
});

test('a home session cannot reach identity/passkey management', async () => {
  const c = cookieFor('plain', users.plain);
  const r = await get(server, '/api/me/passkeys', `2j_member=${c}`);
  assert.equal(r.status, 403);
});

test('person without an active Training link, unknown user, or invalid cookie: anonymous (401)', async () => {
  assert.equal((await get(server, '/api/me', `2j_member=${cookieFor('none', null)}`)).status, 401);
  assert.equal((await get(server, '/api/me', `2j_member=${cookieFor('ghost', 'uid-ghost')}`)).status, 401);
  assert.equal((await get(server, '/api/me', `2j_member=${'Z'.repeat(43)}`)).status, 401);
});

test('no cookies at all, or Platform not configured: exactly as before (anonymous)', async () => {
  assert.equal((await get(server, '/api/me')).status, 401);
  assert.equal((await get(plain, '/api/me', `2j_member=${cookieFor('plain', users.plain)}`)).status, 401);
});

test('a present but invalid gymsid is never rescued by 2j_member', async () => {
  const c = cookieFor('plain', users.plain);
  assert.equal((await get(server, '/api/me', `gymsid=bogus.sig; 2j_member=${c}`)).status, 401);
});

test('a present but empty gymsid is not rescued by 2j_member either', async () => {
  const c = cookieFor('plain', users.plain);
  assert.equal((await get(server, '/api/me', `gymsid=; 2j_member=${c}`)).status, 401);
});

test('isAdminUser is false for a home session even for ADMIN_UIDS or flagged accounts', async () => {
  const { isAdminUser } = await import('../lib/session-level.js');
  assert.equal(isAdminUser({ id: 'a', authLevel: 'home', admin: false }, ['a']), false);
  assert.equal(isAdminUser({ id: 'a', authLevel: 'home', admin: true }, []), false);
  assert.equal(isAdminUser({ id: 'a', authLevel: 'passkey' }, ['a']), true);
  assert.equal(isAdminUser({ id: 'b', authLevel: 'passkey', admin: true }, []), true);
  assert.equal(isAdminUser(null, ['a']), false);
});

test('refusesStrongAuth refuses home and sso, and pin without recent strong confirmation', async () => {
  const { refusesStrongAuth } = await import('../lib/session-level.js');
  assert.equal(refusesStrongAuth({ authLevel: 'home' }), true);
  assert.equal(refusesStrongAuth({ authLevel: 'sso' }), true);
  assert.equal(refusesStrongAuth({ authLevel: 'pin', strongUntil: 0 }), true);
  assert.equal(refusesStrongAuth({ authLevel: 'pin', strongUntil: Date.now() + 60_000 }), false);
  assert.equal(refusesStrongAuth({ authLevel: 'passkey' }), false);
});
