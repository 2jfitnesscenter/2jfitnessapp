import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial } from './social-http.mjs';

/* Which events notify, which do not, and that the member's own choices decide. Programs reuse the 'share' type: no new type was needed. */
const S = await bootSocial({ tag: 'social-notifications' });
test.after(() => S.stop());
const { call } = S;
const inbox = async uid => (await call(uid, 'GET', '/api/notifications')).data;
const ROUTINE = { name: 'Push day', ex: [{ id: '0001', sets: 3, reps: 10 }] };

test('a friend request and its acceptance notify; the unread count follows reading', async () => {
  const req = await call('a', 'POST', '/api/friends/request', { username: 'beto' });
  const b0 = await inbox('b');
  assert.deepEqual(b0.notifications.map(n => n.type), ['friend_request']); assert.equal(b0.unread, 1);
  await call('b', 'POST', '/api/friends/accept', { requestId: req.data.request.id });
  assert.deepEqual((await inbox('a')).notifications.map(n => n.type), ['friend_accepted']);
  await call('b', 'POST', '/api/notifications/read-all', {});
  assert.equal((await inbox('b')).unread, 0);
});

test('a routine and a program sent privately both arrive as the share type, linking to the conversation, and honour the preference', async () => {
  const thread = (await call('a', 'POST', '/api/chat/direct', { userId: 'b' })).data.thread.id;
  const send = (kind, snapshot, key) => call('a', 'POST', '/api/social/shares', { kind, audience: 'chat', recipientId: 'b', threadId: thread, snapshot, idempotencyKey: key });
  assert.equal((await send('routine', ROUTINE, 'notify-routine-0001')).status, 200);
  assert.equal((await send('program', { name: 'Plan', routines: [ROUTINE] }, 'notify-program-0001')).status, 200);
  const shares = (await inbox('b')).notifications.filter(n => n.type === 'share');
  assert.equal(shares.length, 2); assert.ok(shares.every(n => n.deepLink === '/chat/' + thread && n.actor.id === 'a'));
  await call('b', 'POST', '/api/social/preferences', { notifications: { shares: false } });
  await send('routine', { ...ROUTINE, name: 'Otra' }, 'notify-routine-0002');
  assert.equal((await inbox('b')).notifications.filter(n => n.type === 'share').length, 2, 'switched off: nothing new');
  assert.equal((await call('b', 'GET', '/api/chat/threads')).data.threads[0].unread, true, 'the conversation still shows it as unread');
  await call('b', 'POST', '/api/social/preferences', { notifications: { shares: true } });
});

test('a direct message notifies once per message and honours the messages preference', async () => {
  const thread = (await call('a', 'POST', '/api/chat/direct', { userId: 'b' })).data.thread.id;
  const n0 = (await inbox('b')).notifications.filter(n => n.type === 'message').length;
  await call('a', 'POST', '/api/chat/messages', { threadId: thread, text: 'hola' });
  assert.equal((await inbox('b')).notifications.filter(n => n.type === 'message').length, n0 + 1);
  await call('b', 'POST', '/api/social/preferences', { notifications: { messages: false } });
  await call('a', 'POST', '/api/chat/messages', { threadId: thread, text: 'otra vez' });
  assert.equal((await inbox('b')).notifications.filter(n => n.type === 'message').length, n0 + 1);
});

test('comments do not notify: that is the behaviour, stated here so a change is a decision', async () => {
  const topic = await call('b', 'POST', '/api/social/topics', { title: 'Hilo', text: 'x' });
  const before = (await inbox('b')).notifications.length;
  await call('a', 'POST', '/api/social/topics/comment', { id: topic.data.id, text: 'hola' });
  assert.equal((await inbox('b')).notifications.length, before);
});

test('a notification can only be read by its owner', async () => {
  const mine = (await inbox('b')).notifications[0];
  assert.equal((await call('a', 'POST', '/api/notifications/read', { id: mine.id })).status, 404);
  assert.equal((await call('b', 'POST', '/api/notifications/read', { id: mine.id })).status, 200);
});
