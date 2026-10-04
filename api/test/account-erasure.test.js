import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Account export + erasure against a real API process. The passkey step is real: the test holds an EC key, the server holds its COSE public key,
   and the request carries a genuine WebAuthn assertion over the server's challenge. */
const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2j-erasure-'));
const SECRET = 'd'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.mkdirSync(path.join(dir, 'uploads'));
const port = 39000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const b64u = b => Buffer.from(b).toString('base64url');

const keyOf = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const x = Buffer.from(jwk.x, 'base64url'), y = Buffer.from(jwk.y, 'base64url');
  const cose = Buffer.concat([Buffer.from('a50102032620012158' + '20', 'hex'), x, Buffer.from('225820', 'hex'), y]);   // CBOR map: kty EC2, alg -7, crv P-256, x, y
  return { privateKey, cose: b64u(cose) };
};
const keyA = keyOf(), keyB = keyOf();
const assertion = (key, credId, challenge, counter = 5) => {
  const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
  const authData = Buffer.concat([rpIdHash, Buffer.from([0x01]), Buffer.from([0, 0, 0, counter])]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin: base, crossOrigin: false }));
  const signature = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), key.privateKey);
  return { id: credId, rawId: credId, type: 'public-key', response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(signature) }, clientExtensionResults: {} };
};

const write = (f, v) => fs.writeFileSync(path.join(dir, f), typeof v === 'string' ? v : JSON.stringify(v));
write('db.json', {
  users: [
    { id: 'member-a', name: 'Member A', username: 'membera', avatar: 'avatar-a.jpg', stravaAuth: { data: 'CANARY-TOKEN' }, created: '2026-01-01T00:00:00Z' },
    { id: 'member-b', name: 'Member B', username: 'memberb' },
    { id: 'trainer', name: 'Trainer', username: 'trainer', trainer: true },
  ],
  creds: [
    { id: 'cred-a', userId: 'member-a', publicKey: keyA.cose, counter: 1, transports: ['internal'] },
    { id: 'cred-b', userId: 'member-b', publicKey: keyB.cose, counter: 1, transports: ['internal'] },
    { id: 'cred-t', userId: 'trainer', publicKey: keyB.cose, counter: 1 },
  ],
  subs: [{ userId: 'member-a', endpoint: 'https://push.example/CANARY-A', keys: {} }, { userId: 'member-b', endpoint: 'https://push.example/b', keys: {} }],
  invites: [{ code: 'INV-USED', usedBy: 'member-a' }], recoveries: [{ token: 'tok', userId: 'member-a' }],
  recoveryRequests: [{ id: 'rr', name: 'Member A', matchedUserId: 'member-a' }],
  machineAliases: [{ key: 'k', exId: '0001', name: 'Leg press' }],
});
for (const f of ['avatar-a.jpg', 'state-img-a.jpg', 'post-img-a.jpg', 'b-img.jpg']) fs.writeFileSync(path.join(dir, 'uploads', f), 'img');
write('state-member-a.json', { workouts: [{ id: 'w1', d: '2026-09-01', name: 'CANARY-WORKOUT', note: 'CANARY-NOTE', entries: [] }], bodyweight: [{ d: '2026-09-01', w: 81.5 }], routines: [{ id: 'r1', name: 'R', image: 'state-img-a.jpg' }], fitness: [{ hr: 'CANARY-HEALTH' }] });
write('state-member-b.json', { workouts: [{ id: 'wb', d: '2026-09-02', name: 'B-WORKOUT', entries: [] }] });
write('chat.json', {
  threads: [
    { id: 't1', memberId: 'member-a', status: 'open', createdAt: 1, updatedAt: 1, readBy: {} },
    { id: 't2', kind: 'direct', memberId: 'member-b', recipientId: 'member-a', status: 'open', createdAt: 1, updatedAt: 1, readBy: {} },
    { id: 't3', memberId: 'member-b', status: 'open', createdAt: 1, updatedAt: 1, readBy: {} },
  ],
  messages: [
    { id: 'm1', threadId: 't1', authorId: 'member-a', authorRole: 'member', text: 'CANARY-CHAT-A', createdAt: 1 },
    { id: 'm2', threadId: 't1', authorId: 'trainer', authorRole: 'trainer', text: 'reply to a', createdAt: 2 },
    { id: 'm3', threadId: 't2', authorId: 'member-b', authorRole: 'member', text: 'B says hi to A', createdAt: 3 },
    { id: 'm4', threadId: 't3', authorId: 'member-b', authorRole: 'member', text: 'B-KEEPS', createdAt: 4 },
  ],
});
write('friends.json', { codes: [{ userId: 'member-a', code: 'CODEA' }, { userId: 'member-b', code: 'CODEB' }], requests: [{ id: 'q1', fromId: 'member-a', toId: 'member-b', status: 'accepted' }], blocked: [{ ownerId: 'member-b', blockedId: 'member-a' }] });
write('notifications.json', { items: [
  { id: 'n1', userId: 'member-a', type: 'message', actor: { id: 'member-b', name: 'Member B' } },
  { id: 'n2', userId: 'member-b', type: 'friend_accepted', actor: { id: 'member-a', name: 'Member A' } },
  { id: 'n3', userId: 'member-b', type: 'share', actor: { id: 'trainer', name: 'Trainer' } }], privacy: { 'member-a': { profile: 'private' } }, preferences: { 'member-a': { push: true } } });
