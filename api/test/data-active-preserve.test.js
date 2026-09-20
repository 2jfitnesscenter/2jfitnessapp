import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* PUT /api/data replaces the whole state file, and the client never has authority over
   `active` — but until this fix, that replacement also wiped whatever the SERVER already had
   there, because the field was simply absent from what got written. This boots the real
   server.js (the only faithful way to test a route table that isn't exported) as an actual
   child process against a scratch DATA_DIR + a fixed port, and drives it purely over HTTP —
   never ./data, never a real secret. A real child process (killed explicitly at the end) rather
   than an in-process import sidesteps server.js's own http.Server never being closed/unref()'d,
   which would otherwise hang this test file's own process indefinitely. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-preserve-'));
const SECRET = 'a'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'u1', name: 'Test User' }], creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
fs.writeFileSync(path.join(dir, 'bunker.json'), JSON.stringify({
  pins: [{ userId: 'u1', pin: '9999', updatedAt: Date.now() }], adminCodes: [], roomKey: null,
  settings: { columns: 4, header: 'x', enableRestEndBeep: true, highlightFinishedRest: true, hideWeightsInPublicView: false, autoLockSec: 60 },
}, null, 2));

const PORT = 34567;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base },
  stdio: ['ignore', 'ignore', 'ignore'],
});
// Poll /api/health instead of a fixed sleep — the child's own startup time can vary.
async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) return; } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 100));
  }
  throw new Error('server child process never became healthy');
}
await waitForServer();

function writeState(uid, S) { fs.writeFileSync(path.join(dir, 'state-' + uid + '.json'), JSON.stringify(S)); }
function cookieFor(uid) {
  const exp = Date.now() + 86400000;
  const payload = `${uid}:${exp}:0`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}
async function req(method, p, { body, bearer } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookieFor('u1') };
  if (bearer) headers.authorization = 'Bearer ' + bearer;
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j };
}
const getData = () => req('GET', '/api/data').then(r => r.body.state);
const putData = state => req('PUT', '/api/data', { body: { state } });
const checkin = () => req('POST', '/api/bunker/checkin', { body: { pin: '9999' } }).then(r => r.body.token);

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, ...over,
});

test('1. a normal PUT /api/data preserves an existing server-side S.active untouched', async () => {
  const active = { id: 'bunker-live-1', d: '2026-09-20', entries: [{ id: '0025', sets: [] }] };
  writeState('u1', baseState({ active }));
  const res = await putData(baseState({ active: null, _ts: Date.now() }));
  assert.equal(res.status, 200);
  assert.deepEqual((await getData()).active, active);
});

test('2. an active sent (accidentally or maliciously) via PUT never replaces the server\'s own', async () => {
  writeState('u1', baseState({ active: { id: 'real-server-active', d: '2026-09-20', entries: [] } }));
  await putData(baseState({ active: { id: 'forged-client-active', d: '2099-01-01', entries: [{ id: 'not-real' }] }, _ts: Date.now() }));
  const active = (await getData()).active;
  assert.equal(active.id, 'real-server-active');
  assert.equal(JSON.stringify(active).includes('forged-client-active'), false);
});

test('3. when the server has no active, a normal PUT creates none', async () => {
  writeState('u1', baseState({ active: null }));
  await putData(baseState({ _ts: Date.now() })); // client sends no `active` key at all
  // null and an absent key both mean "no active session" everywhere else in this app
  // (sessionPayload's own `S.active || null`, Bunker.jsx's `p.active || ...`) — the fix's job is
  // only to preserve a TRUTHY existing one, not to guarantee which falsy shape an empty one takes.
  assert.ok(!(await getData()).active);
});

test('4. POST /api/bunker/finish still leaves active:null, and a later normal PUT does not resurrect it', async () => {
  const active = { id: 'to-finish-1', d: '2026-09-20', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }], target: {} }] };
  writeState('u1', baseState({ active }));
  const token = await checkin();
  const finish = await req('POST', '/api/bunker/finish', { bearer: token, body: { workout: { id: active.id, d: active.d, start: 1, end: 2, routineId: null, name: 'x', bw: null, entries: active.entries } } });
  assert.equal(finish.status, 200);
  assert.equal((await getData()).active, null); // finish writes an explicit null

  // A normal sync right after finishing (the phone doing anything at all) must not bring it back.
  await putData(baseState({ _ts: Date.now() }));
  assert.ok(!(await getData()).active);
});

test('5. handoff -> a normal PUT in between -> Bunker still recovers exactly the transferred active', async () => {
  writeState('u1', baseState({ active: null }));
  const active = { id: 'handoff-survives-1', d: '2026-09-20', routineId: 'r1', name: 'Full body', bw: null, cur: 0, entries: [{ id: '0025', target: { sets: 3, reps: 8, weight: 60 }, plan: { kind: 'first' }, sets: [{ w: 60, r: 8, done: false }] }] };
  const handoff = await req('POST', '/api/bunker/handoff', { body: { active } });
  assert.equal(handoff.status, 200);

  // The phone syncing anything else in between (its own unrelated local state) must not erase it.
  await putData(baseState({ _ts: Date.now(), someLocalSetting: true }));

  const token = await checkin();
  const session = await req('GET', '/api/bunker/session', { bearer: token });
  assert.deepEqual(session.body.active, active);
});

test('6. a handoff conflict still returns 409 after normal syncs have happened in between', async () => {
  const kiosk = { id: 'kiosk-conflict-1', d: '2026-09-20', entries: [] };
  writeState('u1', baseState({ active: kiosk }));

  // Any number of ordinary phone syncs in between must not clear the kiosk's session.
  await putData(baseState({ _ts: Date.now() }));
  await putData(baseState({ _ts: Date.now() + 1 }));

  const blocked = await req('POST', '/api/bunker/handoff', { body: { active: { id: 'phone-conflict-1', d: '2026-09-20', entries: [] } } });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.existing.id, 'kiosk-conflict-1');
});

test.after(() => { child.kill(); });
