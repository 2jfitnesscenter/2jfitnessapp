import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* Role management: an admin can set member / trainer / admin on a user (the existing u.admin / u.trainer flags — one source of truth); trainers and members
 * cannot; the system never ends up without an enabled admin; an admin that comes from ADMIN_UIDS (configuration) cannot be changed from the UI.
 * Each scenario runs its own real server on its own roster. */
const SECRET = 'f'.repeat(64);
const servers = [];
let nextPort = 34650;
async function boot(users, adminUids = '') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roles-'));
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
  const port = nextPort++, base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: adminUids }, stdio: ['ignore', 'ignore', 'ignore'] });
  servers.push(child);
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not up yet */ } await new Promise(r => setTimeout(r, 100)); }
  const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
  const req = async (method, p, { body, uid = 'admin1' } = {}) => {
    const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', cookie: cookieFor(uid) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { /* empty */ }
    return { status: r.status, body: j };
  };
  return {
    dir, req,
    setRole: (id, role, uid = 'admin1') => req('POST', '/api/admin/user/role', { uid, body: { id, role } }),
    me: async uid => (await req('GET', '/api/me', { uid })).body.user,
    enabledAdmins: async uid => (await req('GET', '/api/admin/users', { uid })).body.users.filter(u => u.admin && !u.disabled),
  };
}
const roster = () => [{ id: 'admin1', name: 'Admin One', admin: true }, { id: 'trainer1', name: 'Trainer', trainer: true }, { id: 'member1', name: 'Member One' }, { id: 'member2', name: 'Member Two' }];

test('admin → trainer, trainer → admin, admin → member: the next request already sees the new role', async () => {
  const s = await boot(roster());
  let r = await s.setRole('member1', 'trainer'); assert.equal(r.status, 200); assert.deepEqual([r.body.role, r.body.admin, r.body.trainer], ['trainer', false, true]);
  assert.deepEqual([(await s.me('member1')).admin, (await s.me('member1')).trainer], [false, true]);
  r = await s.setRole('member1', 'admin'); assert.equal(r.status, 200); assert.equal(r.body.role, 'admin');
  assert.deepEqual([(await s.me('member1')).admin, (await s.me('member1')).trainer], [true, true], 'admin implies trainer');
  assert.equal((await s.req('GET', '/api/admin/users', { uid: 'member1' })).status, 200, 'the new admin really has admin access');
  r = await s.setRole('member1', 'member'); assert.equal(r.status, 200); assert.equal(r.body.role, 'member');
  assert.deepEqual([(await s.me('member1')).admin, (await s.me('member1')).trainer], [false, false]);
  assert.equal((await s.req('GET', '/api/admin/users', { uid: 'member1' })).status, 403);
  assert.equal((await s.setRole('member1', 'member')).status, 200, 'same role again is harmless');
  const stored = JSON.parse(fs.readFileSync(path.join(s.dir, 'db.json'), 'utf8')).users.find(u => u.id === 'member1');
  assert.equal('admin' in stored, false); assert.equal('trainer' in stored, false);
  // a trainer can be demoted straight to member, an admin straight to trainer (another admin exists)
  assert.equal((await s.setRole('trainer1', 'member')).status, 200); assert.equal((await s.me('trainer1')).trainer, false);
  assert.equal((await s.setRole('member1', 'admin')).status, 200);
  assert.equal((await s.setRole('member1', 'trainer')).status, 200); assert.deepEqual([(await s.me('member1')).admin, (await s.me('member1')).trainer], [false, true]);
});

test('trainers and members cannot change roles (no escalation, not even their own)', async () => {
  const s = await boot(roster());
  for (const uid of ['trainer1', 'member2']) {
    assert.equal((await s.setRole('member2', 'admin', uid)).status, 403, uid);
    assert.equal((await s.setRole(uid, 'admin', uid)).status, 403, uid + ' self');
    assert.equal((await s.setRole('admin1', 'member', uid)).status, 403, uid + ' demoting an admin');
  }
  assert.equal((await s.me('member2')).admin, false); assert.equal((await s.me('trainer1')).admin, false); assert.equal((await s.me('admin1')).admin, true);
});

test('validation: unknown role, unknown user, missing fields', async () => {
  const s = await boot(roster());
  assert.equal((await s.setRole('member1', 'root')).status, 400);
  assert.equal((await s.setRole('member1', '')).status, 400);
  assert.equal((await s.req('POST', '/api/admin/user/role', { body: { id: 'member1' } })).status, 400);
  assert.equal((await s.setRole('ghost', 'trainer')).status, 404);
});

test('the last enabled admin can neither be demoted nor demote themselves; a disabled admin does not count; never zero admins', async () => {
  const s = await boot([...roster(), { id: 'admin2', name: 'Admin Two', admin: true, disabled: true }]);
  for (const role of ['member', 'trainer']) {
    const r = await s.setRole('admin1', role); assert.equal(r.status, 409, role); assert.equal(r.body.code, 'last_admin');
  }
  assert.equal((await s.me('admin1')).admin, true);
  assert.equal((await s.enabledAdmins('admin1')).length, 1);
  // a second admin makes it possible; then the remaining one is protected again
  assert.equal((await s.setRole('member1', 'admin')).status, 200);
  assert.equal((await s.setRole('admin1', 'trainer')).status, 200);
  const last = await s.setRole('member1', 'member', 'member1');
  assert.equal(last.status, 409); assert.equal(last.body.code, 'last_admin');
  assert.equal((await s.enabledAdmins('member1')).length, 1, 'never zero admins');
});

test('an administrator defined by ADMIN_UIDS (configuration) cannot be demoted from the UI', async () => {
  const s = await boot([...roster(), { id: 'cfg', name: 'Config Admin' }], 'cfg');
  assert.equal((await s.me('cfg')).admin, true);
  assert.equal((await s.setRole('member1', 'admin')).status, 200);        // plenty of other admins
  for (const role of ['member', 'trainer']) {
    const r = await s.setRole('cfg', role); assert.equal(r.status, 409, role); assert.equal(r.body.code, 'admin_by_config');
  }
  assert.equal((await s.me('cfg')).admin, true);
  assert.equal((await s.req('GET', '/api/admin/user?id=cfg')).body.user.adminByConfig, true);
  assert.equal((await s.req('GET', '/api/admin/user?id=member1')).body.user.adminByConfig, false);
});

test.after(() => { for (const c of servers) c.kill(); });
