import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tempData } from './helpers.mjs';

/* The admin member list reads a derived summary, not every encrypted state file. */
const dir = tempData();
const summaries = await import('../lib/user-summary.js');
const { writeState, readState, stateFile, stateFingerprint } = await import('../lib/state-store.js');
const rebuild = uid => summaries.summaryFor(uid, { fingerprint: () => stateFingerprint(uid), read: () => { reads++; return readState(uid); } });
let reads = 0;
const state = (n, extra = {}) => ({ unit: 'kg', _ts: 1_760_000_000_000 + n, workouts: Array.from({ length: n }, (_, i) => ({ id: 'w' + i, d: `2026-09-${String(10 + (i % 15)).padStart(2, '0')}`, entries: [] })),
  bodyweight: [{ d: '2026-09-01', w: 81.4 }], measurements: { waist: [{ d: '2026-09-01', v: 91 }] }, health: { note: 'private' }, routines: [{ id: 'r', name: 'x', ex: [] }], privateNotes: 'secret', ...extra });

test('a summary is only what the list shows: no workouts, routines, weight, measurements, health or notes', () => {
  const s = summaries.summarize(state(4));
  assert.deepEqual(Object.keys(s).sort(), ['fp', 'lastSync', 'lastWorkoutAt', 'v', 'workoutCount']);
  assert.equal(JSON.stringify(s).match(/81\.4|waist|private|secret|routine/i), null);
});

test('workoutCount and lastWorkoutAt come from the workouts; lastSync is a different fact', () => {
  const s = summaries.summarize({ _ts: 5_000, workouts: [{ d: '2026-09-20' }, { d: '2026-09-27' }, { d: '2026-09-02' }, { d: 'nonsense' }, {}] });
  assert.deepEqual({ n: s.workoutCount, last: s.lastWorkoutAt, sync: s.lastSync }, { n: 5, last: '2026-09-27', sync: 5_000 });
  const fresh = summaries.summarize({ workouts: [] });
  assert.deepEqual({ n: fresh.workoutCount, last: fresh.lastWorkoutAt, sync: fresh.lastSync }, { n: 0, last: null, sync: null });
  // a member who synced today with no workouts is "synced", not "trained"
  const syncedOnly = summaries.summarize({ _ts: Date.now(), workouts: [] });
  assert.ok(syncedOnly.lastSync && syncedOnly.lastWorkoutAt === null);
});

test('writing the state updates the summary at once, with no read-back', () => {
  summaries.resetMemory(); summaries.resetCounts(); reads = 0;
  writeState('u1', state(3));
  assert.equal(rebuild('u1').workoutCount, 3); assert.equal(reads, 0, 'served from the write, not from a decrypt');
  writeState('u1', state(7));
  const s = rebuild('u1');
  assert.equal(s.workoutCount, 7); assert.equal(reads, 0);
});

test('polling a hundred members decrypts nothing; a restart reuses the saved file; a lost file costs one rebuild each, once', () => {
  summaries.resetMemory(); fs.rmSync(path.join(dir, 'user-summaries.json'), { force: true });
  for (let i = 0; i < 100; i++) writeState('m' + i, state(i % 9));
  summaries.flush();
  summaries.resetMemory(); summaries.resetCounts(); reads = 0;                      // "restart": memory is gone, the file stays
  for (let poll = 0; poll < 5; poll++) for (let i = 0; i < 100; i++) rebuild('m' + i);
  assert.equal(reads, 0, 'five polls of 100 members after a restart: zero decrypts');
  fs.rmSync(path.join(dir, 'user-summaries.json')); summaries.resetMemory(); reads = 0;   // the cache file is lost
  for (let poll = 0; poll < 3; poll++) for (let i = 0; i < 100; i++) rebuild('m' + i);
  assert.equal(reads, 100, 'regenerated once per member, then served from memory');
});

test('a state file changed behind the summary\'s back is noticed by its fingerprint and only that member is rebuilt', () => {
  summaries.resetMemory(); fs.rmSync(path.join(dir, 'user-summaries.json'), { force: true });
  writeState('a', state(2)); writeState('b', state(2));
  reads = 0;
  // a restore / another writer replaces b's file without going through writeState
  const plain = JSON.stringify({ ...state(5), _sync: { schemaVersion: 2, revision: 9, generation: 0, tombstones: { workouts: [], routines: [], programs: [] }, receipts: {}, enabled: false, activeRevision: 0 } });
  fs.writeFileSync(stateFile('b'), plain + ' '.repeat(7));
  assert.equal(rebuild('a').workoutCount, 2); assert.equal(reads, 0);
  assert.equal(rebuild('b').workoutCount, 5); assert.equal(reads, 1);
  assert.equal(rebuild('b').workoutCount, 5); assert.equal(reads, 1, 'and then it is cached again');
});

