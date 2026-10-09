import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial } from './social-http.mjs';

/* What can leave in a share: a fixed set of fields computed on the server. Body weight, measurements, health, notes, check-ins and Coach have no path out,
 * whatever the client asks for. The member's state below is full of all of them on purpose. */
const S = await bootSocial({ tag: 'share-privacy' });
test.after(() => S.stop());
const { call } = S;
await S.befriend('a', 'b');
await call('a', 'POST', '/api/social/preferences', { privacy: { workouts: true, routines: true, prs: true, achievements: true } });
const thread = (await call('a', 'POST', '/api/chat/direct', { userId: 'b' })).data.thread.id;
const SECRETS = ['81.4', 'waist', 'private health note', 'private coach note', 'do not leak', 'bodyweight', 'measurements', '"health"', '"coach"', 'privateNotes', 'conditions'];
const clean = (value, where) => { const dump = JSON.stringify(value); for (const s of SECRETS) assert.equal(dump.includes(s), false, `${where} leaks ${s}`); };

test('a workout card is title, metric and date unless the member ticks more; ticked numbers are computed from the workout', async () => {
  const plain = await call('a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'w1', audience: 'community' });
  assert.equal(plain.status, 200);
  assert.deepEqual(Object.keys(plain.data.share.card).sort(), ['date', 'metric', 'title']);
  const all = await call('a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'w1', audience: 'community', include: ['duration', 'volume', 'prs', 'cardio'] });
  assert.deepEqual(all.data.share.card.extras, { duration: 52, volume: 4200, unit: 'kg', prs: 1, cardio: 20 });
  const some = await call('a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'w1', audience: 'community', include: ['duration'] });
  assert.deepEqual(some.data.share.card.extras, { duration: 52 });
  for (const r of [plain, all, some]) clean(r.data, 'community share');
});

test('anything outside the four optional numbers is ignored: asking for weight, health or notes adds nothing', async () => {
  const r = await call('a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'w1', audience: 'community', include: ['bodyweight', 'health', 'measurements', 'notes', 'coach', 'weight'] });
  assert.equal(r.status, 200); assert.equal(r.data.share.card.extras, undefined);
  clean(r.data, 'forged include');
  const other = await call('a', 'POST', '/api/social/shares', { kind: 'streak', targetId: '1', audience: 'community', include: ['duration'] });
  assert.notEqual(other.status, 500);
  if (other.status === 200) assert.equal(other.data.share.card.extras, undefined);
});

test('what the friend and the community read back is the same allow-list, in the feed, the item and the chat bubble', async () => {
  const sent = await call('a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'w1', audience: 'chat', recipientId: 'b', threadId: thread, include: ['duration', 'prs'], idempotencyKey: 'privacy-chat-0001' });
  assert.equal(sent.status, 200); assert.deepEqual(sent.data.message.share.card.extras, { duration: 52, prs: 1 });
  const item = await call('b', 'GET', '/api/social/shares/item?id=' + sent.data.message.shareId);
  assert.deepEqual(Object.keys(item.data.share.card).sort(), ['date', 'extras', 'metric', 'title']);
  const msgs = await call('b', 'GET', '/api/chat/messages?threadId=' + thread);
  const feed = await call('b', 'GET', '/api/social/shares');
  for (const [v, w] of [[item.data, 'item'], [msgs.data, 'chat'], [feed.data, 'feed']]) clean(v, w);
  // the profile a friend sees is an allow-list too
  const profile = await call('b', 'GET', '/api/social/profile?id=a');
  assert.deepEqual(Object.keys(profile.data.profile).sort(), ['avatar', 'id', 'isFriend', 'name']);
});

test('switching the workouts category off closes it again, extras included', async () => {
  await call('a', 'POST', '/api/social/preferences', { privacy: { workouts: false } });
  assert.equal((await call('a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'w1', audience: 'community', include: ['duration'] })).status, 403);
  assert.equal((await call('b', 'GET', '/api/social/shares')).data.shares.length, 0);
  await call('a', 'POST', '/api/social/preferences', { privacy: { workouts: true } });
});

test('a routine snapshot carries the plan and nothing from the rest of the member\'s data', async () => {
  const sent = await call('a', 'POST', '/api/social/shares', { kind: 'routine', audience: 'chat', recipientId: 'b', threadId: thread, idempotencyKey: 'privacy-routine-01',
    snapshot: { name: 'Plan limpio', ex: [{ id: '0001', sets: 3, reps: 10, note: 'private health note', bodyweight: 81.4, coach: 'private coach note' }], health: { conditions: ['x'] }, measurements: [{ waist: 91 }], privateNotes: 'do not leak' } });
  assert.equal(sent.status, 200);
  const item = await call('b', 'GET', '/api/social/shares/item?id=' + sent.data.message.shareId);
  clean(item.data, 'snapshot item');
  assert.deepEqual(Object.keys(item.data.share.content.snapshot).sort(), ['customExDefs', 'emoji', 'ex', 'name']);
});
