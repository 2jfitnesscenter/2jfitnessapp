import test from 'node:test';
import assert from 'node:assert/strict';
import { bootSocial, WORKOUT_DAY } from './social-http.mjs';

/* Social ACL, negative first: what a person must NOT be able to see or do by guessing an id, whatever the UI hides. */
const S = await bootSocial({ tag: 'social-acl' });
test.after(() => S.stop());
const { call } = S;

test('a routine or program you cannot see cannot be rated by id; one you can see can', async () => {
  const r = await call('a', 'POST', '/api/social/routines', S.ROUTINE);
  const p = await call('a', 'POST', '/api/social/programs', { name: 'Plan', routines: [S.ROUTINE] });
  assert.equal(r.status, 200); assert.equal(p.status, 200);
  // default privacy is "friends": a stranger sees nothing and cannot rate by id
  assert.equal((await call('c', 'POST', '/api/social/routines/rate', { id: r.data.id, stars: 5 })).status, 404);
  assert.equal((await call('c', 'POST', '/api/social/programs/rate', { id: p.data.id, stars: 5 })).status, 404);
  assert.equal((await call('c', 'GET', '/api/social/routines')).data.routines.length, 0);
  await S.befriend('a', 'b');
  assert.equal((await call('b', 'POST', '/api/social/routines/rate', { id: r.data.id, stars: 4 })).status, 200);
  assert.equal((await call('b', 'POST', '/api/social/programs/rate', { id: p.data.id, stars: 4 })).status, 200);
  // a block cuts it even for a friend of old
  await call('a', 'POST', '/api/friends/block', { userId: 'b' });
  assert.equal((await call('b', 'POST', '/api/social/routines/rate', { id: r.data.id, stars: 1 })).status, 404);
  assert.equal((await call('b', 'GET', '/api/social/routines')).data.routines.length, 0);
  // an open community still excludes whoever is blocked, and includes the rest
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'community', activity: 'community' } });
  assert.equal((await call('c', 'POST', '/api/social/routines/rate', { id: r.data.id, stars: 5 })).status, 200);
  assert.equal((await call('b', 'POST', '/api/social/routines/rate', { id: r.data.id, stars: 1 })).status, 404);
  assert.equal((await call('admin', 'POST', '/api/social/routines/rate', { id: r.data.id, stars: 3 })).status, 200, 'staff are not locked out of moderation');
  await call('a', 'POST', '/api/friends/unblock', { userId: 'b' });
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'friends', activity: 'friends' } });
});

test('goals: body weight reaches only accepted friends; an exercise goal follows records privacy; blocks and private profiles cut both', async () => {
  await call('a', 'POST', '/api/social/goals/publish', { kind: 'bodyweight', target: 78 });
  await call('a', 'POST', '/api/social/goals/publish', { kind: 'exercise', exId: '0001', exName: 'Bench', target: 80 });
  const seen = async uid => (await call(uid, 'GET', '/api/social/goals')).data.goals.map(g => g.kind).sort();
  assert.deepEqual(await seen('a'), ['bodyweight', 'exercise'], 'the author sees their own');
  assert.deepEqual(await seen('c'), [], 'a stranger sees neither the weight nor the mark');
  await S.befriend('a', 'b');
  assert.deepEqual(await seen('b'), ['bodyweight', 'exercise'], 'an accepted friend sees both');
  const body = (await call('b', 'GET', '/api/social/goals')).data.goals;
  assert.equal(body.find(g => g.kind === 'bodyweight').current, 81.4);
  // community scope opens the exercise goal to everyone but never the body weight
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'community', activity: 'community' } });
  assert.deepEqual(await seen('c'), ['exercise'], 'body weight never leaves the friends');
  assert.equal(JSON.stringify((await call('c', 'GET', '/api/social/goals')).data).includes('81.4'), false);
  // records turned off hides the exercise goal too
  await call('a', 'POST', '/api/social/preferences', { privacy: { prs: false } });
  assert.deepEqual(await seen('c'), []);
  await call('a', 'POST', '/api/social/preferences', { privacy: { prs: true } });
  // a private profile hides everything from everyone but the author
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'private' } });
  assert.deepEqual(await seen('b'), []); assert.deepEqual(await seen('a'), ['bodyweight', 'exercise']);
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'friends', activity: 'friends' } });
  assert.deepEqual(await seen('b'), ['bodyweight', 'exercise']);
  await call('b', 'POST', '/api/friends/block', { userId: 'a' });
  assert.deepEqual(await seen('b'), [], 'a block hides goals in both directions');
  assert.deepEqual(await seen('a').then(x => x), ['bodyweight', 'exercise']);
  await call('b', 'POST', '/api/friends/unblock', { userId: 'a' });
});

