import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { memberView, overviewRow, aiFacts } from '../lib/coach-followup.js';
import { tempData } from './helpers.mjs';

/* Health V2 composition goals are the member's own: they sit in the member's state (opaque to Sync) and reach no other system — not the Coach sheet, the roster
   row, the professional AI facts, the member's Coach AI payload, nor a social share. */
tempData();
const { build } = await import('../coach/payload.js');
const TODAY = '2026-10-20';
const S = {
  unit: 'kg', height: 178, birthDate: '1990-05-04', body: 'male', targetW: 78, workouts: [], routines: [], programs: [],
  bodyweight: [{ d: '2026-09-01', w: 84 }, { d: '2026-10-10', w: 81 }],
  measurements: { bodyFat: [{ d: '2026-09-01', v: 21, t: 1 }, { d: '2026-10-09', v: 18.6, t: 1 }], muscleMass: [{ d: '2026-10-09', v: 36.2, t: 1 }] },
  compGoals: { bodyFat: { target: 15, at: '2026-09-02' }, muscleMass: { target: 38, at: '2026-09-02' } },
};
const u = { id: 'u1', name: 'Ana', created: '2026-06-01T10:00:00.000Z' };

test('the staff sheet, the roster row and the professional AI facts never carry the composition goals', () => {
  const view = memberView({ S, u, today: TODAY });
  for (const text of [JSON.stringify(view), JSON.stringify(overviewRow({ S, u, today: TODAY })), JSON.stringify(aiFacts(view))]) {
    assert.equal(/compGoals|muscleMass|"bodyFat"|goalBodyFat|target":15|target":38/.test(text), false, text.slice(0, 200));
  }
});

test('the member\'s own Coach AI payload does not include them either', () => {
  const p = JSON.stringify(build(S, 'u1', { kind: 'create' }));
  assert.equal(/compGoals|muscleMass|bodyFat/.test(p), false);
});

test('no server module outside the member\'s own state reads S.compGoals', () => {
  const dir = new URL('../', import.meta.url);
  const hits = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'test' || e.name === 'data') continue;
    const p = new URL(e.name + (e.isDirectory() ? '/' : ''), d);
    if (e.isDirectory()) walk(p); else if (/\.(js|mjs)$/.test(e.name) && /compGoals/.test(fs.readFileSync(p, 'utf8'))) hits.push(e.name);
  } };
  walk(dir);
  assert.deepEqual(hits, [], 'the goals are a member-side feature: the API only stores the opaque state');
});
