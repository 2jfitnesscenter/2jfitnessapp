import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const friends = await import('../friends/store.js');
const { friendsRoutes } = await import('../friends/routes.js');
const users = [
  { id: 'a', name: 'A', avatar: 'avatar-a', health: { weight: 99 }, admin: true },
  { id: 'b', name: 'B', privateNotes: 'do not expose' },
  { id: 'c', name: 'C' }
];
let result;
const routes = friendsRoutes({ json: (_res, status, body) => { result = { status, body }; }, readBody: async req => req.body, readSession: req => req.user || null, users: () => users });

test('social profile defaults to friends, exposes an allow-list, and blocking revokes friendship', async () => {
  await routes['GET /api/social/profile']({ user: users[0], url: 'http://x/api/social/profile?id=b' }, {});
  assert.equal(result.status, 403, 'non-friend cannot view the default friends-only profile');
  const request = friends.createRequest('a', 'b'); friends.respond(request.id, 'accepted');
  await routes['GET /api/social/profile']({ user: users[0], url: 'http://x/api/social/profile?id=b' }, {});
  assert.equal(result.status, 200);
  assert.deepEqual(Object.keys(result.body.profile).sort(), ['avatar', 'id', 'isFriend', 'name']);
  assert.equal(JSON.stringify(result.body).includes('health'), false);
  assert.equal(JSON.stringify(result.body).includes('privateNotes'), false);
  await routes['POST /api/friends/block']({ user: users[0], body: { userId: 'b' } }, {});
  assert.equal(result.status, 200);
  assert.deepEqual(friends.friendIdsOf('a'), []);
  await routes['GET /api/social/profile']({ user: users[0], url: 'http://x/api/social/profile?id=b' }, {});
  assert.equal(result.status, 404, 'blocked profiles fail closed');
});
