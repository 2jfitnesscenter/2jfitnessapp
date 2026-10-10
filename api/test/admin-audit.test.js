import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootSocial } from './social-http.mjs';
import { AUDITED, BUNKER_AUDITED, AUDITED_ELSEWHERE, NOT_AUDITED, describeAction } from '../lib/admin-audit.js';

/* What an administrator does leaves one audit event, with a kind, the member it touched and at most an id or a count: never a value. */
const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? (['node_modules', 'test', 'scripts'].includes(e.name) ? [] : walk(path.join(d, e.name))) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []);
const source = walk(path.resolve('.')).map(f => fs.readFileSync(f, 'utf8')).join('\n');

test('every admin write route has a decision: audited, audited elsewhere, or deliberately not', () => {
  const routes = [...new Set([...source.matchAll(/'(POST \/api\/(?:admin\/[A-Za-z0-9/_-]+|bunker\/admin(?:-checkin|\/[A-Za-z0-9/_-]+)))'/g)].map(m => m[1]))];
  const known = new Set([...Object.keys(AUDITED), ...Object.keys(BUNKER_AUDITED), ...AUDITED_ELSEWHERE, ...NOT_AUDITED]);
  assert.ok(routes.length > 40);
  assert.deepEqual(routes.filter(r => !known.has(r)), [], 'a new admin route needs a decision in lib/admin-audit.js');
  assert.deepEqual([...known].filter(r => !routes.includes(r)), [], 'a classified route that no longer exists');
});

test('describeAction keeps only the allow-listed facts', () => {
  const d = describeAction(AUDITED['POST /api/admin/user/trainers'], { id: 'u1', trainerIds: ['a', 'b'], note: 'secret' });
  assert.deepEqual(d, { userId: 'u1', meta: { kind: 'trainers_assigned', count: 2 } });
  assert.deepEqual(describeAction(AUDITED['POST /api/admin/invites/new'], { code: 'SECRETCODE' }), { userId: null, meta: { kind: 'invite_created' } });
});

const S = await bootSocial({ tag: 'admin-audit' });
test.after(() => S.stop());
const { call } = S;
const events = async () => (await call('admin', 'GET', '/api/admin/security-events?limit=500')).data.events.filter(e => e.event === 'admin_action').reverse();
let seen = 0;
const next = async () => { const all = await events(); const fresh = all.slice(seen); seen = all.length; return fresh; };

test('assigning trainers, invitations, profile edits and member features record who, whom and what kind', async () => {
  assert.equal((await call('admin', 'POST', '/api/admin/user/trainers', { id: 'b', trainerIds: ['trainer-a', 'trainer-x'] })).status, 200);
  const inv = await call('admin', 'POST', '/api/admin/invites/new', {});
  assert.equal(inv.status, 200);
  const code = JSON.stringify(inv.data).match(/[A-Za-z0-9]{8,}/)?.[0];
  assert.equal((await call('admin', 'POST', '/api/admin/invites/revoke', { code })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/user/profile', { id: 'a', name: 'Ana María Sensible' })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/user/features', { id: 'a', enableRpVolumeZones: true })).status, 200);
  const ev = await next();
  assert.deepEqual(ev.map(e => [e.meta.kind, e.userId, e.actorId]), [['trainers_assigned', 'b', 'admin'], ['invite_created', null, 'admin'], ['invite_revoked', null, 'admin'], ['profile_edited', 'a', 'admin'], ['member_features', 'a', 'admin']]);
  assert.equal(ev[0].meta.count, 2); assert.equal(ev[4].meta.count, 1);
  const dump = JSON.stringify(S.read('db.json').securityEvents.filter(e => e.event === 'admin_action'));   // what is STORED (the admin view adds names on top)
  for (const leak of [code, 'Ana María', 'Sensible']) assert.equal(dump.includes(leak), false, 'no values in the log: ' + leak);
});

