import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { tempData, writeState } from './helpers.mjs';

tempData();
const { bunkerRoutes } = await import('../bunker/routes.js');

/* Health V2 privacy invariant — the shared gym screen (Bunker) never receives health data: no
 * watch/strap cardio on workouts, no weigh-ins, measurements, check-ins or imported series.
 * Same in-process factory as bunker-multi-session.test.js. */
const SECRET = 'bunker-health-privacy-secret';
const sign = p => p + '.' + crypto.createHmac('sha256', SECRET).update(p).digest('base64url');
function verifySig(token) {
  const i = token.lastIndexOf('.');
  if (i < 0) return null;
  const payload = token.slice(0, i), mac = token.slice(i + 1);
  const expect = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  try { if (!crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expect))) return null; } catch { return null; }
  return payload;
}
const routes = bunkerRoutes({
  json: (res, status, body) => { res.status = status; res.body = body; },
  readBody: async req => req._body, readSession: () => null, sign, verifySig,
  users: () => [{ id: 'u_h', name: 'Hana' }], isTrainer: () => false,
});
async function call(handler, { token, body } = {}) {
  const res = {};
  await handler({ headers: token ? { authorization: 'Bearer ' + token } : {}, url: '/x', _body: body }, res);
  return res;
}

test('the Bunker session carries no health data', async () => {
  writeState(process.env.DATA_DIR, 'u_h', {
    unit: 'kg', routines: [], programs: [], week: {}, dayPlan: {}, customEx: [], exWeights: {}, tests: [], badges: {}, active: null,
    workouts: [{ id: 'w1', d: '2026-09-20', start: 1, end: 2, name: 'Push', entries: [], prs: [],
      fitness: { primary: { source: 'whoop', kcal: 480, avgHr: 138, maxHr: 176 } }, hrZones: { avg: 130, max: 170, z: [1, 2, 3, 4, 5] } }],
    bodyweight: [{ d: '2026-09-20', w: 81.2 }], measurements: { bodyFat: [{ d: '2026-09-20', v: 18 }] },
    checkins: [{ d: '2026-09-20', energy: 2, fatigue: 5, pain: true, zones: ['knee'], note: 'private' }],
    shareCheckins: true, sleep: [{ d: '2026-09-20', v: 400 }], restingHR: [{ d: '2026-09-20', v: 55 }], steps: [{ d: '2026-09-20', v: 9000 }], hrMax: 190,
  });
  const store = await import('../bunker/store.js');
  const { body: { token } } = await call(routes['POST /api/bunker/checkin'], { body: { pin: store.pinFor('u_h') } });
  const s = await call(routes['GET /api/bunker/session'], { token });
  assert.equal(s.status, 200);
  const text = JSON.stringify(s.body);
  assert.equal(s.body.recentWorkouts[0].id, 'w1', 'last-time data still there');
  for (const leak of ['fitness', 'hrZones', 'avgHr', 'kcal', 'checkins', 'measurements', 'bodyweight', 'restingHR', 'hrMax', 'private', 'shareCheckins'])
    assert.equal(text.includes(leak), false, leak);
});
