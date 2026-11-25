// F9l block C · Rolling back PLATFORM_ENFORCEMENT_ENABLED really frees the members already `shadow`/`enforced` (they behave as legacy), their own
// mode is kept in the database, and switching it on again restores it without losing anything written meanwhile.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

const DIR = tempData();
const SECRET = 'a'.repeat(64), API_ROOT = path.resolve('.'), dbFile = path.join(DIR, 'db.json');
const { baselineCapabilities } = await import('../platform-sso/capabilities.js');
const { signHubRequest } = await import('../platform-hub/service-auth.js');
const outbound = { keyId: 'bunker-out-1', secret: Buffer.alloc(32, 0x21) };
const P = { enf: randomUUID(), susp: randomUUID(), shadow: randomUUID() };
const kinds = { [P.enf]: ['u-enf', 'baseline'], [P.susp]: ['u-susp', 'suspended'], [P.shadow]: ['u-shadow', 'baseline'] };
let calls = 0;
const platform = http.createServer((req, res) => {
  const { signature } = signHubRequest({ keyId: outbound.keyId, secret: outbound.secret, timestamp: req.headers['x-2j-timestamp'] || '', requestId: req.headers['x-2j-request-id'] || '', method: req.method, target: req.url, body: Buffer.alloc(0) });
  const id = /persons\/([0-9a-f-]{36})\/training-capabilities$/.exec(req.url)?.[1];
  const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(body)); };
  if (req.headers['x-2j-signature'] !== signature) return send(401, { error: 'SERVICE_AUTH_INVALID' });
  if (!kinds[id]) return send(404, { error: 'not_found' });
  calls++;
  const [trainingUserId, kind] = kinds[id], base = baselineCapabilities(), none = Object.fromEntries(Object.keys(base).map(n => [n, false])), susp = kind === 'suspended', now = Date.now();
  send(200, {
    contract: '2J-CAPABILITIES-V2', version: 2, personId: id, trainingSubject: { linkStatus: 'active', trainingUserId },
    capabilityLevel: susp ? 'blocked' : 'baseline', accessState: susp ? 'suspended' : 'baseline', reasonCode: susp ? 'ADMIN_SUSPENDED' : 'FREE_BASELINE',
    capabilities: susp ? none : base, suspensionStatus: susp ? 'suspended' : 'none', effectiveFrom: null,
    expiresAt: new Date(now + 60_000).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true },
  });
});
await new Promise(resolve => platform.listen(0, '127.0.0.1', resolve));
const linked = (id, mode) => { const personId = P[id.slice(2)]; return { id, name: id, username: id, personId, platformLink: { personId, state: 'active', origin: 'platform_admin' }, platformEnforcement: mode }; };
fs.writeFileSync(dbFile, JSON.stringify({ users: [linked('u-enf', 'enforced'), linked('u-susp', 'enforced'), linked('u-shadow', 'shadow'), { id: 'u-adm', name: 'Admin', username: 'adm' }], creds: [], subs: [], invites: [], recoveries: [] }));

const freePort = () => new Promise(resolve => { const s = http.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
const live = new Set();
async function start(enforcement, extra = {}) {
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], {
    cwd: API_ROOT, stdio: 'ignore', windowsHide: true,
    env: {
      ...process.env, PORT: String(port), DATA_DIR: DIR, SECRET_FILE: path.join(DIR, 'secret'), RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: 'u-adm', PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true',
      PLATFORM_HOME_URL: 'http://127.0.0.1:5173', PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.address().port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
      PLATFORM_ENFORCEMENT_ENABLED: enforcement, ...extra,
    },
  });
  live.add(child);
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  return { base, stop: () => new Promise(r => { live.delete(child); child.once('exit', r); child.kill(); }) };
}
after(() => { for (const child of live) child.kill(); platform.close(); });
const cookie = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
async function call(s, uid, method, route, body) {
  const r = await fetch(s.base + route, { method, headers: { cookie: cookie(uid), 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: r.status, json: await r.json().catch(() => null) };
}
const modes = () => Object.fromEntries(JSON.parse(fs.readFileSync(dbFile, 'utf8')).users.map(u => [u.id, u.platformEnforcement ?? null]));

test('switching enforcement off frees enforced members at once; on again restores them with nothing lost', async () => {
  let s = await start('true');
  assert.equal((await call(s, 'u-enf', 'GET', '/api/guided')).status, 403, 'on: an enforced Basic member has no guided training');
  assert.equal((await call(s, 'u-susp', 'GET', '/api/data')).status, 403, 'on: a suspended member is blocked');
  const before = modes();
  await s.stop();

  s = await start('false');
  calls = 0;
  assert.equal((await call(s, 'u-enf', 'GET', '/api/guided')).status, 200, 'off: free');
  assert.equal((await call(s, 'u-susp', 'GET', '/api/data')).status, 200, 'off: free');
  assert.equal((await call(s, 'u-shadow', 'GET', '/api/guided')).status, 200);
  assert.equal(calls, 0, 'off: Platform is not asked to decide anything');
  const state = { workouts: [{ id: 'w1', d: '2026-11-24' }], programs: [{ id: 'g1', name: 'Guided', source: 'guided-v2' }], activeProgramId: 'g1', premium: { program: 'p1' } };
  assert.equal((await call(s, 'u-enf', 'PUT', '/api/data', { state })).status, 200);
  assert.deepEqual((await call(s, 'u-enf', 'GET', '/api/data')).json.state.programs, state.programs, 'off: content is stored whole');
  assert.deepEqual(modes(), before, 'off: the mode of each member is kept, not erased');
  const moved = await call(s, 'u-adm', 'POST', '/api/admin/platform-enforcement', { userId: 'u-enf', mode: 'enforced' });
  assert.deepEqual([moved.status, moved.json.mode, moved.json.unchanged], [200, 'enforced', true], 'the admin still sees the stored mode');
  await s.stop();

  s = await start('true');
  assert.equal((await call(s, 'u-enf', 'GET', '/api/guided')).status, 403, 'on again: same gates');
  assert.equal((await call(s, 'u-susp', 'GET', '/api/data')).status, 403);
  assert.equal((await call(s, 'u-shadow', 'GET', '/api/guided')).status, 200, 'shadow never blocks');
  assert.deepEqual(modes(), before);
  const kept = (await call(s, 'u-enf', 'GET', '/api/data')).json.state;
  for (const key of Object.keys(state)) assert.deepEqual(kept[key], state[key], `on again: ${key} is still there`);
  assert.equal((await call(s, 'u-enf', 'PUT', '/api/data', { state: { ...kept, bw: [] } })).status, 200, 'and a normal save does not strip it');
  const saved = (await call(s, 'u-enf', 'GET', '/api/data')).json.state;
  for (const key of Object.keys(state)) assert.deepEqual(saved[key], state[key], `after saving: ${key} is still there`);
  await s.stop();
});

test('rolling back the bridge too leaves nobody enforced', async () => {
  const s = await start('', { PLATFORM_TRAINING_BRIDGE_ENABLED: 'false', PLATFORM_SSO_ENABLED: 'false' });
  assert.equal((await call(s, 'u-enf', 'GET', '/api/guided')).status, 200);
  await s.stop();
});
