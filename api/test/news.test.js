// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Home news / notices over HTTP, on a real spawned server (same harness as studio-admin.test.js):
 * members read the visible ones and cannot write, trainers cannot administer, admins can; active/inactive,
 * publish/expire windows, order, validation and persistence in news.json (never in a member's state). */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'news-'));
const SECRET = 'e'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
  users: [{ id: 'm1', name: 'Member' }, { id: 't1', name: 'Trainer', trainer: true }, { id: 'ad', name: 'Admin', admin: true }],
  creds: [], subs: [], invites: [], recoveries: [],
}, null, 2));
const PORT = 34610, base = `http://localhost:${PORT}`;
const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(PORT), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* booting */ } await new Promise(r => setTimeout(r, 100)); }
const cookieFor = uid => { const p = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`; };
async function req(method, p, uid, body) {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(uid ? { cookie: cookieFor(uid) } : {}) }, body: body && JSON.stringify(body) });
  let j = null; try { j = await r.json(); } catch { /* none */ }
  return { status: r.status, body: j };
}
test.after(() => { child.kill(); });

const HOUR = 3600e3;
const make = (over = {}) => ({ title: 'Cerrado el lunes', body: 'El gimnasio **no abre** el lunes.\nMás info: [aquí](https://2jfitnesscenter.com)', accentColor: '#ff8800', active: true, ...over });
const save = (body, uid = 'ad') => req('POST', '/api/admin/news/save', uid, body);
const titles = r => r.body.news.map(n => n.title);
let a, b, c;

test('anonymous callers are refused; a member reads an empty list at first', async () => {
  assert.equal((await req('GET', '/api/news')).status, 401);
  const r = await req('GET', '/api/news', 'm1');
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.news, []);
  assert.equal(fs.existsSync(path.join(dir, 'news.json')), false, 'nothing is written by reading');
});

test('members and trainers cannot write or read the admin list; admins can', async () => {
  const writes = [
    ['POST', '/api/admin/news/save', make()],
    ['POST', '/api/admin/news/active', { id: 'n_x', active: true }],
    ['POST', '/api/admin/news/reorder', { ids: [] }],
    ['POST', '/api/admin/news/delete', { id: 'n_x' }],
  ];
  for (const [m, p, body] of writes) {
    assert.equal((await req(m, p, null, body)).status, 401, p + ' anonymous');
    assert.equal((await req(m, p, 'm1', body)).status, 403, p + ' member');
    assert.equal((await req(m, p, 't1', body)).status, 403, p + ' trainer');
  }
  assert.equal((await req('GET', '/api/admin/news', 'm1')).status, 403);
  assert.equal((await req('GET', '/api/admin/news', 't1')).status, 403);
  const r = await req('GET', '/api/admin/news', 'ad');
  assert.equal(r.status, 200); assert.deepEqual(r.body.news, []);
  assert.equal(fs.existsSync(path.join(dir, 'news.json')), false, 'refused writes leave no file');
});

test('admin creates news; a member sees only active ones, in order', async () => {
  a = (await save(make({ title: 'A' }))).body.item;
  b = (await save(make({ title: 'B', active: false }))).body.item;
  c = (await save(make({ title: 'C' }))).body.item;
  assert.deepEqual([a.order, b.order, c.order], [1, 2, 3]);
  assert.match(a.id, /^n_[0-9a-f]{16}$/);
  assert.ok(a.createdAt && a.updatedAt);
  assert.deepEqual(titles(await req('GET', '/api/news', 'm1')), ['A', 'C']);
  assert.deepEqual(titles(await req('GET', '/api/admin/news', 'ad')), ['A', 'B', 'C']);
  assert.ok(fs.existsSync(path.join(dir, 'news.json')));
});

test('the active switch hides and shows a notice for members', async () => {
  assert.equal((await req('POST', '/api/admin/news/active', 'ad', { id: a.id, active: false })).status, 200);
  assert.deepEqual(titles(await req('GET', '/api/news', 'm1')), ['C']);
  assert.equal((await req('POST', '/api/admin/news/active', 'ad', { id: b.id, active: true })).body.item.active, true);
  assert.deepEqual(titles(await req('GET', '/api/news', 'm1')), ['B', 'C']);
  assert.equal((await req('POST', '/api/admin/news/active', 'ad', { id: 'n_nope', active: true })).status, 404);
  await req('POST', '/api/admin/news/active', 'ad', { id: a.id, active: true });
});

test('publish and expiry windows are respected', async () => {
  const now = Date.now();
  const future = (await save(make({ title: 'Futura', publishAt: now + HOUR }))).body.item;
  const expired = (await save(make({ title: 'Caducada', expiresAt: now - HOUR }))).body.item;
  const window_ = (await save(make({ title: 'Vigente', publishAt: now - HOUR, expiresAt: now + HOUR }))).body.item;
  const seen = titles(await req('GET', '/api/news', 'm1'));
  assert.ok(seen.includes('Vigente'));
  assert.ok(!seen.includes('Futura') && !seen.includes('Caducada'));
  const admin = titles(await req('GET', '/api/admin/news', 'ad'));
  assert.ok(admin.includes('Futura') && admin.includes('Caducada'), 'the admin still sees them');
  // moving the windows changes visibility
  await save({ id: future.id, publishAt: now - 1000 });
  await save({ id: expired.id, expiresAt: now + HOUR });
  const after = titles(await req('GET', '/api/news', 'm1'));
  assert.ok(after.includes('Futura') && after.includes('Caducada'));
  for (const n of [future, expired, window_]) await req('POST', '/api/admin/news/delete', 'ad', { id: n.id });
});

test('reorder changes the order members see and must list every notice once', async () => {
  assert.equal((await req('POST', '/api/admin/news/reorder', 'ad', { ids: [c.id, b.id, a.id] })).status, 200);
  assert.deepEqual(titles(await req('GET', '/api/news', 'm1')), ['C', 'B', 'A']);
  assert.deepEqual(titles(await req('GET', '/api/admin/news', 'ad')), ['C', 'B', 'A']);
  for (const ids of [[a.id], [a.id, a.id, b.id], [a.id, b.id, 'n_nope'], 'x', null]) {
    assert.equal((await req('POST', '/api/admin/news/reorder', 'ad', { ids })).status, 400, JSON.stringify(ids));
  }
  assert.deepEqual(titles(await req('GET', '/api/admin/news', 'ad')), ['C', 'B', 'A'], 'a refused reorder changes nothing');
});

test('validation: title, content, accent colour, dates, image id', async () => {
  const bad = [
    make({ title: '   ' }), make({ body: '', image: undefined }), make({ accentColor: 'red' }), make({ accentColor: '#fff' }),
    make({ publishAt: 'not-a-date' }), make({ publishAt: Date.now() + 2 * HOUR, expiresAt: Date.now() + HOUR }),
  ];
  for (const body of bad) assert.equal((await save(body)).status, 400, JSON.stringify(body));
  assert.equal((await save({ id: 'n_nope', title: 'x' })).status, 404);
  assert.equal((await save(make({ imageData: 'data:text/html;base64,AAAA' }))).status, 400, 'only real images are accepted');
  const long = (await save(make({ title: 'T'.repeat(500), body: 'x'.repeat(5000) }))).body.item;
  assert.equal(long.title.length, 120); assert.equal(long.body.length, 2000);
  await req('POST', '/api/admin/news/delete', 'ad', { id: long.id });
});

test('text is stored as plain text: markup is kept verbatim for the client to render safely', async () => {
  const n = (await save(make({ title: '<b>x</b>', body: '<script>alert(1)</script> **ok** [x](javascript:alert(1))\u0000' }))).body.item;
  assert.equal(n.title, '<b>x</b>');
  assert.ok(n.body.includes('<script>') && !n.body.includes('\u0000'), 'no control characters; the renderer never builds HTML');
  await req('POST', '/api/admin/news/delete', 'ad', { id: n.id });
});

test('image upload, replacement and removal; the file is served to signed-in members', async () => {
  const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';
  const n = (await save(make({ title: 'Con foto', imageData: tiny }))).body.item;
  assert.match(n.image, /^[a-zA-Z0-9_-]+\.jpg$/);
  const file = path.join(dir, 'uploads', n.image);
  assert.ok(fs.existsSync(file));
  const img = await fetch(`${base}/api/social/media?id=${n.image}`, { headers: { cookie: cookieFor('m1') } });
  assert.equal(img.status, 200);
  const keep = (await save({ id: n.id, title: 'Con foto 2' })).body.item;
  assert.equal(keep.image, n.image, 'omitting imageData keeps the image');
  const swapped = (await save({ id: n.id, imageData: tiny })).body.item;
  assert.notEqual(swapped.image, n.image); assert.equal(fs.existsSync(file), false, 'the replaced file is deleted');
  const removed = (await save({ id: n.id, imageData: null })).body.item;
  assert.equal(removed.image, null); assert.equal(fs.existsSync(path.join(dir, 'uploads', swapped.image)), false);
  const m = (await save({ id: n.id, imageData: tiny })).body.item;
  await req('POST', '/api/admin/news/delete', 'ad', { id: n.id });
  assert.equal(fs.existsSync(path.join(dir, 'uploads', m.image)), false, 'deleting the notice deletes its image');
});

test('delete removes a notice for everyone; news live in news.json only', async () => {
  assert.equal((await req('POST', '/api/admin/news/delete', 'ad', { id: b.id })).status, 200);
  assert.equal((await req('POST', '/api/admin/news/delete', 'ad', { id: b.id })).status, 404);
  assert.deepEqual(titles(await req('GET', '/api/news', 'm1')), ['C', 'A']);
  const stored = JSON.parse(fs.readFileSync(path.join(dir, 'news.json'), 'utf8'));
  assert.deepEqual(stored.items.map(n => n.title).sort(), ['A', 'C']);
  assert.ok(!fs.readdirSync(dir).some(f => /^state-/.test(f)), 'no member state was touched (Sync V2 is separate)');
});
