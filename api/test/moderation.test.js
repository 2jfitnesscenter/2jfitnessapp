import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial } from './social-http.mjs';

/* Reporting a chat message or a comment, removing content, the audit trail and the notice to the author. */
const S = await bootSocial({ tag: 'moderation' });
test.after(() => S.stop());
const { call } = S;
await S.befriend('a', 'b');
const thread = (await call('a', 'POST', '/api/chat/direct', { userId: 'b' })).data.thread.id;
const notices = async uid => (await call(uid, 'GET', '/api/notifications')).data.notifications.filter(n => n.type === 'moderation');
const events = async () => (await call('admin', 'GET', '/api/admin/security-events')).data.events.filter(e => e.event === 'content_removed');

test('a chat message can be reported by the other person only, and removing it leaves a marker, an audit event and a notice', async () => {
  const sent = await call('a', 'POST', '/api/chat/messages', { threadId: thread, text: 'texto muy ofensivo que no debe quedar en el registro' });
  const mid = sent.data.message.id, target = `${thread}:${mid}`;
  assert.equal((await call('a', 'POST', '/api/social/reports', { targetType: 'message', targetId: target, reason: 'inappropriate' })).status, 404, 'not your own message');
  assert.equal((await call('c', 'POST', '/api/social/reports', { targetType: 'message', targetId: target, reason: 'inappropriate' })).status, 404, 'not someone outside the conversation');
  const rep = await call('b', 'POST', '/api/social/reports', { targetType: 'message', targetId: target, reason: 'inappropriate' });
  assert.equal(rep.status, 200);
  assert.equal((await call('b', 'POST', '/api/social/reports', { targetType: 'message', targetId: target, reason: 'spam' })).status, 409, 'one pending report each');
  const rows = (await call('admin', 'GET', '/api/admin/social-reports')).data.reports;
  assert.match(rows.find(r => r.id === rep.data.id).content.title, /^texto muy ofensivo/);
  assert.equal((await call('b', 'GET', '/api/admin/social-reports')).status, 403);
  // a client holding the thread is told to reload it, and the words are gone for both sides
  const before = (await call('b', 'GET', `/api/chat/messages?threadId=${thread}`)).data;
  const removed = await call('admin', 'POST', '/api/admin/social-reports/resolve', { id: rep.data.id, action: 'remove' });
  assert.equal(removed.status, 200);
  const after = (await call('b', 'GET', `/api/chat/messages?threadId=${thread}&after=${before.messages.at(-1).id}&rev=${before.rev}`)).data;
  assert.equal(after.full, true); assert.ok(after.rev > before.rev);
  const gone = after.messages.find(m => m.id === mid);
  assert.deepEqual({ type: gone.type, text: gone.text }, { type: 'removed', text: undefined });
  assert.equal(JSON.stringify((await call('a', 'GET', `/api/chat/messages?threadId=${thread}`)).data).includes('ofensivo'), false);
  // the author hears it, in general terms; the reporter is not named anywhere
  const n = (await notices('a'))[0];
  assert.deepEqual({ kind: n.target.kind, what: n.target.id, reason: n.meta.reason }, { kind: 'removed', what: 'message', reason: 'inappropriate' });
  assert.equal(n.actor, null); assert.equal(JSON.stringify(n).includes('"b"'), false);
  assert.equal((await notices('b')).length, 0);
  // audit: the actor, the kind, the id and the reason; never the words
  const ev = (await events()).at(0);
  assert.deepEqual({ userId: ev.userId, actorId: ev.actorId, kind: ev.meta.kind, target: ev.meta.target, reason: ev.meta.reason }, { userId: 'a', actorId: 'admin', kind: 'message', target, reason: 'inappropriate' });
  assert.equal(JSON.stringify(await events()).includes('ofensivo'), false);
  assert.equal((await call('a', 'GET', '/api/me/security-events')).data.events.some(e => e.event === 'content_removed' && e.byOther), true, 'the author sees it in their own activity');
  assert.equal((await call('b', 'POST', '/api/social/reports', { targetType: 'message', targetId: target, reason: 'spam' })).status, 404, 'a removed message cannot be reported again');
});

test('a support message can be reported by the member, and a dismissal changes nothing for anyone', async () => {
  const th = (await call('a', 'POST', '/api/chat/threads', { text: 'Hola entrenador' })).data.thread.id;
  const reply = await call('trainer-a', 'POST', '/api/chat/messages', { threadId: th, text: 'respuesta' });
  const rep = await call('a', 'POST', '/api/social/reports', { targetType: 'message', targetId: `${th}:${reply.data.message.id}`, reason: 'other' });
  assert.equal(rep.status, 200);
  const evs = (await events()).length, ns = (await notices('trainer-a')).length;
  assert.equal((await call('admin', 'POST', '/api/admin/social-reports/resolve', { id: rep.data.id, action: 'dismiss' })).status, 200);
  assert.equal((await events()).length, evs); assert.equal((await notices('trainer-a')).length, ns);
  assert.equal((await call('trainer-x', 'POST', '/api/social/reports', { targetType: 'message', targetId: `${th}:${reply.data.message.id}`, reason: 'spam' })).status, 404, 'an unassigned trainer cannot even reach it');
});

