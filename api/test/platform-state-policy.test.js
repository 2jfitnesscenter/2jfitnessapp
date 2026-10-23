import test from 'node:test';
import assert from 'node:assert/strict';
import { applyStatePolicy } from '../platform-sso/state-policy.js';
import { baselineCapabilities } from '../platform-sso/capabilities.js';

const baseline = baselineCapabilities();
const autonomous = { ...baseline, routineCreation: true, guidedTraining: true, premiumPrograms: true };
const full = Object.fromEntries(Object.keys(baseline).map(name => [name, true]));
const consent = { agreedAt: '2026-10-01T00:00:00.000Z', version: 1 };
const guidedProgram = (extra = {}) => ({ id: 'g1', name: 'Programa oficial', source: 'guided-v2', catalogId: 'cat-1', status: 'assigned', routineIds: ['gr1'], ...extra });
const current = () => ({
  routines: [{ id: 'r1', name: 'Mi rutina', ex: [] }, { id: 'gr1', name: 'De programa', ex: [] }],
  programs: [guidedProgram(), { id: 'p1', name: 'Mi programa', routineIds: ['r1'] }],
  workouts: [{ id: 'w1', d: '2026-09-01' }],
  coach: { consent, profile: { goal: 'muscle' } }, premium: { v: 1, active: { id: 'inst', week: 1 }, history: [] }, opposition: { v: 1, plan: { id: 'o1' }, history: [] },
  activeProgramId: null, unit: 'kg',
});
const run = (caps, change) => { const cur = current(), inc = current(); change(inc); return { cur, ...applyStatePolicy({ current: cur, incoming: inc, caps }) }; };

test('the free baseline keeps creating, editing and deleting personal routines, programs and workouts', () => {
  const result = run(baseline, state => {
    state.routines.push({ id: 'r2', name: 'Nueva personal', ex: [] });
    state.routines[0].name = 'Renombrada';
    state.programs[1].routineIds = ['r1', 'r2'];
    state.programs.push({ id: 'p2', name: 'Otro personal', routineIds: [] });
    state.workouts.push({ id: 'w2', d: '2026-10-22' });
    state.unit = 'lb';
  });
  assert.deepEqual(result.stripped, []); assert.deepEqual(result.denied, []);
  assert.equal(result.state.routines.find(r => r.id === 'r2').name, 'Nueva personal');
  assert.equal(result.state.routines[0].name, 'Renombrada');
  assert.equal(result.state.programs.find(p => p.id === 'p2').name, 'Otro personal');
  assert.equal(result.state.workouts.length, 2); assert.equal(result.state.unit, 'lb');
});

test('paid subtrees without their capability keep exactly what the server has; nothing is erased', () => {
  const result = run(baseline, state => {
    state.premium.active = { id: 'forged', week: 5 };
    state.opposition.plan = { id: 'forged' };
    state.coach.profile.goal = 'fat-loss';
    state.coach.pending = { changes: [{ x: 1 }] };
  });
  assert.deepEqual(result.state.premium, result.cur.premium); assert.deepEqual(result.state.opposition, result.cur.opposition); assert.deepEqual(result.state.coach, result.cur.coach);
  assert.deepEqual(result.stripped.sort(), ['state.coach', 'state.opposition', 'state.premium']);
  assert.deepEqual(result.denied, []);
});

test('a brand-new profile cannot invent paid subtrees without the capability', () => {
  const result = applyStatePolicy({ current: null, incoming: { premium: { v: 1, active: { id: 'x' } }, opposition: { v: 1 }, coach: { consent, profile: {} }, routines: [{ id: 'r1', name: 'a' }] }, caps: baseline });
  assert.equal('premium' in result.state, false); assert.equal('opposition' in result.state, false); assert.equal('coach' in result.state, false);
  assert.equal(result.state.routines.length, 1);
});

test('reducing is always allowed: clearing paid subtrees, withdrawing the Coach consent, deleting a guided program', () => {
  const result = run(baseline, state => {
    state.premium = null; delete state.opposition; state.coach.consent = null;
    state.programs = state.programs.filter(p => p.id !== 'g1');
  });
  assert.deepEqual(result.stripped, []);
  assert.equal(result.state.premium, null); assert.equal('opposition' in result.state, false); assert.equal(result.state.coach.consent, null);
  assert.equal(result.state.programs.some(p => p.id === 'g1'), false);
});

