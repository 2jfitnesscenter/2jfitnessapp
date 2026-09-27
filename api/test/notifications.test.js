import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tempData } from './helpers.mjs';

const dir = tempData();
const store = await import('../notifications/store.js');
const { notificationRoutes } = await import('../notifications/routes.js');
const { canViewProfile, canViewSharedContent } = await import('../notifications/privacy.js');

test('notification inbox is user-scoped, bounded in shape and deep links fail closed', () => {
  store.resetForTests();
  const a = store.create('a', { type: 'message', actor: { id: 'b', name: 'B' }, target: { kind: 'chat', id: 'thread-1' }, deepLink: '/chat/thread-1' });
  assert.ok(a.id);
  assert.equal(a.deepLink, '/chat/thread-1');
  assert.deepEqual(store.list('b'), []);
  const unsafe = store.create('a', { type: 'share', deepLink: '/admin?secret=1' });
  assert.equal(unsafe.deepLink, '/notifications');
  assert.equal(store.unreadCount('a'), 2);
  assert.equal(store.markRead('b', a.id), false, 'another account cannot mark a notification read');
  assert.equal(store.markRead('a', a.id), true);
  assert.equal(store.unreadCount('a'), 1);
  store.markAllRead('a');
  assert.equal(store.unreadCount('a'), 0);
  assert.equal(JSON.parse(fs.readFileSync(`${dir}/notifications.json`, 'utf8')).items.length, 2);
});

test('partial preference writes retain other choices and notification routes authenticate', async () => {
  store.setPreferences('a', { messages: false, push: true });
  assert.equal(store.allows('a', 'message'), false);
  assert.equal(store.preferencesFor('a').push, true);
  assert.equal(store.preferencesFor('a').friendRequests, true);
  store.setPrivacy('a', { profile: 'private' });
  assert.equal(store.privacyFor('a').profile, 'private');
  assert.equal(store.privacyFor('a').activity, 'friends');
  assert.equal(store.privacyFor('a').workouts, false);

  let response;
  const routes = notificationRoutes({ json: (_res, status, body) => { response = { status, body }; }, readBody: async req => req.body, readSession: req => req.user || null });
  await routes['GET /api/notifications']({ user: null }, {});
  assert.equal(response.status, 401);
  await routes['GET /api/notifications']({ user: { id: 'a' } }, {});
  assert.equal(response.status, 200);
  assert.equal(response.body.unread, 0);
});

test('share, challenge and moderation deep links are allowlisted and notification dedupe is idempotent', () => {
  store.resetForTests();
  const share = store.create('b', { type: 'share', target: { kind: 'share', id: 's1' }, deepLink: '/social/share/s1', dedupeKey: 'share-message:m1' });
  assert.equal(share.deepLink, '/social/share/s1');
  assert.equal(store.create('b', { type: 'share', target: { kind: 'share', id: 's1' }, deepLink: '/social/share/s1', dedupeKey: 'share-message:m1' }), null);
  const challenge = store.create('b', { type: 'challenge', deepLink: '/social?tab=challenges&id=c1' });
  assert.equal(challenge.deepLink, '/social?tab=challenges&id=c1');
  const moderation = store.create('a', { type: 'share', deepLink: '/admin/social-reports' });
  assert.equal(moderation.deepLink, '/admin/social-reports');
  const unsafe = store.create('b', { type: 'share', deepLink: '/social/share/../admin' });
  assert.equal(unsafe.deepLink, '/notifications');
  assert.equal(store.unreadCount('b'), 3);
});

test('social visibility respects audience, content category and live blocks', () => {
  const friends = new Set(['owner:friend']);
  const isFriend = (author, viewer) => friends.has(`${author}:${viewer}`);
  const privacy = { profile: 'friends', activity: 'friends', prs: true, routines: true, workouts: false };
  assert.equal(canViewSharedContent({ authorId: 'owner', viewerId: 'owner', kind: 'workout', privacy, isFriend }), true);
  assert.equal(canViewSharedContent({ authorId: 'owner', viewerId: 'friend', kind: 'routine', privacy, isFriend }), true);
  assert.equal(canViewSharedContent({ authorId: 'owner', viewerId: 'outsider', kind: 'routine', privacy, isFriend }), false);
  assert.equal(canViewSharedContent({ authorId: 'owner', viewerId: 'friend', kind: 'workout', privacy, isFriend }), false);
  friends.delete('owner:friend');
  assert.equal(canViewSharedContent({ authorId: 'owner', viewerId: 'friend', kind: 'routine', privacy, isFriend }), false);
  assert.equal(canViewProfile({ profileId: 'owner', viewerId: 'friend', privacy, isFriend }), false);
  assert.equal(canViewProfile({ profileId: 'owner', viewerId: 'outsider', privacy: { profile: 'community' }, isFriend }), true);
});

test('the inbox cap is per account, so a busy member cannot evict another member’s history', () => {
  store.resetForTests();
  store.create('quiet', { type: 'friend_request' });
  for (let i = 0; i < 105; i++) store.create('busy', { type: 'achievement' });
  assert.equal(store.list('busy').length, 100);
  assert.equal(store.list('quiet').length, 1);
});
