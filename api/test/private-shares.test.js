import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial } from './social-http.mjs';

/* A routine or program sent privately to ONE friend: a cleaned snapshot, nothing published, independent of the sender's original. */
const S = await bootSocial({ tag: 'private-shares' });
test.after(() => S.stop());
const { call } = S;
await S.befriend('a', 'b');
await S.befriend('a', 'c');
const threadAB = (await call('a', 'POST', '/api/chat/direct', { userId: 'b' })).data.thread.id;
const threadAC = (await call('a', 'POST', '/api/chat/direct', { userId: 'c' })).data.thread.id;
const ROUTINE = { name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10, weight: 20, note: 'mi nota privada', bodyweight: 81.4 }, { id: '0007', sets: 2, mode: 'time', sec: 45 }], health: { x: 1 }, notes: 'privado' };
const send = (extra = {}) => call('a', 'POST', '/api/social/shares', { kind: 'routine', audience: 'chat', recipientId: 'b', threadId: threadAB, snapshot: ROUTINE, meta: { goal: 'hypertrophy', level: 'beginner', duration: '45 min', origin: 'plan' }, idempotencyKey: 'send-push-day-0001', ...extra });

test('a routine goes to one friend without being published, and the receiver can open all of it', async () => {
  const before = (await call('b', 'GET', '/api/social/routines')).data.routines.length;
  const sent = await send();
  assert.equal(sent.status, 200); assert.equal(sent.data.message.type, 'share');
  assert.equal(sent.data.message.share.card.title, 'Push day'); assert.equal(sent.data.message.share.card.metric, '2 exercises');
  assert.equal((await call('b', 'GET', '/api/social/routines')).data.routines.length, before, 'nothing was published to the community');
  assert.equal((await call('b', 'GET', '/api/social/shares')).data.shares.length, 0, 'it is not in the community feed');
  assert.equal(S.read('social.json').routines.length, 0);
  const item = await call('b', 'GET', '/api/social/shares/item?id=' + sent.data.message.shareId);
  assert.equal(item.status, 200);
  const { snapshot, meta } = item.data.share.content;
  assert.equal(snapshot.ex.length, 2); assert.equal(snapshot.ex[0].weight, 20); assert.equal(snapshot.ex[1].sec, 45);
  assert.deepEqual({ goal: meta.goal, level: meta.level, duration: meta.duration, origin: meta.origin, senderLabel: meta.senderLabel }, { goal: 'hypertrophy', level: 'beginner', duration: '45 min', origin: 'plan', senderLabel: 'Ana' });
  assert.equal(item.data.share.authorName, 'Ana');
  // the bubble in the conversation opens it, and the recipient was notified through the existing share type
  const msgs = (await call('b', 'GET', '/api/chat/messages?threadId=' + threadAB)).data.messages;
  assert.equal(msgs.at(-1).share.private, true); assert.equal(msgs.at(-1).share.card.title, 'Push day');
  assert.equal((await call('b', 'GET', '/api/notifications')).data.notifications.some(n => n.type === 'share' && n.actor.id === 'a'), true);
});

test('only what the plan itself carries travels: notes, health and body data are dropped', async () => {
  const item = (await call('b', 'GET', '/api/social/shares/item?id=' + (await send()).data.message.shareId)).data.share;
  const dump = JSON.stringify(item);
  for (const leak of ['mi nota privada', '81.4', 'health', 'privado', 'bodyweight', 'notes']) assert.equal(dump.includes(leak), false, leak);
  assert.deepEqual(Object.keys(item.content.snapshot.ex[0]).sort(), ['id', 'reps', 'sets', 'weight']);
});

test('the same request is idempotent; a reused key for other content is refused', async () => {
  const first = await send(), again = await send();
  assert.equal(again.data.message.id, first.data.message.id);
  assert.equal((await send({ snapshot: { ...ROUTINE, name: 'Otra' } })).status, 409);
});

test('invalid snapshots are refused: no exercises, a custom exercise without its definition, too large, or sent to a non-friend', async () => {
  assert.equal((await send({ idempotencyKey: 'bad-empty-000001', snapshot: { name: 'x', ex: [] } })).status, 400);
  assert.equal((await send({ idempotencyKey: 'bad-custom-00001', snapshot: { name: 'x', ex: [{ id: 'c123', sets: 3 }] } })).status, 400);
  const ok = await send({ idempotencyKey: 'custom-with-def-001', snapshot: { name: 'x', ex: [{ id: 'c123', sets: 3 }], customExDefs: [{ id: 'c123', n: 'Mi ejercicio', bp: 'chest' }] } });
  assert.equal(ok.status, 200);
  assert.equal((await send({ idempotencyKey: 'huge-0000000001', snapshot: { name: 'x', ex: Array.from({ length: 40 }, (_, i) => ({ id: '0001', sets: 3, reps: 'x'.repeat(5000) + i })) } })).status, 200, 'oversized fields are cleaned to nothing, not trusted');
  assert.equal((await call('a', 'POST', '/api/social/shares', { kind: 'routine', audience: 'chat', recipientId: 'admin', threadId: threadAB, snapshot: ROUTINE })).status, 403);
  assert.equal((await call('a', 'POST', '/api/social/shares', { kind: 'workout', audience: 'chat', recipientId: 'b', threadId: threadAB, snapshot: ROUTINE })).status, 400);
  assert.equal((await call('a', 'POST', '/api/social/shares', { kind: 'routine', audience: 'community', snapshot: ROUTINE })).status, 400, 'a snapshot never goes to the community');
});

