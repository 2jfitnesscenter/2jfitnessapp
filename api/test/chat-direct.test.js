import test from 'node:test';
import assert from 'node:assert/strict';
import { tempData } from './helpers.mjs';

tempData();
const { chatRoutes } = await import('../chat/routes.js');
const users = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C', trainer: true }];
const friends = new Set(['a:b', 'b:a']);
const notices = [];
const pushes = [];
let result;
const routes = chatRoutes({
  json: (_res, status, body) => { result = { status, body }; }, readBody: async req => req.body,
  readSession: req => req.user || null, sendPush: (id, body) => pushes.push({ id, body }),
  isTrainer: user => !!user.trainer, users: () => users, isFriend: (a, b) => friends.has(`${a}:${b}`),
  notify: (id, body) => notices.push({ id, body })
});

test('direct chat requires a friendship and isolates messages to both accepted participants', async () => {
  await routes['POST /api/chat/direct']({ user: users[0], body: { userId: 'c' } }, {});
  assert.equal(result.status, 403);
  await routes['POST /api/chat/direct']({ user: users[0], body: { userId: 'b' } }, {});
  assert.equal(result.status, 200);
  const id = result.body.thread.id;
  await routes['POST /api/chat/messages']({ user: users[0], body: { threadId: id, text: 'hello' } }, {});
  assert.equal(result.status, 200);
  assert.equal(notices.at(-1).id, 'b');
  assert.equal(pushes.at(-1).id, 'b');
  await routes['GET /api/chat/messages']({ user: users[2], url: `http://x/api/chat/messages?threadId=${id}` }, {});
  assert.equal(result.status, 403, 'trainer privilege does not grant access to a direct conversation');
  await routes['POST /api/chat/messages']({ user: users[2], body: { threadId: id, text: 'intrude' } }, {});
  assert.equal(result.status, 403);
  friends.delete('a:b'); friends.delete('b:a');
  await routes['GET /api/chat/messages']({ user: users[1], url: `http://x/api/chat/messages?threadId=${id}` }, {});
  assert.equal(result.status, 403, 'ending friendship revokes further access to the direct thread');
});
