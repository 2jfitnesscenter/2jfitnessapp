import test from 'node:test';
import assert from 'node:assert/strict';
import { createLimiter, LIMITS } from '../lib/social-limits.js';
import { bootSocial } from './social-http.mjs';

test('the limiter counts a sliding window per key and says when to come back', () => {
  let t = 1_000_000;
  const l = createLimiter({ now: () => t });
  for (let i = 0; i < 3; i++) assert.equal(l.hit('u:x', 3, 10_000).ok, true);
  const blocked = l.hit('u:x', 3, 10_000);
  assert.equal(blocked.ok, false); assert.equal(blocked.retryAfter, 10);
  assert.equal(l.hit('v:x', 3, 10_000).ok, true, 'another person is unaffected');
  assert.equal(l.hit('u:y', 3, 10_000).ok, true, 'another bucket is unaffected');
  t += 10_001;
  assert.equal(l.hit('u:x', 3, 10_000).ok, true, 'the window slides');
});

const people = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(id => ({ id, name: id.toUpperCase(), username: 'user' + id }));
const S = await bootSocial({ people, tag: 'social-limits' });
test.after(() => S.stop());
const { call } = S;
const [FR, LK, MB] = [LIMITS.friendRequest, LIMITS.lookup, LIMITS.messageBurst];

test('friend requests: normal use passes, a flood is stopped, and a refusal puts the same sender on hold for a day', async () => {
  const r1 = await call('a', 'POST', '/api/friends/request', { username: 'userb' });
  assert.equal(r1.status, 200);
  assert.equal((await call('b', 'POST', '/api/friends/decline', { requestId: r1.data.request.id })).status, 200);
  const again = await call('a', 'POST', '/api/friends/request', { username: 'userb' });
  assert.equal(again.status, 429); assert.equal(again.data.code, 'cooldown'); assert.ok(Number(again.headers.get('retry-after')) > 80_000);
  // withdrawing your own request is not a refusal: asking again is fine
  const r2 = await call('a', 'POST', '/api/friends/request', { username: 'userc' });
  assert.equal(r2.status, 200);
  assert.equal((await call('a', 'POST', '/api/friends/cancel', { requestId: r2.data.request.id })).status, 200);
  assert.equal((await call('a', 'POST', '/api/friends/request', { username: 'userc' })).status, 200);
  // a flood of attempts (found or not) stops at the hourly allowance
  let last;
  for (let i = 0; i < FR[1]; i++) last = await call('a', 'POST', '/api/friends/request', { username: 'nobody' + i });
  assert.equal(last.status, 429); assert.equal(last.data.code, 'rate_limited');
  // the other direction was never involved
  assert.equal((await call('b', 'POST', '/api/friends/request', { username: 'usera' })).status, 200);
});

test('username lookups are limited so the list of usernames cannot be walked', async () => {
  let blockedAt = 0;
  for (let i = 1; i <= LK[1] + 2; i++) { const r = await call('d', 'POST', '/api/friends/lookup', { username: 'x' + i }); if (r.status === 429 && !blockedAt) blockedAt = i; }
  assert.equal(blockedAt, LK[1] + 1);
});

test('messages: a conversation never meets the limit, a burst does', async () => {
  await S.befriend('e', 'f');
  const th = (await call('e', 'POST', '/api/chat/direct', { userId: 'f' })).data.thread.id;
  let statuses = [];
  for (let i = 0; i < MB[1] + 3; i++) statuses.push((await call('e', 'POST', '/api/chat/messages', { threadId: th, text: 'hola ' + i })).status);
  assert.equal(statuses.slice(0, MB[1]).every(s => s === 200), true);
  assert.equal(statuses.slice(MB[1]).every(s => s === 429), true);
  assert.equal((await call('f', 'POST', '/api/chat/messages', { threadId: th, text: 'respuesta' })).status, 200, 'the other person is not affected');
});

test('comments, shares and reports have their own allowance', async () => {
  const topic = await call('g', 'POST', '/api/social/topics', { title: 'Hilo', text: 'x' });
  const codes = [];
  for (let i = 0; i < LIMITS.commentBurst[1] + 2; i++) codes.push((await call('h', 'POST', '/api/social/topics/comment', { id: topic.data.id, text: 'c' + i })).status);
  assert.equal(codes.filter(c => c === 200).length, LIMITS.commentBurst[1]); assert.equal(codes.at(-1), 429);
  const shares = [];
  for (let i = 0; i < LIMITS.share[1] + 2; i++) shares.push((await call('h', 'POST', '/api/social/shares', { kind: 'streak', targetId: '1', audience: 'community' })).status);
  assert.equal(shares.at(-1), 429); assert.notEqual(shares[0], 429);
  const reports = [];
  for (let i = 0; i < LIMITS.report[1] + 2; i++) reports.push((await call('h', 'POST', '/api/social/reports', { targetType: 'topic', targetId: 'nope' + i, reason: 'spam' })).status);
  assert.equal(reports.at(-1), 429); assert.notEqual(reports[0], 429);
});
