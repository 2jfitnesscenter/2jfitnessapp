import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempData, writeState } from './helpers.mjs';

/* Constructor V2.1 on the server: guided timing is whitelisted on routines and blocks, the
 * protocol judges guided blocks as what they are (2J-HEU-INTERVAL-ROUNDS), the AI can pick the
 * official guided blocks, and the Bunker rest carries its real length. In-process, no HTTP. */
tempData();
const meta = await import('../lib/plan-meta.js');
const store = await import('../lib/blocks-store.js');
const gate = await import('../coach/protocol-gate.js');
const { bunkerRoutes } = await import('../bunker/routes.js');

test('routine block labels keep a guided timing (clamped) and never invent one', () => {
  const ex = [{ id: '2138', blk: 'k1' }, { id: '0025', blk: 'k2' }];
  const out = meta.sanitizeRoutineBlocks([
    { iid: 'k1', type: 'hiit', timing: { preset: 'tabata', work: 20, rest: 10, rounds: 99, prep: -1, roundRest: 0, evil: 'x' } },
    { iid: 'k2', type: 'strength', timing: { work: 30 } },
  ], ex);
  assert.deepEqual(out[0].timing, { prep: 0, work: 20, rest: 10, rounds: 10, roundRest: 0, preset: 'tabata' });
  assert.equal(out[1].timing, undefined);
  assert.deepEqual(meta.blockTypesOf(out), { k1: 'hiit', k2: 'strength' });
});

test('the save policy judges a Tabata as rounds when the block says so — and as sets when it does not', () => {
  const day = [{ id: '0514', sets: 8, mode: 'time', sec: 20, blk: 'k1' }];
  const m = meta.sanitizePlanMeta({ goal: 'general', level: 'intermediate' });
  assert.equal(meta.enforcePlanPolicy([day], m, { k1: 'hiit' }), null);
  const blind = meta.enforcePlanPolicy([day], m);
  assert.equal(blind.status, 400);
  assert.ok(blind.validation.issues.some(i => i.code === 'sets_outside_allowed'));
  // restrictions are never softened by a block type
  const r = meta.enforcePlanPolicy([day], meta.sanitizePlanMeta({ goal: 'general', level: 'intermediate', restrictions: ['no-jumps'] }), { k1: 'hiit' });
  assert.equal(r.status, 400);
  assert.ok(r.validation.issues.some(i => i.code === 'restriction'));
});

test('a personal guided block is stored with its timing; a strength block never carries one', () => {
  const t1 = { id: 't1' };
  const g = store.upsert(t1, false, { name: 'Core express', type: 'circuit', goal: 'general', level: 'intermediate', focus: 'abs',
    timing: { prep: 10, work: 30, rest: 15, rounds: 3, roundRest: 60 },
    ex: [{ id: '0175', sets: 3, mode: 'reps', reps: 15 }, { id: '2135', sets: 3, mode: 'time', sec: 30 }] });
  assert.ok(g.block, JSON.stringify(g.error || g.validation?.issues));
  assert.deepEqual(g.block.timing, { prep: 10, work: 30, rest: 15, rounds: 3, roundRest: 60 });
  assert.equal(g.block.type, 'circuit');
  const s = store.upsert(t1, false, { name: 'Plain', type: 'strength', goal: 'hypertrophy', level: 'intermediate', timing: { work: 30 },
    ex: [{ id: '0025', sets: 3, mode: 'reps', reps: 8, targetRepsMin: 6, targetRepsMax: 10 }] });
  assert.equal(s.block.timing, undefined);
});

test('the AI sees official guided blocks as such (type + timing) and copies them with their timing', () => {
  const list = store.compatibleOfficial({ goal: 'general', level: 'advanced', max: 60 });
  const tab = list.find(b => b.id === 'off-cardio-general-advanced-x-hiit');
  assert.ok(tab, 'the Tabata block is offered for general/advanced');
  assert.equal(tab.type, 'hiit');
  assert.deepEqual(tab.timing, { prep: 10, work: 20, rest: 10, rounds: 8, roundRest: 0, preset: 'tabata' });
  assert.ok(list.filter(b => !b.type).length > 0, 'strength blocks stay compact, no type field');
  const { data, errors } = gate.expandBlocks({ routines: [{ id: 'r1', name: 'Cardio', blocks: ['off-cardio-general-advanced-x-hiit'], ex: [] }] });
  assert.deepEqual(errors, []);
  const r = data.routines[0];
  assert.equal(r._blockMeta[0].type, 'hiit');
  assert.equal(r._blockMeta[0].timing.rounds, 8);
  assert.equal(r.ex.length, 1);
  assert.equal(r.ex[0].sets, 8);
  // the gate judges it with the block types: an official Tabata passes
  const g = gate.gatePlan({ name: 'p', routines: [{ id: 'r1', name: 'Cardio', ex: r.ex, blocks: r._blockMeta }], week: { 1: 'r1' } },
    { goal: 'general', level: 'advanced', restrictions: [], unavailableEq: [] });
  assert.equal(g.ok, true, JSON.stringify(g.errors));
});

test('Bunker: the board carries each athlete rest length, independently', async () => {
  const SECRET = 'v21-secret';
  const sign = p => p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
  const verifySig = t => { const i = t.lastIndexOf('.'); const p = t.slice(0, i); return sign(p) === t ? p : null; };
  const routes = bunkerRoutes({ json: (res, s, b) => { res.status = s; res.body = b; }, readBody: async req => req._body, readSession: () => null,
    sign, verifySig, users: () => [{ id: 'u_a', name: 'A' }, { id: 'u_b', name: 'B' }], isTrainer: () => false });
  const call = async (h, { token, body } = {}) => { const res = {}; await h({ headers: token ? { authorization: 'Bearer ' + token } : {}, url: '/x', _body: body }, res); return res; };
  const bstore = await import('../bunker/store.js');
  const base = { unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [], exWeights: {}, bodyweight: [], tests: [], badges: {}, active: null };
  writeState(process.env.DATA_DIR, 'u_a', base);
  writeState(process.env.DATA_DIR, 'u_b', base);
  const a = await call(routes['POST /api/bunker/checkin'], { body: { pin: bstore.pinFor('u_a') } });
  const b = await call(routes['POST /api/bunker/checkin'], { body: { pin: bstore.pinFor('u_b') } });
  await call(routes['POST /api/bunker/rest'], { token: a.body.token, body: { sec: 150 } });
  await call(routes['POST /api/bunker/rest'], { token: b.body.token, body: { sec: 90 } });
  const board = (await call(routes['GET /api/bunker/board'])).body.sessions;
  assert.equal(board.find(s => s.uid === 'u_a').restSec, 150);
  assert.equal(board.find(s => s.uid === 'u_b').restSec, 90);
  // the public board still carries no health keys
  assert.doesNotMatch(JSON.stringify(board), /"(fitness|hrZones|avgHr|checkins|hrMax|measurements|bodyweight)"/);
});