test('comments on a mark, a topic and a board post can be reported and removed; only others\' comments', async () => {
  const mark = await call('a', 'POST', '/api/social/wall', { exId: '0001', exName: 'Bench', mode: 'reps', value: { w: 10, r: 8 }, sourceDate: '2026-09-27', public: true });
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'community', activity: 'community' } });
  const topic = await call('b', 'POST', '/api/social/topics', { title: 'Hilo', text: 'x' });
  const board = await call('trainer-x', 'POST', '/api/social/board', { title: 'Aviso', text: 'y' });
  await call('trainer-x', 'POST', '/api/social/board/toggle-comments', { id: board.data.id, commentsEnabled: true });
  const wc = await call('c', 'POST', '/api/social/wall/comment', { id: mark.data.id, text: 'comentario malo en marca' });
  const tc = await call('c', 'POST', '/api/social/topics/comment', { id: topic.data.id, text: 'comentario malo en tema' });
  const bc = await call('c', 'POST', '/api/social/board/comment', { id: board.data.id, text: 'comentario malo en aviso' });
  const targets = [['wall', mark.data.id, wc.data.comment.id], ['topic', topic.data.id, tc.data.comment.id], ['board', board.data.id, bc.data.comment.id]].map(([k, p, c]) => `${k}:${p}:${c}`);
  assert.equal((await call('c', 'POST', '/api/social/reports', { targetType: 'comment', targetId: targets[0], reason: 'spam' })).status, 404, 'not your own comment');
  assert.equal((await call('b', 'POST', '/api/social/reports', { targetType: 'comment', targetId: 'wall:nope:nope', reason: 'spam' })).status, 404);
  for (const target of targets) {
    const rep = await call('b', 'POST', '/api/social/reports', { targetType: 'comment', targetId: target, reason: 'inappropriate' });
    assert.equal(rep.status, 200, target);
    assert.equal((await call('admin', 'POST', '/api/admin/social-reports/resolve', { id: rep.data.id, action: 'remove' })).status, 200);
  }
  assert.equal((await call('a', 'GET', '/api/social/wall')).data.wall.find(w => w.id === mark.data.id).comments.length, 0);
  assert.equal((await call('b', 'GET', '/api/social/topics')).data.topics[0].comments.length, 0);
  assert.equal((await call('b', 'GET', '/api/social/board')).data.board[0].comments.length, 0);
  assert.equal((await notices('c')).length, 3, 'one general notice per removal');
  assert.equal((await events()).filter(e => e.userId === 'c').length, 3);
  assert.equal(JSON.stringify(await events()).includes('comentario malo'), false);
});

test('a report of a comment on a mark you cannot see goes nowhere', async () => {
  const mark = await call('a', 'POST', '/api/social/wall', { exId: '0001', exName: 'Bench', mode: 'reps', value: { w: 12, r: 6 }, sourceDate: '2026-09-27', public: true });
  const c = await call('a', 'POST', '/api/social/wall/comment', { id: mark.data.id, text: 'ok' });
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'friends', activity: 'friends' } });
  assert.equal((await call('c', 'POST', '/api/social/reports', { targetType: 'comment', targetId: `wall:${mark.data.id}:${c.data.comment.id}`, reason: 'spam' })).status, 404, 'a stranger cannot see that mark');
});

test('staff removing somebody else\'s content directly leaves the same trail; removing your own does not', async () => {
  const t1 = await call('b', 'POST', '/api/social/topics', { title: 'Mío', text: 'propio' });
  const before = (await events()).length;
  assert.equal((await call('b', 'POST', '/api/social/topics/delete', { id: t1.data.id })).status, 200);
  assert.equal((await events()).length, before, 'deleting your own is not moderation');
  assert.equal((await notices('b')).length, 0);
  const t2 = await call('b', 'POST', '/api/social/topics', { title: 'Ajeno', text: 'otro' });
  assert.equal((await call('trainer-x', 'POST', '/api/social/topics/delete', { id: t2.data.id })).status, 200);
  assert.equal((await events()).length, before + 1);
  assert.equal((await notices('b')).length, 1);
  const r = await call('c', 'POST', '/api/social/routines', S.ROUTINE);
  assert.equal((await call('admin', 'POST', '/api/social/routines/delete', { id: r.data.id })).status, 200);
  assert.equal((await notices('c')).filter(n => n.target.id === 'routine').length, 1);
});

test('the removal notice cannot be switched off, unlike every other notification', async () => {
  await call('b', 'POST', '/api/social/preferences', { notifications: { shares: false, messages: false, friendRequests: false, challenges: false, achievements: false } });
  const t = await call('b', 'POST', '/api/social/topics', { title: 'Otro', text: 'z' });
  const n0 = (await notices('b')).length;
  await call('admin', 'POST', '/api/social/topics/delete', { id: t.data.id });
  assert.equal((await notices('b')).length, n0 + 1);
});
