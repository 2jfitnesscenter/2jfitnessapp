import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempData, writeState } from './helpers.mjs';

tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');
const { readState } = await import('../lib/state-store.js');

/* V3 fix — "tap your own card to reopen it with no PIN" (frontend/src/views/Bunker.jsx) leans
 * entirely on a backend property that was already true and is NOT changed by this fix: a bunker
 * token is a stateless, self-contained credential for exactly one uid (signed
 * 'bunker:<uid>:<exp>'), so one device can hold several of them at once — one per member it has
 * checked in during this visit — with zero risk of one member's token ever reading or writing
 * another's data, and zero new server-side state to manage. This file locks that property down
 * explicitly, since the new frontend feature's whole safety argument depends on it holding, even
 * though nothing here was touched to add the feature. Same in-process factory pattern as
 * bunker-finish.test.js/bunker-handoff.test.js — real sign/verifySig, no HTTP server. */
const SECRET = 'bunker-multi-session-test-secret';
function sign(payload) {
  return payload + '.' + crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try { if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null; } catch { return null; }
  return payload;
}

const users = () => [{ id: 'u_alice', name: 'Alice' }, { id: 'u_bob', name: 'Bob' }];
const routes = bunkerRoutes({
  json: (res, status, body) => { res.status = status; res.body = body; },
  readBody: async req => req._body,
  readSession: () => null,
  sign, verifySig,
  users,
  isTrainer: () => false,
});
const checkin = routes['POST /api/bunker/checkin'];
const board = routes['GET /api/bunker/board'];
const getSession = routes['GET /api/bunker/session'];
const postActive = routes['POST /api/bunker/active'];
const finish = routes['POST /api/bunker/finish'];

async function call(handler, { token, body } = {}) {
  const req = { headers: token ? { authorization: 'Bearer ' + token } : {}, url: '/x', _body: body };
  const res = {};
  await handler(req, res);
  return res;
}

const baseState = over => ({
  unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, workouts: [], customEx: [],
  exWeights: {}, bodyweight: [], tests: [], badges: {}, active: null, ...over,
});

test('two different PINs produce two independent tokens, each naming its own uid', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  writeState(process.env.DATA_DIR, 'u_bob', baseState());
  // store.pinFor lazily mints a PIN on first read — reach through the same module the routes
  // themselves use, exactly as the checkin endpoint would after a member first visits Ajustes.
  const store = await import('../bunker/store.js');
  const pinA = store.pinFor('u_alice'), pinB = store.pinFor('u_bob');

  const a = await call(checkin, { body: { pin: pinA } });
  const b = await call(checkin, { body: { pin: pinB } });
  assert.equal(a.body.uid, 'u_alice');
  assert.equal(b.body.uid, 'u_bob');
  assert.notEqual(a.body.token, b.body.token);
});

test('both members show up on the board at once, neither displacing the other', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  writeState(process.env.DATA_DIR, 'u_bob', baseState());
  const store = await import('../bunker/store.js');
  await call(checkin, { body: { pin: store.pinFor('u_alice') } });
  await call(checkin, { body: { pin: store.pinFor('u_bob') } });

  const res = await call(board);
  const uids = res.body.sessions.map(s => s.uid);
  assert.ok(uids.includes('u_alice') && uids.includes('u_bob'));
});

test('A\'s token can only ever read A\'s own session, never B\'s, however many are checked in', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState({ unit: 'kg', effort: 'rpe' }));
  writeState(process.env.DATA_DIR, 'u_bob', baseState({ unit: 'lb' }));
  const store = await import('../bunker/store.js');
  const a = await call(checkin, { body: { pin: store.pinFor('u_alice') } });
  await call(checkin, { body: { pin: store.pinFor('u_bob') } });

  const res = await call(getSession, { token: a.body.token });
  assert.equal(res.body.name, 'Alice');
  assert.equal(res.body.unit, 'kg', 'never Bob\'s own unit, even though his session is also live right now');
  assert.equal(res.body.effort, 'rpe', 'the kiosk uses this member\'s own per-set effort scale');
});

test('alternating writes (A -> B -> A -> B) never mix S.active between the two accounts', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  writeState(process.env.DATA_DIR, 'u_bob', baseState());
  const store = await import('../bunker/store.js');
  const a = await call(checkin, { body: { pin: store.pinFor('u_alice') } });
  const b = await call(checkin, { body: { pin: store.pinFor('u_bob') } });

  const activeA = { id: 'wA', d: '2026-09-21', start: 1, entries: [{ id: '0025', sets: [{ w: 40, r: 8, done: true }], target: {} }] };
  const activeB = { id: 'wB', d: '2026-09-21', start: 1, entries: [{ id: '0007', sets: [{ w: 20, r: 8, done: true }], target: {} }] };

  await call(postActive, { token: a.body.token, body: { active: activeA, exId: '0025', exName: 'x', setIdx: 1, setsTotal: 1 } });
  await call(postActive, { token: b.body.token, body: { active: activeB, exId: '0007', exName: 'y', setIdx: 1, setsTotal: 1 } });
  await call(postActive, { token: a.body.token, body: { active: { ...activeA, cur: 1 }, exId: '0025', exName: 'x', setIdx: 1, setsTotal: 1 } });
  await call(postActive, { token: b.body.token, body: { active: { ...activeB, cur: 1 }, exId: '0007', exName: 'y', setIdx: 1, setsTotal: 1 } });

  const SA = readState('u_alice'), SB = readState('u_bob');
  assert.equal(SA.active.id, 'wA');
  assert.equal(SB.active.id, 'wB');
  assert.ok(!JSON.stringify(SA).includes('0007'));
  assert.ok(!JSON.stringify(SB).includes('0025'));
});

test('A finishing drops A off the board while B stays checked in, untouched', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  writeState(process.env.DATA_DIR, 'u_bob', baseState());
  const store = await import('../bunker/store.js');
  const a = await call(checkin, { body: { pin: store.pinFor('u_alice') } });
  await call(checkin, { body: { pin: store.pinFor('u_bob') } });

  await call(finish, { token: a.body.token, body: { workout: { id: 'wA', d: '2026-09-21', start: 1, end: 2, routineId: null, name: 'x', bw: null, entries: [] } } });

  const res = await call(board);
  const uids = res.body.sessions.map(s => s.uid);
  assert.ok(!uids.includes('u_alice'), 'Alice is gone — she finished');
  assert.ok(uids.includes('u_bob'), 'Bob is still there — finishing for Alice must never touch him');
});

test('re-checking in for the same member never invalidates a token already handed out for them', async () => {
  writeState(process.env.DATA_DIR, 'u_alice', baseState());
  const store = await import('../bunker/store.js');
  const pin = store.pinFor('u_alice');
  const first = await call(checkin, { body: { pin } });
  await call(checkin, { body: { pin } });
  // The server keeps no per-token session registry to invalidate an older token when a newer one
  // is minted for the same uid — "which one this device should actually use" is a decision
  // Bunker.jsx's own credential map makes entirely client-side, never something the backend
  // tracks or enforces. A token minted earlier for this account must keep verifying.
  const res = await call(getSession, { token: first.body.token });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Alice');
});
