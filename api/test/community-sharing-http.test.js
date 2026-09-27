import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

// Full HTTP integration against an isolated real API child, with A/B/admin/trainer identities.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'community-sharing-'));
const SECRET = 'c'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: [
  { id: 'member-a', name: 'Member A', username: 'membera' }, { id: 'member-b', name: 'Member B', username: 'memberb' },
  { id: 'admin', name: 'Admin', username: 'admin', admin: true }, { id: 'trainer', name: 'Trainer', username: 'trainer', trainer: true }
], creds: [], subs: [], invites: [], recoveries: [] }));
const port = 39000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const state = { workouts: [{ id: 'workout-a', d: '2026-09-27', name: 'Session', entries: [{ id: '0001', sets: [{ done: true, w: 10, r: 8 }, { done: true, w: 12, r: 6 }] }] }], badges: { badge_1: { unlockedAt: '2026-09-27T12:00:00Z' } } };
for (const uid of ['member-a', 'member-b', 'admin', 'trainer']) fs.writeFileSync(path.join(dir, `state-${uid}.json`), JSON.stringify(uid === 'member-a' ? state : { workouts: [], badges: {} }));
fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ routines: [], programs: [], wall: [], challenges: [], goals: [], topics: [], board: [] }));
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'inherit'] });
async function wait() { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('isolated API did not become ready'); }
await wait();
const cookie = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
async function call(uid, method, p, body) {
  const r = await fetch(base + p, { method, headers: { cookie: cookie(uid), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data };
}
test('isolated real API: friendship, privacy-filtered community share, chat card, notifications, block and moderation', async t => {
  t.after(() => child.kill());
  const req = await call('member-a', 'POST', '/api/friends/request', { username: 'memberb' });
  assert.equal(req.status, 200);
  assert.equal((await call('member-b', 'POST', '/api/friends/accept', { requestId: req.data.request.id })).status, 200);
  await call('member-a', 'POST', '/api/social/preferences', { privacy: { workouts: true, profile: 'friends', activity: 'friends' } });
  const profile = await call('member-b', 'GET', '/api/social/profile?id=member-a');
  assert.deepEqual(Object.keys(profile.data.profile).sort(), ['avatar', 'id', 'isFriend', 'name']);
  assert.equal(JSON.stringify(profile.data).includes('bodyweight'), false, 'social profile never exposes health fields');
  const shared = await call('member-a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'workout-a', audience: 'community' });
  assert.equal(shared.status, 200); assert.equal(shared.data.share.card.metric, '2 sets · 1 exercises');
  assert.deepEqual(Object.keys(shared.data.share.card).sort(), ['date', 'metric', 'title'], 'workout card is a minimal allowlist');
  assert.equal((await call('member-b', 'GET', '/api/social/shares')).data.shares.length, 1);
  await call('member-a', 'POST', '/api/social/preferences', { privacy: { workouts: false } });
  assert.equal((await call('member-b', 'GET', '/api/social/shares')).data.shares.length, 0, 'privacy changes revoke later feed access');
  assert.equal((await call('member-b', 'POST', '/api/social/reports', { targetType: 'share', targetId: shared.data.share.id, reason: 'privacy' })).status, 404, 'a hidden share cannot be reported through an ID guess');
  assert.equal((await call('member-a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'workout-a', audience: 'community' })).status, 403);
  await call('member-a', 'POST', '/api/social/preferences', { privacy: { workouts: true } });
  await call('member-a', 'POST', '/api/social/preferences', { privacy: { profile: 'private' } });
  assert.equal((await call('member-b', 'GET', '/api/social/profile?id=member-a')).status, 403);
  await call('member-a', 'POST', '/api/social/preferences', { privacy: { profile: 'friends' } });
  const thread = await call('member-a', 'POST', '/api/chat/direct', { userId: 'member-b' });
  const shareBody = { kind: 'workout', targetId: 'workout-a', audience: 'chat', recipientId: 'member-b', threadId: thread.data.thread.id, idempotencyKey: 'same-request-0001' };
  const sent = await call('member-a', 'POST', '/api/social/shares', shareBody);
  assert.equal(sent.status, 200); assert.equal(sent.data.message.type, 'share');
  const retried = await call('member-a', 'POST', '/api/social/shares', shareBody);
  assert.equal(retried.data.message.id, sent.data.message.id, 'a retried share request reuses its original message');
  assert.equal((await call('member-b', 'GET', '/api/chat/threads')).data.threads[0].unread, true);
  const msgs = await call('member-b', 'GET', `/api/chat/messages?threadId=${thread.data.thread.id}`);
  assert.equal(msgs.data.messages[0].share.card.title, 'Session');
  const inbox = await call('member-b', 'GET', '/api/notifications');
  assert.equal(inbox.data.notifications.filter(n => n.type === 'share').length, 1);
  assert.equal(msgs.data.messages.length, 1);
  await call('member-a', 'POST', '/api/social/preferences', { privacy: { workouts: false } });
  assert.equal((await call('member-b', 'GET', `/api/social/shares/item?id=${sent.data.message.share.id}`)).status, 404, 'a direct share detail rechecks current privacy');
  assert.equal((await call('member-b', 'GET', `/api/chat/messages?threadId=${thread.data.thread.id}`)).data.messages[0].share, null, 'a sent chat reference degrades after privacy is revoked');
  await call('member-a', 'POST', '/api/social/preferences', { privacy: { workouts: true } });
  assert.equal((await call('member-b', 'GET', `/api/social/shares/item?id=${sent.data.message.share.id}`)).status, 200, 'restoring privacy makes the allowed share available again');
  const report = await call('member-b', 'POST', '/api/social/reports', { targetType: 'share', targetId: shared.data.share.id, reason: 'privacy' });
  assert.equal(report.status, 200);
  assert.equal((await call('member-b', 'POST', '/api/social/reports', { targetType: 'share', targetId: shared.data.share.id, reason: 'privacy' })).status, 409);
  const chatReport = await call('member-b', 'POST', '/api/social/reports', { targetType: 'share', targetId: sent.data.message.share.id, reason: 'inappropriate' });
  assert.equal(chatReport.status, 200);
  assert.equal((await call('trainer', 'GET', '/api/admin/social-reports')).status, 403);
  assert.equal((await call('member-a', 'GET', '/api/admin/social-reports')).status, 403);
  const reports = await call('admin', 'GET', '/api/admin/social-reports');
  assert.equal(reports.status, 200); assert.equal(reports.data.reports.length, 2);
  assert.equal((await call('admin', 'POST', '/api/admin/social-reports/resolve', { id: report.data.id, action: 'remove' })).status, 200);
  assert.equal((await call('admin', 'POST', '/api/admin/social-reports/resolve', { id: chatReport.data.id, action: 'remove' })).status, 200);
  assert.equal((await call('member-a', 'GET', '/api/social/shares')).data.shares.length, 0);
  assert.equal((await call('member-b', 'GET', `/api/chat/messages?threadId=${thread.data.thread.id}`)).data.messages[0].share, null, 'deleted reference degrades to a safe unavailable card');
  const challenge = await call('trainer', 'POST', '/api/social/challenges/new', { name: 'Test challenge', type: 'frequency', startDate: '2026-09-01', endDate: '2026-10-01', targetWorkouts: 3 });
  assert.equal(challenge.status, 200);
  await call('member-b', 'POST', '/api/social/challenges/join', { id: challenge.data.id });
  await call('member-b', 'POST', '/api/social/challenges/join', { id: challenge.data.id });
  const trainerNotices = await call('trainer', 'GET', '/api/notifications');
  assert.equal(trainerNotices.data.notifications.filter(n => n.type === 'challenge').length, 1);
  await call('member-b', 'POST', '/api/friends/block', { userId: 'member-a' });
  assert.equal((await call('member-a', 'POST', '/api/chat/direct', { userId: 'member-b' })).status, 403);
  assert.equal((await call('member-a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'workout-a', audience: 'chat', recipientId: 'member-b', threadId: thread.data.thread.id })).status, 403);
  assert.equal((await call('member-a', 'POST', '/api/social/shares', { kind: 'workout', targetId: 'private-missing', audience: 'community' })).status, 404);
  assert.equal((await call('member-b', 'POST', '/api/friends/unblock', { userId: 'member-a' })).status, 200, 'the isolated API accepts an explicit unblock');
  assert.equal((await call('member-a', 'POST', '/api/chat/direct', { userId: 'member-b' })).status, 403, 'unblocking alone does not recreate a friendship');
  const reRequest = await call('member-a', 'POST', '/api/friends/request', { username: 'memberb' });
  assert.equal((await call('member-b', 'POST', '/api/friends/accept', { requestId: reRequest.data.request.id })).status, 200);
  assert.equal((await call('member-a', 'POST', '/api/chat/direct', { userId: 'member-b' })).status, 200, 'direct chat becomes available after a new accepted request');
});