write('social-sharing.json', { shares: [
  { id: 's1', authorId: 'member-a', kind: 'workout', card: { title: 'CANARY-SHARE' }, createdAt: 1, deletedAt: null },
  { id: 's2', authorId: 'member-b', kind: 'workout', card: { title: 'B-SHARE' }, createdAt: 2, deletedAt: null }], reports: [
  { id: 'rp1', reporterId: 'member-a', targetType: 'share', targetId: 's2', status: 'pending' },
  { id: 'rp2', reporterId: 'member-b', targetType: 'share', targetId: 's1', status: 'pending' }] });
write('bunker.json', { pins: [{ userId: 'member-a', pin: '4821' }, { userId: 'member-b', pin: '9137' }], adminCodes: [], roomKey: null, settings: {} });
write('social.json', {
  routines: [{ id: 'sr', authorId: 'member-a', name: 'CANARY-ROUTINE', image: 'post-img-a.jpg' }], programs: [], topics: [], board: [],
  wall: [{ id: 'p1', authorId: 'member-a', text: 'CANARY-WALL', comments: [], public: true },
    { id: 'p2', authorId: 'member-b', text: 'B post', public: true, comments: [{ id: 'c1', authorId: 'member-a', authorName: 'Member A', text: 'CANARY-COMMENT' }, { id: 'c2', authorId: 'member-b', text: 'B comment' }] }],
  challenges: [{ id: 'ch1', authorId: 'trainer', name: 'Chal', participants: ['member-a', 'member-b'] }], goals: [{ userId: 'member-a', kind: 'weight' }, { userId: 'member-b', kind: 'weight' }],
});