test('challenges: a blocked author is invisible in the list, the detail and for joining; staff still see them', async () => {
  const ch = await call('trainer-x', 'POST', '/api/social/challenges/new', { name: 'Septiembre', type: 'frequency', targetWorkouts: 8, startDate: '2026-09-01', endDate: '2027-12-31' });
  assert.equal(ch.status, 200);
  assert.equal((await call('c', 'GET', '/api/social/challenges')).data.challenges.length, 1);
  await call('c', 'POST', '/api/friends/block', { userId: 'trainer-x' });
  assert.equal((await call('c', 'GET', '/api/social/challenges')).data.challenges.length, 0);
  assert.equal((await call('c', 'GET', '/api/social/challenges/detail?id=' + ch.data.id)).status, 404);
  assert.equal((await call('c', 'POST', '/api/social/challenges/join', { id: ch.data.id })).status, 404);
  assert.equal((await call('admin', 'GET', '/api/social/challenges')).data.challenges.length, 1);
  assert.equal((await call('b', 'GET', '/api/social/challenges')).data.challenges.length, 1, 'other members are unaffected');
  await call('c', 'POST', '/api/friends/unblock', { userId: 'trainer-x' });
});

test('topics and the trainers board respect blocks: reading, commenting and the comments themselves', async () => {
  const topic = await call('a', 'POST', '/api/social/topics', { title: 'Dudas', text: 'Hola' });
  const board = await call('trainer-x', 'POST', '/api/social/board', { title: 'Aviso', text: 'Cierre' });
  await call('trainer-x', 'POST', '/api/social/board/toggle-comments', { id: board.data.id, commentsEnabled: true });
  assert.equal((await call('c', 'POST', '/api/social/topics/comment', { id: topic.data.id, text: 'hola' })).status, 200);
  assert.equal((await call('c', 'POST', '/api/social/board/comment', { id: board.data.id, text: 'ok' })).status, 200);
  await call('a', 'POST', '/api/friends/block', { userId: 'c' });
  // a does not see c's comments and c can no longer reach a's topic
  const topicsA = (await call('a', 'GET', '/api/social/topics')).data.topics;
  assert.equal(topicsA[0].comments.length, 0);
  assert.equal((await call('c', 'GET', '/api/social/topics')).data.topics.length, 0);
  assert.equal((await call('c', 'POST', '/api/social/topics/comment', { id: topic.data.id, text: 'otra vez' })).status, 404);
  await call('c', 'POST', '/api/friends/block', { userId: 'trainer-x' });
  assert.equal((await call('c', 'GET', '/api/social/board')).data.board.length, 0);
  assert.equal((await call('c', 'POST', '/api/social/board/comment', { id: board.data.id, text: 'x' })).status, 404);
  assert.equal((await call('b', 'GET', '/api/social/board')).data.board[0].comments.length, 1, 'others still see it');
  assert.equal((await call('admin', 'GET', '/api/social/topics')).data.topics[0].comments.length, 1, 'staff see everything');
  await call('a', 'POST', '/api/friends/unblock', { userId: 'c' });
  await call('c', 'POST', '/api/friends/unblock', { userId: 'trainer-x' });
});

test('mark comments: a blocked person can neither write nor be read on the mark', async () => {
  const mark = await call('a', 'POST', '/api/social/wall', { exId: '0001', exName: 'Bench', mode: 'reps', value: { w: 10, r: 8 }, sourceDate: WORKOUT_DAY, public: true });
  assert.equal(mark.status, 200);
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'community', activity: 'community' } });
  assert.equal((await call('c', 'POST', '/api/social/wall/comment', { id: mark.data.id, text: 'Bien!' })).status, 200);
  assert.equal((await call('a', 'GET', '/api/social/wall')).data.wall.find(w => w.id === mark.data.id).comments.length, 1);
  await call('a', 'POST', '/api/friends/block', { userId: 'c' });
  assert.equal((await call('a', 'GET', '/api/social/wall')).data.wall.find(w => w.id === mark.data.id).comments.length, 0, 'the owner no longer reads the blocked comment');
  assert.equal((await call('c', 'POST', '/api/social/wall/comment', { id: mark.data.id, text: 'otra' })).status, 404);
  assert.equal((await call('c', 'GET', '/api/social/wall')).data.wall.some(w => w.id === mark.data.id), false);
  await call('a', 'POST', '/api/friends/unblock', { userId: 'c' });
  await call('a', 'POST', '/api/social/preferences', { privacy: { profile: 'friends', activity: 'friends' } });
});

