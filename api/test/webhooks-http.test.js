// Outbound webhooks through the real HTTP API: auth, ownership, secret shown once, disabled by default, and the state-write hook.
// Runs isolated server processes with their own DATA_DIR. No outbound network is needed: the one hostname used does not resolve.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const SECRET = 'e'.repeat(64);
const today = new Date().toISOString().slice(0, 10);

function makeDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2j-webhooks-http-'));
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.mkdirSync(path.join(dir, 'uploads'));
  fs.mkdirSync(path.join(dir, 'followup-photos'));
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [{ id: 'member-a', name: 'Member A', username: 'membera' }, { id: 'member-b', name: 'Member B', username: 'memberb' }],
    creds: [], deviceSessions: [], securityEvents: [], subs: [], restAlerts: [], invites: [], recoveries: [], recoveryRequests: [], machineAliases: [],
  }));
  return dir;
}

// Starts this test's own server and resolves only once that exact child reports it is listening on its port.
// A port already held by another test process (parallel suite) makes the child exit with EADDRINUSE; the next
// attempt takes a fresh port. Polling /api/health alone is not enough: it would reach the other process, whose
// session secret differs, and every request would then answer 401 instead of the status under test.
function spawnOnFreePort(dir, env) {
  return new Promise(async (resolve, reject) => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const port = 40000 + Math.floor(Math.random() * 20000), base = `http://127.0.0.1:${port}`;
      const child = spawn(process.execPath, ['server.js'], {
        cwd: path.resolve('.'),
        env: { ...process.env, PORT: String(port), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base, ...env },
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      child.stdout.setEncoding('utf8');
      const started = await new Promise(done => {
        let out = '';
        const onData = chunk => {
          out += chunk;
          if (out.includes(`gym-api on :${port} `)) { child.stdout.off('data', onData); child.stdout.resume(); done(true); }
        };
        child.stdout.on('data', onData);
        child.once('exit', () => done(false));
        // Boot can be slow when the whole suite runs in parallel: give up on this port after 30 s.
        setTimeout(() => done(false), 30000).unref();
      });
      if (started) return resolve({ child, port, base });
      child.kill();
      if (child.exitCode === null) await new Promise(r => child.once('exit', r));
    }
    reject(new Error('could not start the test server on a free port'));
  });
}