test('without guidedTraining a guided program cannot be added, changed or activated, but the existing one is preserved', () => {
  const added = run(baseline, state => state.programs.push(guidedProgram({ id: 'g2', catalogId: 'cat-2', status: 'active' })));
  assert.equal(added.state.programs.some(p => p.id === 'g2'), false); assert.deepEqual(added.stripped, ['programs.guided.added']);
  const changed = run(baseline, state => { state.programs[0].status = 'active'; state.programs[0].week = 4; });
  assert.deepEqual(changed.state.programs[0], changed.cur.programs[0]); assert.deepEqual(changed.stripped, ['programs.guided.changed']);
  const activated = run(baseline, state => { state.activeProgramId = 'g1'; });
  assert.equal(activated.state.activeProgramId, null); assert.deepEqual(activated.stripped, ['programs.guided.activated']);
  const personalActive = run(baseline, state => { state.activeProgramId = 'p1'; });
  assert.equal(personalActive.state.activeProgramId, 'p1', 'activating a personal program is free'); assert.deepEqual(personalActive.stripped, []);
  assert.equal(added.state.routines.length, 2, 'routines and history stay');
});

test('capabilities unlock exactly their own subtree: other fee = guided + Premium, Fuerza = everything', () => {
  const change = state => { state.premium.active = { id: 'new' }; state.opposition.plan = { id: 'new' }; state.coach.profile.goal = 'x'; state.programs.push(guidedProgram({ id: 'g2', catalogId: 'cat-2' })); state.activeProgramId = 'g2'; };
  const other = run(autonomous, change);
  assert.deepEqual(other.stripped, ['state.coach']);
  assert.deepEqual(other.state.premium.active, { id: 'new' }); assert.ok(other.state.programs.some(p => p.id === 'g2')); assert.equal(other.state.activeProgramId, 'g2');
  const fuerza = run(full, change);
  assert.deepEqual(fuerza.stripped, []); assert.equal(fuerza.state.coach.profile.goal, 'x');
});

test('personal operations are checked against their own capabilities and reported as denied, never silently dropped', () => {
  const noCreate = { ...baseline, personalRoutineCreation: false };
  const created = run(noCreate, state => state.routines.push({ id: 'r9', name: 'x' }));
  assert.deepEqual(created.denied, [{ scope: 'routines.created', capability: 'personalRoutineCreation' }]);
  const edited = run(noCreate, state => { state.routines[0].name = 'edit'; });
  assert.deepEqual(edited.denied, [], 'editing needs management, not creation');
  const noManage = { ...baseline, personalRoutineManagement: false };
  assert.deepEqual(run(noManage, state => { state.programs[1].name = 'edit'; }).denied, [{ scope: 'programs.changed', capability: 'personalRoutineManagement' }]);
  const noRecord = { ...baseline, workoutRecording: false };
  assert.deepEqual(run(noRecord, state => state.workouts.push({ id: 'w9' })).denied, [{ scope: 'workouts.added', capability: 'workoutRecording' }]);
  assert.deepEqual(run(noRecord, state => { state.unit = 'lb'; }).denied, [], 'preferences are not a recorded workout');
});

test('the policy never mutates its inputs and ignores malformed payloads safely', () => {
  const cur = current(), inc = current(); inc.premium.active = { id: 'x' };
  const snapshot = JSON.stringify([cur, inc]);
  applyStatePolicy({ current: cur, incoming: inc, caps: baseline });
  assert.equal(JSON.stringify([cur, inc]), snapshot);
  for (const bad of [null, undefined, 'x', 7, [], { routines: 'nope', programs: 5, workouts: {} }]) assert.doesNotThrow(() => applyStatePolicy({ current: current(), incoming: bad, caps: baseline }));
});

test('H15: every top-level member-state key used by the sources is classified; the paid ones are exactly the commercial subtrees', async () => {
  const fs = await import('node:fs'), path = await import('node:path')
  const { STATE_KEY_CLASSES, COMMERCIAL_SUBTREES } = await import('../platform-sso/state-policy.js')
  assert.deepEqual([...STATE_KEY_CLASSES.paid].sort(), COMMERCIAL_SUBTREES.map(entry => entry.key).sort(), 'paid keys and COMMERCIAL_SUBTREES must agree')
  const all = Object.values(STATE_KEY_CLASSES).flat()
  assert.equal(new Set(all).size, all.length, 'a key belongs to one class only')
  const apiRoot = path.resolve('.'), roots = [apiRoot, path.resolve(apiRoot, '..', 'frontend', 'src')].filter(dir => fs.existsSync(dir))
  const seen = new Map()
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'test', 'tests', 'locales', 'assets', 'scripts'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(js|jsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) for (const match of fs.readFileSync(full, 'utf8').matchAll(/\bS\??\.([A-Za-z_][A-Za-z0-9_]*)/g)) seen.set(match[1], full)
    }
  }
  roots.forEach(walk)
  assert.ok(seen.size > 60, `the scan looks wrong (${seen.size} keys)`)
  const unclassified = [...seen].filter(([key]) => !all.includes(key)).map(([key, file]) => `${key} (first seen in ${path.relative(apiRoot, file)})`)
  assert.deepEqual(unclassified, [], 'classify new state keys in STATE_KEY_CLASSES (personal | paid | system) and, if paid, add them to COMMERCIAL_SUBTREES')
})