test('support threads: only the assigned trainer and the admin reach a member\'s thread', async () => {
  const th = await call('a', 'POST', '/api/chat/threads', { text: 'Me duele el hombro' });
  assert.equal(th.status, 200);
  const id = th.data.thread.id;
  const idsOf = async uid => (await call(uid, 'GET', '/api/chat/threads')).data.threads.map(t => t.id);
  assert.ok((await idsOf('trainer-a')).includes(id)); assert.ok((await idsOf('admin')).includes(id)); assert.ok((await idsOf('a')).includes(id));
  assert.equal((await idsOf('trainer-x')).includes(id), false, 'an unassigned trainer does not even list it');
  assert.equal((await call('trainer-x', 'GET', '/api/chat/messages?threadId=' + id)).status, 403);
  assert.equal((await call('trainer-x', 'POST', '/api/chat/messages', { threadId: id, text: 'hola' })).status, 403);
  assert.equal((await call('trainer-x', 'POST', '/api/chat/threads/status', { threadId: id, status: 'closed' })).status, 404);
  assert.equal((await call('c', 'GET', '/api/chat/messages?threadId=' + id)).status, 403);
  assert.equal((await call('trainer-a', 'POST', '/api/chat/messages', { threadId: id, text: 'Descansa' })).status, 200);
  // notifications go to the people who can answer, not to every trainer
  assert.equal((await call('trainer-a', 'GET', '/api/notifications')).data.notifications.some(n => n.target?.id === id), true);
  assert.equal((await call('admin', 'GET', '/api/notifications')).data.notifications.some(n => n.target?.id === id), true);
  assert.equal((await call('trainer-x', 'GET', '/api/notifications')).data.notifications.some(n => n.target?.id === id), false);
  // assignment moves the access
  assert.equal((await call('trainer-a', 'POST', '/api/chat/threads/status', { threadId: id, status: 'closed' })).status, 200);
});

test('the admin switches are enforced by the API, not only hidden in the UI', async () => {
  const off = async (key, on = false) => assert.equal((await call('admin', 'POST', '/api/admin/features', { features: { [key]: on } })).status, 200);
  await S.befriend('b', 'c');
  const thread = (await call('b', 'POST', '/api/chat/direct', { userId: 'c' })).data.thread;
  await off('chat');
  for (const [m, p, body] of [['GET', '/api/chat/threads'], ['POST', '/api/chat/direct', { userId: 'c' }], ['GET', '/api/chat/messages?threadId=' + thread.id], ['POST', '/api/chat/messages', { threadId: thread.id, text: 'x' }]]) {
    const r = await call('b', m, p, body);
    assert.equal(r.status, 403, p); assert.equal(r.data.code, 'feature_off');
  }
  assert.equal((await call('b', 'GET', '/api/friends')).status, 200, 'friends is a different switch');
  await off('chat', true);
  await off('friends');
  assert.equal((await call('b', 'GET', '/api/friends')).status, 403);
  assert.equal((await call('b', 'POST', '/api/friends/request', { username: 'ana' })).status, 403);
  assert.equal((await call('b', 'GET', '/api/social/profile?id=c')).status, 403);
  const share = await call('b', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'w1', audience: 'chat', recipientId: 'c', threadId: thread.id });
  assert.equal(share.status, 403, 'a chat share needs chat and friends');
  await off('friends', true);
  await off('social');
  assert.equal((await call('b', 'GET', '/api/social/wall')).status, 403);
  assert.equal((await call('b', 'GET', '/api/social/shares')).status, 403);
  assert.equal((await call('b', 'POST', '/api/social/topics', { title: 'x', text: 'y' })).status, 403);
  assert.equal((await call('b', 'GET', '/api/social/preferences')).status, 200, 'privacy controls stay reachable');
  assert.equal((await call('b', 'GET', '/api/notifications')).status, 200);
  await off('social', true);
  await off('challenges');
  assert.equal((await call('b', 'GET', '/api/social/challenges')).status, 403);
  assert.equal((await call('b', 'GET', '/api/social/goals')).status, 403);
  assert.equal((await call('b', 'GET', '/api/social/wall')).status, 200);
  await off('challenges', true);
  assert.equal((await call('b', 'GET', '/api/social/challenges')).status, 200);
});