async function startServer(env) {
  const dir = makeDir();
  const { child, base } = await spawnOnFreePort(dir, env);
  const cookie = uid => {
    const payload = `${uid}:${Date.now() + 86400000}:0`;
    return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
  };
  const call = async (uid, method, p, body) => {
    const headers = { 'content-type': 'application/json' };
    if (uid) headers.cookie = cookie(uid);
    const r = await fetch(base + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch { /* no body */ }
    return { status: r.status, data, text: JSON.stringify(data) };
  };
  return { dir, child, call, base };
}

test('disabled by default: without WEBHOOKS_ENABLED every webhook route answers 403 and stores nothing', async t => {
  const s = await startServer({});
  t.after(() => s.child.kill());
  const list = await s.call('member-a', 'GET', '/api/webhooks');
  assert.equal(list.status, 403);
  assert.equal(list.data.code, 'webhooks_disabled');
  const made = await s.call('member-a', 'POST', '/api/webhooks', { url: 'https://hooks.example.com/in' });
  assert.equal(made.status, 403);
  assert.equal(made.text.includes('whsec_'), false);
  assert.equal(fs.existsSync(path.join(s.dir, 'webhooks.json')), false, 'no webhook file is written');
});

test('auth: anonymous callers are refused on every route', async t => {
  const s = await startServer({ WEBHOOKS_ENABLED: '1' });
  t.after(() => s.child.kill());
  assert.equal((await s.call(null, 'GET', '/api/webhooks')).status, 401);
  assert.equal((await s.call(null, 'POST', '/api/webhooks', { url: 'https://hooks.example.com/in' })).status, 401);
  assert.equal((await s.call(null, 'POST', '/api/webhooks/rotate', { id: 'x' })).status, 401);
  assert.equal((await s.call(null, 'POST', '/api/webhooks/delete', { id: 'x' })).status, 401);
});

test('owner lifecycle: the secret is returned once, never again; other members cannot see or touch it', async t => {
  const s = await startServer({ WEBHOOKS_ENABLED: '1' });
  t.after(() => s.child.kill());

  const bad = await s.call('member-a', 'POST', '/api/webhooks', { url: 'http://hooks.example.com/in' });
  assert.equal(bad.status, 400); assert.equal(bad.data.code, 'WEBHOOK_URL_NOT_HTTPS');
  const priv = await s.call('member-a', 'POST', '/api/webhooks', { url: 'https://10.0.0.7/in' });
  assert.equal(priv.status, 400); assert.equal(priv.data.code, 'WEBHOOK_TARGET_PRIVATE');
  const ev = await s.call('member-a', 'POST', '/api/webhooks', { url: 'https://hooks.example.com/in', events: ['member.deleted'] });
  assert.equal(ev.status, 400);

  const created = await s.call('member-a', 'POST', '/api/webhooks', { url: 'https://hooks.example.com/in/SECRETPATH?token=abc', events: ['workout.finished'] });
  assert.equal(created.status, 201);
  assert.match(created.data.secret, /^whsec_/);
  assert.equal(created.data.secretShownOnce, true);
  const id = created.data.endpoint.id;
  assert.equal(created.data.endpoint.host, 'hooks.example.com');
  assert.ok(!created.text.includes('SECRETPATH') && !created.text.includes('token=abc'), 'the URL path and query are not echoed back');

  const mine = await s.call('member-a', 'GET', '/api/webhooks');
  assert.equal(mine.status, 200);
  assert.equal(mine.data.endpoints.length, 1);
  assert.ok(!mine.text.includes('whsec_') && !mine.text.includes(created.data.secret), 'lists never carry the secret');
  assert.ok(!mine.text.includes('SECRETPATH'));

  const theirs = await s.call('member-b', 'GET', '/api/webhooks');
  assert.deepEqual(theirs.data.endpoints, [], 'another member sees nothing of it');
  assert.equal((await s.call('member-b', 'POST', '/api/webhooks/update', { id, enabled: false })).status, 404);
  assert.equal((await s.call('member-b', 'POST', '/api/webhooks/rotate', { id })).status, 404);
  assert.equal((await s.call('member-b', 'POST', '/api/webhooks/delete', { id })).status, 404);
  assert.equal((await s.call('member-a', 'GET', '/api/webhooks')).data.endpoints[0].enabled, true, 'still on after the other member tried');

  const rotated = await s.call('member-a', 'POST', '/api/webhooks/rotate', { id });
  assert.equal(rotated.status, 200);
  assert.notEqual(rotated.data.secret, created.data.secret);
  assert.ok(!(await s.call('member-a', 'GET', '/api/webhooks')).text.includes(rotated.data.secret));

  assert.equal((await s.call('member-a', 'POST', '/api/webhooks/delete', { id })).status, 200);
  assert.deepEqual((await s.call('member-a', 'GET', '/api/webhooks')).data.endpoints, []);
});

test('a finished workout written through the normal state save is queued for the member’s endpoint, and the log holds no body', async t => {
  const s = await startServer({ WEBHOOKS_ENABLED: '1' });
  t.after(() => s.child.kill());
  await s.call('member-a', 'POST', '/api/webhooks', { url: 'https://hooks.example.com/in', events: ['workout.finished'] });
  // First save of the account: establishes the baseline and must not fire anything.
  const base = await s.call('member-a', 'PUT', '/api/data', { state: { workouts: [], bodyweight: [], routines: [], routineVersions: {} } });
  assert.equal(base.status, 200, base.text);
  // Second save adds a finished workout with private content, which must never leave the server.
  const put = await s.call('member-a', 'PUT', '/api/data', {
    state: { workouts: [{ id: 'wk-1', d: today, name: 'PRIVATE ROUTINE', note: 'PRIVATE NOTE', entries: [], start: Date.now(), end: Date.now() }], bodyweight: [], routines: [], routineVersions: {} },
  });
  assert.equal(put.status, 200, put.text);

  let log = [];
  for (let i = 0; i < 50 && log.length === 0; i++) {
    await new Promise(r => setTimeout(r, 100));
    log = (await s.call('member-a', 'GET', '/api/webhooks')).data.deliveries;
  }
  assert.ok(log.length >= 1, 'a delivery was attempted');
  assert.equal(log[0].event, 'workout.finished');
  assert.deepEqual(Object.keys(log[0]).sort(), ['at', 'attempt', 'durationMs', 'event', 'eventId', 'httpCode', 'status', 'webhookId'].sort());
  const onDisk = fs.readFileSync(path.join(s.dir, 'webhooks.json'), 'utf8');
  assert.ok(!onDisk.includes('PRIVATE ROUTINE') && !onDisk.includes('PRIVATE NOTE'), 'the workout content is not stored in the webhook file');
  assert.ok(!JSON.stringify(log).includes('PRIVATE'), 'nor in the log');
});
