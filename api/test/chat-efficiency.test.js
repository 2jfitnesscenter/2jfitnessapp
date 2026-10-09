import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { bootSocial } from './social-http.mjs';

/* Polling an open conversation must be cheap: no rewrite of the encrypted store while nothing changed, and only the new messages on the wire. */
const S = await bootSocial({ tag: 'chat-efficiency' });
test.after(() => S.stop());
const { call } = S;
await S.befriend('a', 'b');
const thread = (await call('a', 'POST', '/api/chat/direct', { userId: 'b' })).data.thread.id;
const chatFile = path.join(S.dir, 'chat.json');
const stat = () => { const s = fs.statSync(chatFile); return `${s.mtimeMs}:${s.size}`; };
const bytes = async (uid, qs = '') => {
  const r = await fetch(`${S.base}/api/chat/messages?threadId=${thread}${qs}`, { headers: { cookie: S.cookie(uid) } });
  const text = await r.text();
  return { status: r.status, length: Buffer.byteLength(text), data: JSON.parse(text) };
};

test('reading a conversation persists the read state once, and polling again writes nothing', async () => {
  // the burst limit is 20 per 30 s per person, so the history is written by both sides
  const filler = ' con algo de texto para que la conversación pese lo que pesa una real'.repeat(2);
  for (let i = 0; i < 12; i++) { await call('a', 'POST', '/api/chat/messages', { threadId: thread, text: `a ${i}${filler}` }); await call('b', 'POST', '/api/chat/messages', { threadId: thread, text: `b ${i}${filler}` }); }
  await call('a', 'POST', '/api/chat/messages', { threadId: thread, text: 'último de a' });
  assert.equal((await call('b', 'GET', '/api/chat/threads')).data.threads[0].unread, true);
  await bytes('b');
  const afterFirstRead = stat();
  assert.equal((await call('b', 'GET', '/api/chat/threads')).data.threads[0].unread, false, 'reading marks it read');
  for (let i = 0; i < 12; i++) await bytes('b');
  assert.equal(stat(), afterFirstRead, 'twelve more polls did not rewrite chat.json');
  // a new message makes it unread again, and only then is read state written
  await call('a', 'POST', '/api/chat/messages', { threadId: thread, text: 'uno nuevo' });
  const afterSend = stat();
  assert.equal((await call('b', 'GET', '/api/chat/threads')).data.threads[0].unread, true);
  await bytes('b'); assert.notEqual(stat(), afterSend);
  const settled = stat();
  await bytes('b'); await bytes('b');
  assert.equal(stat(), settled);
});

test('a cursor returns only what is new, and is far smaller than the whole thread', async () => {
  const full = await bytes('b');
  assert.equal(full.data.full, true); assert.equal(full.data.messages.length, 26);
  const lastId = full.data.messages.at(-1).id;
  const idle = await bytes('b', `&after=${lastId}&rev=${full.data.rev}`);
  assert.equal(idle.data.full, false); assert.equal(idle.data.messages.length, 0);
  await call('a', 'POST', '/api/chat/messages', { threadId: thread, text: 'otro más' });
  const next = await bytes('b', `&after=${lastId}&rev=${full.data.rev}`);
  assert.deepEqual(next.data.messages.map(m => m.text), ['otro más']);
  assert.ok(idle.length < full.length / 8, `idle poll ${idle.length} B vs full ${full.length} B`);
  assert.ok(next.length < full.length / 4, `one new message ${next.length} B vs full ${full.length} B`);
  console.log(`chat poll bytes: full=${full.length} idle=${idle.length} one-new=${next.length}`);
  // the thread preview and the unread flag still come with every poll
  assert.equal(idle.data.thread.unread, false);
});

test('an unknown cursor or an old revision gets the whole thread; a stranger still gets nothing', async () => {
  assert.equal((await bytes('b', '&after=does-not-exist&rev=0')).data.full, true);
  const all = (await bytes('b')).data;
  assert.equal((await bytes('b', `&after=${all.messages.at(-1).id}&rev=${all.rev + 1}`)).data.full, true, 'a changed revision reloads');
  assert.equal((await bytes('c', `&after=${all.messages.at(-1).id}`)).status, 403);
  await call('b', 'POST', '/api/friends/block', { userId: 'a' });
  assert.equal((await bytes('a')).status, 403, 'a block closes the conversation');
  await call('b', 'POST', '/api/friends/unblock', { userId: 'a' });
});