test('global changes: features, news, equipment, hidden exercises, the gym profile', async () => {
  assert.equal((await call('admin', 'POST', '/api/admin/features', { features: { social: true } })).status, 200);
  const news = await call('admin', 'POST', '/api/admin/news/save', { title: 'Cerrado por obras', body: 'Texto largo del aviso que no debe quedar en el log', active: true });
  assert.equal(news.status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/news/active', { id: news.data.item.id, active: false })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/news/delete', { id: news.data.item.id })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/equipment/unavailable', { eq: 'barbell', unavailable: true })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/exercises/hidden', { id: '0001', hidden: true })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/gym-profile/official', { availableEquipment: ['bodyweight', 'dumbbell'] })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/strava/config/clear', {})).status, 200);
  const ev = await next();
  assert.deepEqual(ev.map(e => e.meta.kind), ['features_changed', 'news_saved', 'news_toggled', 'news_deleted', 'equipment_availability', 'exercise_visibility', 'gym_profile_official', 'integration_config']);
  assert.deepEqual([ev[0].meta.target, ev[4].meta.target, ev[5].meta.target, ev[6].meta.count, ev[7].meta.target], ['social', 'barbell', '0001', 2, 'strava']);
  assert.equal(ev.every(e => e.actorId === 'admin' && e.userId === null), true);
  assert.equal(JSON.stringify(ev).includes('Cerrado por obras') || JSON.stringify(ev).includes('Texto largo'), false);
});

test('a refused or failed action, and anything done by a non-admin, leaves no event', async () => {
  assert.equal((await call('a', 'POST', '/api/admin/features', { features: { social: false } })).status, 403);
  assert.equal((await call('trainer-a', 'POST', '/api/admin/news/save', { title: 'x', body: 'y' })).status, 403);
  assert.equal((await call('admin', 'POST', '/api/admin/user/trainers', { id: 'b', trainerIds: ['a'] })).status, 400);
  assert.equal((await call('admin', 'POST', '/api/admin/equipment/unavailable', { unavailable: true })).status, 400);
  assert.deepEqual(await next(), []);
});

test('the member sees that an administrator touched their account, without who or what', async () => {
  const mine = (await call('a', 'GET', '/api/me/security-events')).data.events.filter(e => e.event === 'admin_action');
  assert.ok(mine.length >= 2);
  assert.equal(mine.every(e => e.byOther === true && !('actorId' in e)), true);
});

test('the deprecated trainer route is only a spelling of the canonical role change, with all of its protections', async () => {
  await next();
  const promote = await call('admin', 'POST', '/api/admin/user/trainer', { id: 'c', trainer: true });
  assert.equal(promote.status, 200); assert.equal(promote.data.trainer, true); assert.equal(promote.headers.get('deprecation'), 'true');
  assert.equal((await call('c', 'GET', '/api/trainer/members')).status, 200);
  const roleEvents = (await call('admin', 'GET', '/api/admin/security-events?limit=500')).data.events.filter(e => e.event === 'role_changed');
  assert.deepEqual(roleEvents.at(0).meta, { from: 'member', to: 'trainer' });
  // demoting drops the member assignments exactly like the role route
  await call('admin', 'POST', '/api/admin/user/trainers', { id: 'c', trainerIds: [] });
  const demote = await call('admin', 'POST', '/api/admin/user/trainer', { id: 'trainer-a', trainer: false });
  assert.equal(demote.status, 200); assert.equal(demote.data.trainer, false);
  assert.equal((await call('trainer-a', 'GET', '/api/trainer/members')).status, 403);
  const a = (await call('admin', 'GET', '/api/admin/user?id=a')).data;
  assert.equal(JSON.stringify(a).includes('trainer-a'), false, 'the assignment to a trainer who is no longer one is dropped');
  // an admin is never demoted by it, and the last admin cannot be demoted by the role route either
  assert.equal((await call('admin', 'POST', '/api/admin/user/trainer', { id: 'admin', trainer: false })).status, 200);
  assert.equal((await call('admin', 'GET', '/api/admin/users')).data.users.find(u => u.id === 'admin').role, 'admin');
  assert.equal((await call('admin', 'POST', '/api/admin/user/role', { id: 'admin', role: 'member' })).status, 409);
  assert.equal((await call('a', 'POST', '/api/admin/user/trainer', { id: 'b', trainer: true })).status, 403);
  assert.equal((await call('admin', 'POST', '/api/admin/user/trainer', { id: 'nobody', trainer: true })).status, 404);
});

test('the Bunker admin writes are audited with the trainer who made them', async () => {
  await next();
  assert.equal((await call('trainer-x', 'POST', '/api/bunker/admin/settings', { header: 'Sala 1' })).status, 200);
  assert.equal((await call('trainer-x', 'POST', '/api/bunker/admin/room-key/reset', {})).status, 200);
  assert.equal((await call('a', 'POST', '/api/bunker/admin/settings', { header: 'no' })).status, 401);
  const ev = await next();
  assert.deepEqual(ev.map(e => [e.meta.kind, e.actorId, e.userId]), [['bunker_settings', 'trainer-x', null], ['bunker_room_key_reset', 'trainer-x', null]]);
  assert.equal(JSON.stringify(ev).includes('Sala 1'), false);
});