test('legacy plain-JSON states, members with no state and unreadable states all produce a safe summary', () => {
  summaries.resetMemory(); reads = 0;
  fs.writeFileSync(stateFile('legacy'), JSON.stringify({ _ts: 7, workouts: [{ id: 'x', d: '2026-08-01' }] }));      // from before encryption
  assert.deepEqual(rebuild('legacy'), { lastSync: 7, workoutCount: 1, lastWorkoutAt: '2026-08-01' });
  assert.deepEqual(rebuild('never-synced'), { lastSync: null, workoutCount: 0, lastWorkoutAt: null });
  fs.writeFileSync(stateFile('broken'), 'not json and not ciphertext');
  assert.deepEqual(rebuild('broken'), { lastSync: null, workoutCount: 0, lastWorkoutAt: null, unreadable: true });
  assert.equal(readState('legacy').workouts.length, 1, 'the canonical state is untouched');
});

test('forgetting and pruning drop summaries of people who are gone', () => {
  summaries.resetMemory(); writeState('p1', state(1)); writeState('p2', state(1)); summaries.flush();
  summaries.forget('p1'); summaries.prune(['p2']); summaries.flush();
  summaries.resetMemory(); reads = 0;
  rebuild('p2'); assert.equal(reads, 0); rebuild('p1'); assert.equal(reads, 1);
  const blob = fs.readFileSync(path.join(dir, 'user-summaries.json'), 'utf8');
  assert.equal(blob.includes('workoutCount'), false, 'the saved file is encrypted');
});

/* ---- through the real server ---- */
const SECRET = 'u'.repeat(64);
const hdir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-users-'));
fs.writeFileSync(path.join(hdir, 'secret'), SECRET, { mode: 0o600 });
const people = [{ id: 'admin', name: 'Admin', username: 'admin', admin: true }, { id: 'coach', name: 'Coach', username: 'coach', trainer: true },
  ...Array.from({ length: 30 }, (_, i) => ({ id: 'm' + i, name: 'Miembro ' + i, username: 'm' + i, created: '2026-08-01T00:00:00Z', ...(i === 3 ? { assignedTrainers: ['coach'] } : {}) }))];
fs.writeFileSync(path.join(hdir, 'db.json'), JSON.stringify({ users: people, creds: [], subs: [{ userId: 'm1', endpoint: 'e' }], invites: [], recoveries: [] }));
for (const p of people) fs.writeFileSync(path.join(hdir, `state-${p.id}.json`), JSON.stringify(state(p.id === 'm5' ? 12 : 3)));
fs.writeFileSync(path.join(hdir, 'social.json'), JSON.stringify({ routines: [], programs: [], wall: [], challenges: [], goals: [], topics: [], board: [] }));
const port = 39000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', pathToFileURL(path.resolve('test/count-state-reads.mjs')).href, 'server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), DATA_DIR: hdir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
const cookie = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
const get = async uid => { const r = await fetch(base + '/api/admin/users', { headers: uid ? { cookie: cookie(uid) } : {} }); const text = await r.text(); return { status: r.status, text, data: r.status === 200 ? JSON.parse(text) : null }; };
const readCount = async () => { await new Promise(r => setTimeout(r, 150)); return Number(fs.readFileSync(path.join(hdir, 'reads.count'), 'utf8')); };
// the server reads the states once at boot (schedulers); wait until the count stops moving so that only the poll is measured, however slow the machine is
const settle = async () => { let last = -1; for (let i = 0; i < 40; i++) { const now = await readCount(); if (now === last) { await new Promise(r => setTimeout(r, 300)); if ((await readCount()) === now) return now; } last = now; } return last; };
let firstPollReads = 0;
test.after(() => child.kill());

test('GET /api/admin/users: admin only, the same fields the list had plus the separated ones, nothing sensitive', async () => {
  assert.equal((await get(null)).status, 401);
  assert.equal((await get('m1')).status, 403);
  assert.equal((await get('coach')).status, 403);
  const before = await settle();
  const r = await get('admin');
  firstPollReads = (await readCount()) - before;
  assert.equal(r.status, 200); assert.equal(r.data.users.length, 32);
  const m5 = r.data.users.find(u => u.id === 'm5'), m3 = r.data.users.find(u => u.id === 'm3'), c = r.data.users.find(u => u.id === 'coach');
  assert.deepEqual({ n: m5.workoutCount, last: m5.lastWorkoutAt, role: m5.role, legacy: [m5.workouts, m5.lastWorkout] }, { n: 12, last: '2026-09-21', role: 'member', legacy: [undefined, undefined] });
  assert.equal(m5.lastSync, 1_760_000_000_012); assert.notEqual(m5.lastSync, m5.lastWorkoutAt);
  assert.deepEqual(m3.assignedTrainers, ['coach']); assert.equal(c.role, 'trainer'); assert.equal(r.data.users.find(u => u.id === 'admin').role, 'admin');
  assert.equal(r.data.users.find(u => u.id === 'm1').hasPush, true); assert.equal(m5.activeNow, false);
  for (const leak of ['81.4', 'waist', 'private', 'secret', 'bodyweight', 'measurements', '"health"', '"routines"', '"entries"']) assert.equal(r.text.includes(leak), false, leak);
});

test('polling does not decrypt the members again', async () => {
  const afterFirst = await readCount();
  assert.equal(firstPollReads, 32, 'the very first poll rebuilds each member once (no summary file yet)');
  for (let i = 0; i < 6; i++) await get('admin');
  assert.equal(await readCount(), afterFirst, 'six more polls read no state file');
  console.log(`state files read: first poll ${firstPollReads} (32 members), six more polls +0`);
});