test('a program travels with its routines and survives the sender deleting their own copy', async () => {
  const published = await call('a', 'POST', '/api/social/programs', { name: 'Fuerza 4 días', routines: [ROUTINE, { ...ROUTINE, name: 'Pull day' }] });
  const sent = await call('a', 'POST', '/api/social/shares', { kind: 'program', audience: 'chat', recipientId: 'b', threadId: threadAB, idempotencyKey: 'program-share-0001',
    snapshot: { name: 'Fuerza 4 días', routines: [ROUTINE, { ...ROUTINE, name: 'Pull day' }], daysPerWeek: 4 }, meta: { origin: 'plan' } });
  assert.equal(sent.status, 200); assert.equal(sent.data.message.share.card.metric, '2 routines');
  await call('a', 'POST', '/api/social/programs/delete', { id: published.data.id });
  const item = await call('b', 'GET', '/api/social/shares/item?id=' + sent.data.message.shareId);
  assert.equal(item.status, 200, 'the snapshot does not depend on the original');
  assert.deepEqual(item.data.share.content.snapshot.routines.map(r => r.name), ['Push day', 'Pull day']);
  assert.equal(item.data.share.content.snapshot.daysPerWeek, 4);
});

test('access: the sender and the one recipient only, and only while they are friends', async () => {
  const sent = await send({ idempotencyKey: 'access-check-00001', snapshot: { name: 'Solo para Beto', ex: [{ id: '0001', sets: 3 }] } });
  const id = sent.data.message.shareId, path = '/api/social/shares/item?id=' + id;
  assert.equal((await call('a', 'GET', path)).status, 200);
  assert.equal((await call('b', 'GET', path)).status, 200);
  assert.equal((await call('c', 'GET', path)).status, 404, 'another friend of the sender cannot open it');
  assert.equal((await call('admin', 'GET', path)).status, 404);
  assert.equal((await call('c', 'GET', '/api/chat/messages?threadId=' + threadAB)).status, 403);
  await call('b', 'POST', '/api/friends/block', { userId: 'a' });
  assert.equal((await call('b', 'GET', path)).status, 404, 'a block closes it');
  assert.equal((await call('a', 'POST', '/api/social/shares', { kind: 'routine', audience: 'chat', recipientId: 'b', threadId: threadAB, snapshot: ROUTINE, idempotencyKey: 'after-block-000001' })).status, 403);
  await call('b', 'POST', '/api/friends/unblock', { userId: 'a' });
  assert.equal((await call('b', 'GET', path)).status, 404, 'blocking ended the friendship; it does not come back by itself');
  await S.befriend('a', 'b');
  assert.equal((await call('b', 'GET', path)).status, 200);
});

test('discarding sets it aside for the recipient only: the message stays and the sender hears nothing', async () => {
  const sent = await send({ idempotencyKey: 'discard-check-00001', snapshot: { name: 'Descartable', ex: [{ id: '0001', sets: 3 }] } });
  const id = sent.data.message.shareId, path = '/api/social/shares/item?id=' + id;
  const inbox = async uid => (await call(uid, 'GET', '/api/notifications')).data.notifications.length;
  const aBefore = await inbox('a');
  assert.equal((await call('a', 'POST', '/api/social/shares/discard', { id })).status, 404, 'the sender cannot discard their own');
  assert.equal((await call('c', 'POST', '/api/social/shares/discard', { id })).status, 404);
  assert.equal((await call('b', 'POST', '/api/social/shares/discard', { id })).status, 200);
  assert.equal((await call('b', 'POST', '/api/social/shares/discard', { id })).status, 200, 'idempotent');
  assert.equal((await call('b', 'GET', path)).data.share.discarded, true);
  assert.equal((await call('a', 'GET', path)).data.share.discarded, false);
  assert.ok((await call('b', 'GET', '/api/chat/messages?threadId=' + threadAB)).data.messages.some(m => m.shareId === id), 'the conversation keeps the message');
  assert.equal(await inbox('a'), aBefore, 'the sender is not notified');
});

test('notification preferences are respected, and a private share can be reported like any other', async () => {
  await call('c', 'POST', '/api/social/preferences', { notifications: { shares: false } });
  const sent = await call('a', 'POST', '/api/social/shares', { kind: 'routine', audience: 'chat', recipientId: 'c', threadId: threadAC, snapshot: ROUTINE, idempotencyKey: 'prefs-check-000001' });
  assert.equal(sent.status, 200);
  assert.equal((await call('c', 'GET', '/api/notifications')).data.notifications.some(n => n.type === 'share'), false);
  assert.equal((await call('c', 'GET', '/api/chat/threads')).data.threads.find(t => t.id === threadAC).unread, true, 'the unread badge still counts it');
  const report = await call('c', 'POST', '/api/social/reports', { targetType: 'share', targetId: sent.data.message.shareId, reason: 'spam' });
  assert.equal(report.status, 200);
  const rows = (await call('admin', 'GET', '/api/admin/social-reports')).data.reports;
  assert.equal(rows.find(r => r.id === report.data.id).content.title, 'Push day');
  assert.equal((await call('b', 'POST', '/api/social/reports', { targetType: 'share', targetId: sent.data.message.shareId, reason: 'spam' })).status, 404, 'not for someone it was not sent to');
});