const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'inherit'] });
async function wait() { for (let i = 0; i < 80; i++) { try { if ((await fetch(base + '/api/health')).ok) return; } catch {} await new Promise(r => setTimeout(r, 100)); } throw new Error('isolated API did not start'); }
await wait();
const cookie = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
async function call(uid, method, p, body) {
  const r = await fetch(base + p, { method, headers: { cookie: cookie(uid), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch {}
  return { status: r.status, data, headers: r.headers };
}
const allText = () => {
  const out = [];
  const walk = d => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(p); } };
  walk(dir);
  return out.filter(f => !f.endsWith('secret')).map(f => [path.relative(dir, f), fs.readFileSync(f, 'utf8')]);
};

test('export: everything the member owns, nothing of anyone else, no passkey key material', async t => {
  t.after(() => {});
  const r = await call('member-a', 'GET', '/api/me/export');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="2jfitness-export-membera-/);
  const json = JSON.stringify(r.data);
  for (const mine of ['CANARY-WORKOUT', 'CANARY-NOTE', 'CANARY-HEALTH', 'CANARY-CHAT-A', 'CANARY-SHARE', 'CANARY-WALL', 'CANARY-COMMENT', 'CANARY-ROUTINE', '"4821"', 'CODEA']) assert.ok(json.includes(mine), 'missing from export: ' + mine);
  for (const notMine of ['B-KEEPS', 'B says hi to A', 'B post', 'B-WORKOUT', keyA.cose, 'CANARY-TOKEN']) assert.ok(!json.includes(notMine), 'leaked into export: ' + notMine);
  assert.equal(r.data.account.integrations.strava, true);
  assert.equal((await call('member-b', 'GET', '/api/me/export')).data.account.id, 'member-b', 'each member only gets their own');
  const anon = await fetch(base + '/api/me/export'); assert.equal(anon.status, 401);
});

test('erasure is refused without the right proof: staff, wrong username, missing/foreign passkey, stale challenge', async () => {
  assert.equal((await call('trainer', 'POST', '/api/me/delete/options', {})).status, 403, 'staff cannot self-erase');
  const o = await call('member-a', 'POST', '/api/me/delete/options', {});
  assert.equal(o.status, 200); assert.equal(o.data.confirmWith, 'membera');
  const good = assertion(keyA, 'cred-a', o.data.options.challenge);
  assert.equal((await call('member-a', 'POST', '/api/me/delete', { cid: o.data.cid, credential: good, confirm: 'nope' })).status, 400, 'typed username must match');
  const o2 = await call('member-a', 'POST', '/api/me/delete/options', {});
  assert.equal((await call('member-a', 'POST', '/api/me/delete', { cid: o2.data.cid, credential: assertion(keyB, 'cred-b', o2.data.options.challenge), confirm: 'membera' })).status, 403, "another account's passkey is refused");
  const o3 = await call('member-a', 'POST', '/api/me/delete/options', {});
  assert.equal((await call('member-a', 'POST', '/api/me/delete', { cid: o3.data.cid, credential: assertion(keyB, 'cred-a', o3.data.options.challenge), confirm: 'membera' })).status, 400, 'a signature by the wrong key fails');
  assert.equal((await call('member-a', 'POST', '/api/me/delete', { cid: 'stale', credential: good, confirm: 'membera' })).status, 400);
  assert.equal((await call('member-b', 'POST', '/api/me/delete', { cid: o.data.cid, credential: good, confirm: 'memberb' })).status, 400, "another member cannot use someone else's challenge");
  assert.ok(fs.existsSync(path.join(dir, 'state-member-a.json')), 'nothing was deleted by any refused attempt');
});

test('erasure with a fresh passkey assertion removes the person everywhere and leaves other members intact', async t => {
  t.after(() => child.kill());
  const o = await call('member-a', 'POST', '/api/me/delete/options', {});
  const res = await call('member-a', 'POST', '/api/me/delete', { cid: o.data.cid, credential: assertion(keyA, 'cred-a', o.data.options.challenge, 9), confirm: 'MemberA' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.match(res.headers.get('set-cookie') || '', /gymsid=;/, 'cookie cleared');
  assert.equal(res.data.report.state, true);
  // the session no longer works, replaying the same request cannot erase twice
  assert.equal((await call('member-a', 'GET', '/api/me')).status, 401);
  // nothing identifying the person is left in ANY file (chat is encrypted at rest: decrypt it for the scan)
  process.env.DATA_DIR = dir;
  const { decrypt } = await import('../lib/crypto.js');
  const needles = ['member-a', 'membera', 'Member A', 'CANARY', 'cred-a', 'CODEA', '4821', 'avatar-a', 'state-img-a', 'post-img-a'];
  for (const [file, text] of allText()) {
    const hay = file === 'chat.json' && !text.trim().startsWith('{') ? JSON.stringify(decrypt(text.trim(), 'chat-store')) : text;
    for (const n of needles) assert.ok(!hay.includes(n), `${file} still contains ${n}`);
  }
  assert.deepEqual(fs.readdirSync(path.join(dir, 'uploads')).sort(), ['b-img.jpg'], 'the member’s uploads are gone, others kept');
  // the rest of the community is untouched
  const db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8'));
  assert.deepEqual(db.users.map(u => u.id).sort(), ['member-b', 'trainer']);
  assert.equal(db.invites[0].usedBy, 'deleted-account', 'an invite stays single-use without naming anyone');
  assert.equal(db.machineAliases.length, 1);
  assert.ok(fs.existsSync(path.join(dir, 'state-member-b.json')));
  const threads = await call('member-b', 'GET', '/api/chat/threads');
  assert.deepEqual(threads.data.threads.map(t => t.id), ['t3']);
  const wall = JSON.parse(fs.readFileSync(path.join(dir, 'social.json'), 'utf8'));
  assert.deepEqual(wall.wall.map(p => [p.id, (p.comments || []).map(c => c.id)]), [['p2', ['c2']]]);
  assert.deepEqual(wall.challenges[0].participants, ['member-b']);
});
