import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'person-id-'));
const SECRET = 'b'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
const initialDb = {
  users: [
    { id: 'training-uid-linked', name: 'Linked member', username: 'linked', personId: 'global-person-123' },
    { id: 'training-uid-existing', name: 'Existing member', username: 'existing' }
  ],
  creds: [], subs: [], invites: [], recoveries: []
};
const dbPath = path.join(dir, 'db.json');
fs.writeFileSync(dbPath, JSON.stringify(initialDb, null, 2));
const PORT = 39187;
const base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], {
  cwd: path.resolve('.'),
  env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base },
  stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true
});
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* waiting for child startup */ }
  await new Promise(resolve => setTimeout(resolve, 100));
}

function cookieFor(uid) {
  const payload = `${uid}:${Date.now() + 86400000}:0`;
  return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
}
async function me(uid) {
  const response = await fetch(base + '/api/me', { headers: { cookie: cookieFor(uid) } });
  return { status: response.status, body: await response.json() };
}

test('personId stays optional metadata and never replaces the stable Training uid for authentication', async () => {
  const linked = await me('training-uid-linked');
  assert.equal(linked.status, 200);
  assert.equal(linked.body.user.id, 'training-uid-linked');
  assert.equal('personId' in linked.body.user, false);

  const existing = await me('training-uid-existing');
  assert.equal(existing.status, 200);
  assert.equal(existing.body.user.id, 'training-uid-existing');
  assert.equal('personId' in existing.body.user, false);

  assert.equal((await me('global-person-123')).status, 401, 'a Platform personId alone is not a Training login');
  const stored = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
  assert.equal(stored.users[0].personId, 'global-person-123');
  assert.equal('personId' in stored.users[1], false, 'existing accounts are not assigned a personId automatically');
});

test.after(() => {
  child.kill();
  fs.rmSync(dir, { recursive: true, force: true });
});
