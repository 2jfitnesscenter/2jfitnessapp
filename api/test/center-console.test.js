import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial } from './social-http.mjs';

/* Gestión del centro V1: Hoy, Miembros, Entrenadores. Built from what exists: assignments, the derived summary, the Coach engine and the live presence. */
const day = n => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const iso = n => new Date(Date.now() - n * 86400000).toISOString();
const workouts = (...ages) => ages.map((n, i) => ({ id: 'w' + i, d: day(n), name: 'Sesión', start: 1, end: 2, entries: [{ id: '0001', sets: [{ done: true, w: 10, r: 8 }] }] }));
const state = (ws, extra = {}) => ({ unit: 'kg', _ts: Date.now(), workouts: ws, routines: [{ id: 'r1', name: 'Plan', ex: [{ id: '0001', sets: 3, reps: 10 }] }], week: { 1: 'r1', 3: 'r1', 5: 'r1' },
  bodyweight: [{ d: day(3), w: 81.4 }], measurements: { waist: [{ d: day(3), v: 91 }] }, health: { note: 'private health note' }, privateNotes: 'do not leak', ...extra });
const people = [
  { id: 'admin', name: 'Admin', username: 'admin', admin: true },
  { id: 'coach-a', name: 'Coach A', username: 'coacha', trainer: true },
  { id: 'coach-x', name: 'Coach X', username: 'coachx', trainer: true },
  { id: 'm1', name: 'Mario', username: 'm1', created: iso(200), assignedTrainers: ['coach-a'] },     // trained yesterday
  { id: 'm2', name: 'Marta', username: 'm2', created: iso(200), assignedTrainers: ['coach-a', 'coach-x'] },   // 40 days without training
  { id: 'm3', name: 'Marcos', username: 'm3', created: iso(200), assignedTrainers: ['coach-x'] },   // 10 days
  { id: 'm4', name: 'Maria', username: 'm4', created: iso(3) },                                      // new, no trainer, never trained, synced today
  { id: 'm5', name: 'Mateo', username: 'm5', created: iso(100), disabled: true, assignedTrainers: ['coach-a'] },
];
const states = { m1: state(workouts(1, 4, 9)), m2: state(workouts(40, 45, 50)), m3: state(workouts(10, 12)), m4: state([]), m5: state(workouts(2)), admin: state([]), 'coach-a': state([]), 'coach-x': state([]) };
const S = await bootSocial({ people, states, tag: 'center-console' });
test.after(() => S.stop());
const { call } = S;
const get = (uid, p) => call(uid, 'GET', p);
const SENSITIVE = ['81.4', 'waist', 'private health note', 'do not leak', 'bodyweight', 'measurements', '"health"', 'privateNotes'];

test('ACL: members and anonymous callers are refused on all three views; trainers and admins are in', async () => {
  for (const p of ['/api/center/today', '/api/center/members', '/api/center/trainers']) {
    assert.equal((await get('m1', p)).status, 403, p);
    assert.equal((await fetch(S.base + p)).status, 401, p);
    assert.equal((await get('coach-a', p)).status, 200, p);
    assert.equal((await get('admin', p)).status, 200, p);
  }
});

test('Miembros: the admin sees everybody with role, state, assigned trainers, real last activity and sync apart', async () => {
  const r = (await get('admin', '/api/center/members')).data;
  assert.equal(r.users.length, 8);
  const by = id => r.users.find(u => u.id === id);
  assert.deepEqual([by('admin').role, by('coach-a').role, by('m1').role], ['admin', 'trainer', 'member']);
  assert.equal(by('m5').disabled, true);
  assert.deepEqual(by('m2').assignedTrainers.map(t => t.name).sort(), ['Coach A', 'Coach X']);
  assert.equal(by('m1').lastWorkoutAt, day(1)); assert.equal(by('m1').workoutCount, 3);
  assert.equal(by('m4').lastWorkoutAt, null); assert.equal(by('m4').workoutCount, 0);
  assert.ok(by('m4').lastSync, 'synced today, yet not "trained": the two facts are separate');
  assert.deepEqual(r.trainers.map(t => t.id).sort(), ['coach-a', 'coach-x']);
  assert.equal(SENSITIVE.some(s => JSON.stringify(r).includes(s)), false);
});

test('Miembros: a trainer knows only the members assigned to them: nobody else is listed, not even minimally, whatever they ask for', async () => {
  const mine = (await get('coach-a', '/api/center/members')).data;
  assert.equal(mine.scope, 'assigned');
  assert.deepEqual(mine.users.map(u => u.id).sort(), ['m1', 'm2', 'm5'], 'assigned only (a disabled one stays visible to their trainer), no staff');
  assert.equal(mine.users.some(u => 'lastSync' in u), false, 'sync time is an admin diagnostic');
  assert.deepEqual(mine.users.find(u => u.id === 'm2').assignedTrainers.map(t => t.name).sort(), ['Coach A', 'Coach X'], 'a member shared with another trainer is still theirs');
  for (const ask of ['?scope=all', '?scope=everybody', '?all=1', '?scope=assigned']) {
    const r = (await get('coach-a', '/api/center/members' + ask)).data;
    assert.deepEqual(r.users.map(u => u.id).sort(), ['m1', 'm2', 'm5'], ask);
    for (const stranger of ['m3', 'm4', 'Marcos', 'Maria']) assert.equal(JSON.stringify(r.users).includes(stranger), false, ask + ' leaks ' + stranger);
    assert.equal(r.scope, 'assigned');
  }
  const other = (await get('coach-x', '/api/center/members?scope=all')).data;
  assert.deepEqual(other.users.map(u => u.id).sort(), ['m2', 'm3']);
  assert.equal(JSON.stringify(other).includes('Mario'), false);
  assert.equal(SENSITIVE.some(s => JSON.stringify(mine).includes(s)), false);
  // the admin still sees everybody
  assert.equal((await get('admin', '/api/center/members?scope=assigned')).data.users.length, 8);
});

