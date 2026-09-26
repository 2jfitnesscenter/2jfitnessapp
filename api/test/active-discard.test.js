import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* POST /api/active/clear — the one authorized way for the normal (non-Bunker) app to actually
 * end its own S.active, since PUT /api/data unconditionally re-injects whatever the server
 * already has there (see server.js's own comment). Same real-child-process approach as
 * test/data-active-preserve.test.js, extended with a second user (for the cross-account test)
 * and the Bunker PIN checkin flow (for the "session live at the kiosk" guard). */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'active-discard-'));
const SECRET = 'b'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'u1', name: 'User One' }, { id: 'u2', name: 'User Two' }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
fs.writeFileSync(path.join(dir, 'bunker.json'), JSON.stringify({
  pins: [{ userId: 'u1', pin: '1111', updatedAt: Date.now() }], adminCodes: [], roomKey: null,
  settings: { columns: 4, header: 'x', enableRestEndBeep: true, highlightFinishedRest: true, hideWeightsInPublicView: false, autoLockSec: 60 },
}, null, 2));

const PORT = 34568;
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

function writeState(uid, S) { fs.writeFileSync(path.join(dir, 'state-' + uid + '.json'), JSON.stringify(S)); }
function cookieFor(uid) {
  const exp = Date.now() + 86400000;
  const payload = `${uid}:${exp}:0`;
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return `gymsid=${payload}.${mac}`;
}
async function req(method, p, { body, uid = 'u1' } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookieFor(uid) };
  const r = await fetch(base + p, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j };
}
const getData = uid => req('GET', '/api/data', { uid }).then(r => r.body.state);
const putData = (state, uid) => req('PUT', '/api/data', { body: { state }, uid });
const clearActive = (id, uid) => req('POST', '/api/active/clear', { body: { id }, uid });

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, ...over,
});
const someActive = id => ({ id, d: '2026-09-20', start: Date.now() - 27309000, routineId: null, name: 'Espalda & Bíceps', bw: null, cur: 0, entries: [{ id: '0025', target: {}, plan: {}, sets: [] }] });

test('1-2. discard clears an existing server-side active', async () => {
  const active = someActive('discard-1');
  writeState('u1', baseState({ active }));
  const res = await clearActive('discard-1', 'u1');
  assert.equal(res.status, 200);
  assert.equal((await getData('u1')).active, null);
});

test('3. a normal PUT right after a discard does not resurrect it', async () => {
  writeState('u1', baseState({ active: someActive('discard-2') }));
  await clearActive('discard-2', 'u1');
  await putData(baseState({ _ts: Date.now() }), 'u1');
  assert.ok(!(await getData('u1')).active);
});

test('4. discarding the same (already-cleared) session again is a harmless no-op', async () => {
  writeState('u1', baseState({ active: someActive('discard-3') }));
  const first = await clearActive('discard-3', 'u1');
  const second = await clearActive('discard-3', 'u1');
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal((await getData('u1')).active, null);
});

test('5. an id that no longer matches the current active never deletes the wrong session', async () => {
  const real = someActive('discard-real');
  writeState('u1', baseState({ active: real }));
  // A stale client believes it's discarding an old session that has since been replaced.
  const res = await clearActive('discard-stale', 'u1');
  assert.equal(res.status, 200);
  assert.deepEqual((await getData('u1')).active, real, 'the CURRENT active, with a different id, survives untouched');
});

test('6. finish still works and its own explicit clear is unaffected by this endpoint existing', async () => {
  const active = { id: 'to-finish-2', d: '2026-09-20', entries: [{ id: '0025', sets: [{ w: 60, r: 8, done: true }], target: {} }] };
  writeState('u1', baseState({ active }));
  const checkin = await req('POST', '/api/bunker/checkin', { body: { pin: '1111' } });
  const token = checkin.body.token;
  const finish = await fetch(base + '/api/bunker/finish', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ workout: { id: active.id, d: active.d, start: 1, end: 2, routineId: null, name: 'x', bw: null, entries: active.entries } }),
  }).then(r => r.json());
  assert.equal((await getData('u1')).active, null);
  assert.ok(finish.ok);
});

test('7. a normal PUT still preserves an untouched server-side active (regression)', async () => {
  const active = someActive('regression-put');
  writeState('u1', baseState({ active }));
  await putData(baseState({ active: null, _ts: Date.now() }), 'u1');
  assert.deepEqual((await getData('u1')).active, active);
});

test('8-9. a handoff to the Bunker still works, and is not touched by an unrelated PUT', async () => {
  writeState('u1', baseState({ active: null }));
  const active = someActive('handoff-still-works');
  const handoff = await req('POST', '/api/bunker/handoff', { body: { active }, uid: 'u1' });
  assert.equal(handoff.status, 200);
  await putData(baseState({ _ts: Date.now(), unrelated: true }), 'u1');
  assert.deepEqual((await getData('u1')).active, active, 'an unrelated phone sync never erases the handed-off session');
});

test('10. user A cannot clear user B\'s active — there is no cross-account path at all', async () => {
  const activeB = someActive('belongs-to-b');
  writeState('u2', baseState({ active: activeB }));
  // u1's own state, deliberately reset here so this test doesn't depend on what an earlier
  // test in this file left behind — its own active, unaffected either way, just something
  // known to assert against.
  writeState('u1', baseState({ active: someActive('belongs-to-a') }));
  // u1's own cookie session — the endpoint has no `uid` field to target someone else with.
  const res = await clearActive('belongs-to-b', 'u1');
  assert.equal(res.status, 200); // succeeds, but only ever against the caller's OWN state
  assert.deepEqual((await getData('u2')).active, activeB, 'u2 is completely untouched');
  assert.equal((await getData('u1')).active?.id, 'belongs-to-a', 'u1\'s own (differently-id\'d) active was left alone too — the id simply didn\'t match');
});

test('11. a session actually checked in at the Bunker right now refuses a normal-app discard', async () => {
  const active = someActive('live-at-bunker');
  writeState('u1', baseState({ active }));
  const checkin = await req('POST', '/api/bunker/checkin', { body: { pin: '1111' } });
  assert.ok(checkin.body.token, 'checked in — the Bunker board now shows this member live');
  const res = await clearActive('live-at-bunker', 'u1');
  assert.equal(res.status, 409);
  assert.deepEqual((await getData('u1')).active, active, 'refused — the session survives untouched');
});

test('12. once the Bunker session has actually ended, a normal-app discard works again', async () => {
  const active = someActive('bunker-then-discard');
  writeState('u1', baseState({ active }));
  const checkin = await req('POST', '/api/bunker/checkin', { body: { pin: '1111' } });
  const token = checkin.body.token;
  // Ends the room presence (not S.active) — same as a member walking away and their kiosk
  // panel timing out, or an admin closing their board card.
  await fetch(base + '/api/bunker/finish', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
    body: JSON.stringify({ workout: { id: active.id, d: active.d, start: 1, end: 2, routineId: null, name: 'x', bw: null, entries: [] } }),
  });
  // Finish already cleared S.active itself — re-seed a fresh one to prove discard works
  // again once the kiosk presence is gone, independent of finish's own clear.
  writeState('u1', baseState({ active: someActive('after-bunker-ended') }));
  const res = await clearActive('after-bunker-ended', 'u1');
  assert.equal(res.status, 200);
  assert.equal((await getData('u1')).active, null);
});

test.after(() => { child.kill(); });
