// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Validates a RESTORED data directory without touching production: node scripts/validate-restore.mjs <restored-data-dir> [--boot]
 *  - db.json parses and holds the users;
 *  - the instance secret is there and every member's state-<uid>.json decrypts with it (through the app's own reader);
 *  - the other JSON stores parse;
 *  - with --boot, a throw-away API process is started on a random port against the directory and /api/health must answer.
 * Prints one JSON line. Exit 0 = restorable, 8 = something is wrong. Never reads from or writes to any directory but the one given
 * (--boot lets that API write inside it, so give it a COPY you are happy to dirty: restore-rehearsal.sh does). */
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const boot = args.includes('--boot');
const dir = path.resolve(args.find(a => !a.startsWith('--')) || '');
const t0 = Date.now();
const out = { ok: false, dir: path.basename(path.dirname(dir)) + '/' + path.basename(dir), users: 0, states: 0, statesUnreadable: [], orphanStates: 0, stores: 0, storesUnreadable: [], secret: false, boot: null, ms: 0 };
const finish = (code, why) => { out.ok = code === 0; if (why) out.reason = why; out.ms = Date.now() - t0; console.log(JSON.stringify(out)); process.exit(code); };

if (!args.find(a => !a.startsWith('--')) || !fs.existsSync(dir)) finish(8, 'directory_missing');
process.env.DATA_DIR = dir;
delete process.env.SECRET_FILE;   // the rehearsal must prove the secret travelled with the archive, not read production's

let db;
try { db = JSON.parse(fs.readFileSync(path.join(dir, 'db.json'), 'utf8')); } catch { finish(8, 'db_unreadable'); }
if (!db || !Array.isArray(db.users)) finish(8, 'db_without_users');
out.users = db.users.length;

const { readSecret } = await import('../api/lib/secret.js');
try { out.secret = readSecret().length >= 32; } catch { out.secret = false; }
if (!out.secret) finish(8, 'secret_missing');

const { readState } = await import('../api/lib/state-store.js');
const ids = new Set(db.users.map(u => u.id));
for (const f of fs.readdirSync(dir)) {
  const m = /^state-(.+)\.json$/.exec(f);
  if (!m) continue;
  if (!ids.has(m[1])) out.orphanStates++;
  try { if (readState(m[1])) out.states++; } catch { out.statesUnreadable.push(m[1]); }
}
for (const f of ['social.json', 'features.json', 'vapid.json']) {
  const p = path.join(dir, f);
  if (!fs.existsSync(p)) continue;
  try { JSON.parse(fs.readFileSync(p, 'utf8')); out.stores++; } catch { out.storesUnreadable.push(f); }
}
if (out.statesUnreadable.length) finish(8, 'state_unreadable');
if (out.storesUnreadable.length) finish(8, 'store_unreadable');

if (boot) {
  // an OS-assigned free port: a random one can land in a range Windows reserves, where listen() fails with EACCES
  const port = await new Promise((resolve, reject) => { const s = net.createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
  const base = `http://127.0.0.1:${port}`;
  const server = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../api/server.js');
  const child = spawn(process.execPath, [server], { cwd: path.dirname(server), env: { ...process.env, PORT: String(port), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'ignore'] });
  let up = null;
  for (let i = 0; i < 600 && up === null; i++) {
    try { const r = await fetch(base + '/api/health'); if (r.ok) up = await r.json(); } catch { /* booting */ }
    if (up === null) await new Promise(r => setTimeout(r, 100));
  }
  child.kill();
  out.boot = up ? { health: true, users: up.users } : { health: false };
  if (!up) finish(8, 'api_did_not_boot');
  if (up.users !== out.users) finish(8, 'boot_user_count_differs');
}
finish(0);