test('Hoy: activity counts use workouts, not sync; the idle list follows the number of days chosen', async () => {
  await call('m3', 'POST', '/api/activity', { active: true, name: 'Push day', exIdx: 1, exTotal: 5 });
  const t = (await get('admin', '/api/center/today?days=7')).data;
  assert.equal(t.scope, 'all'); assert.equal(t.members, 4, 'members only: no staff, no disabled');
  assert.deepEqual(t.activity, { activeNow: 1, trainedToday: 0, trained7d: 1, trained30d: 2, newMembers: 1, neverTrained: 1 });
  assert.deepEqual(t.activeNow.map(x => [x.id, x.workout]), [['m3', 'Push day']]);
  assert.deepEqual(t.newMembers.list.map(x => x.id), ['m4']);
  assert.deepEqual(t.idle.list.map(x => [x.id, x.daysSince]), [['m2', 40], ['m3', 10]], 'a member who just joined has not had the time to be idle');
  assert.deepEqual((await get('admin', '/api/center/today?days=30')).data.idle.list.map(x => x.id), ['m2']);
  assert.deepEqual((await get('admin', '/api/center/today?days=500')).data.days, 90, 'bounded');
  assert.deepEqual((await get('admin', '/api/center/today?days=3')).data.idle.list.map(x => x.id), ['m4', 'm2', 'm3'], 'never-trained first once old enough, then the longest without training');
  assert.equal(SENSITIVE.some(s => JSON.stringify(t).includes(s)), false);
});

test('Hoy: attention and upcoming reviews are the Coach engine\'s own buckets, with its explained signals', async () => {
  const t = (await get('admin', '/api/center/today')).data;
  const ids = t.attention.list.map(x => x.id);
  assert.ok(ids.includes('m2'), 'forty days without training is the engine\'s "absence" signal');
  const m2 = t.attention.list.find(x => x.id === 'm2');
  assert.ok(m2.signals.length >= 1 && m2.signals.every(s => s.id && s.severity && s.explanation));
  const board = (await get('admin', '/api/trainer/followup/overview')).data;
  assert.equal(t.attention.count, board.counts.attention); assert.equal(t.upcoming.count, board.counts.upcoming);
  assert.deepEqual(ids, board.attention.slice(0, 8).map(x => x.id), 'same order as the follow-up board');
});

test('Hoy: a trainer sees only their own members', async () => {
  const t = (await get('coach-a', '/api/center/today')).data;
  assert.equal(t.scope, 'assigned'); assert.equal(t.members, 2);
  assert.deepEqual(t.activity, { activeNow: 0, trainedToday: 0, trained7d: 1, trained30d: 1, newMembers: 0, neverTrained: 0 }, 'only Mario and Marta are counted');
  const everyone = JSON.stringify(t);
  for (const other of ['Marcos', 'Maria']) assert.equal(everyone.includes(other), false, other);
  assert.deepEqual(t.idle.list.map(x => x.id), ['m2']);
  assert.equal(t.activeNow.length, 0, 'the one training now belongs to another trainer');
});

test('Entrenadores: workload per trainer from the assignments and the Coach buckets; a trainer sees only their own row', async () => {
  const r = (await get('admin', '/api/center/trainers')).data;
  const by = id => r.trainers.find(t => t.id === id);
  assert.deepEqual(r.trainers.map(t => t.id).sort(), ['coach-a', 'coach-x']);
  assert.equal(by('coach-a').members, 2); assert.equal(by('coach-x').members, 2, 'm2 is shared');
  // the same numbers the follow-up board gives each trainer: the console reuses the engine, it does not recount
  for (const id of ['coach-a', 'coach-x']) { const board = (await get(id, '/api/trainer/followup/overview')).data.counts; assert.deepEqual([by(id).attention, by(id).upcoming], [board.attention, board.upcoming], id); }
  assert.ok(by('coach-a').attention >= 1 && by('coach-x').attention >= 1);
  assert.equal(by('coach-a').lastWorkoutAt, day(1)); assert.equal(by('coach-x').lastWorkoutAt, day(10));
  assert.equal(by('coach-a').trainedLast7d, 1); assert.equal(by('coach-x').activeNow, 1);
  assert.equal(r.unassigned.members, 1, 'Maria has no trainer');
  const own = (await get('coach-a', '/api/center/trainers')).data;
  assert.deepEqual(own.trainers.map(t => t.id), ['coach-a']); assert.equal(own.unassigned, null);
  assert.equal(JSON.stringify(own).includes('Coach X'), false);
  assert.equal(SENSITIVE.some(s => JSON.stringify(r).includes(s)), false);
});

test('the console follows assignments at once, and a demoted trainer leaves the workload view', async () => {
  assert.equal((await call('admin', 'POST', '/api/admin/user/trainers', { id: 'm4', trainerIds: ['coach-a'] })).status, 200);
  assert.deepEqual((await get('coach-a', '/api/center/members')).data.users.map(u => u.id).sort(), ['m1', 'm2', 'm4', 'm5']);
  assert.equal((await get('admin', '/api/center/trainers')).data.unassigned.members, 0);
  assert.equal((await call('admin', 'POST', '/api/admin/user/role', { id: 'coach-x', role: 'member' })).status, 200);
  assert.deepEqual((await get('admin', '/api/center/trainers')).data.trainers.map(t => t.id), ['coach-a']);
});
