// Benchmark for GET /api/admin/users: how many state files the server reads (each is a decrypt), how long the call takes and how big the answer is.
// usage: node scripts/bench-admin-users.mjs <path-to-an-api-directory> [members=100] [workoutsPerMember=150] [polls=10]
// Run it against two checkouts (before / after) to compare. It builds an isolated data directory with encrypted state files and never touches real data.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const apiDir = path.resolve(process.argv[2] || path.join(here, '..'));
const N = Number(process.argv[3] || 100), WORKOUTS = Number(process.argv[4] || 150), POLLS = Number(process.argv[5] || 10);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bench-admin-'));
const SECRET = 'b'.repeat(64);
fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
process.env.DATA_DIR = dir;
const { writeState } = await import(pathToFileURL(path.join(here, '../lib/state-store.js')).href);   // same encryption as every version
const people = [{ id: 'admin', name: 'Admin', username: 'admin', admin: true }, ...Array.from({ length: N }, (_, i) => ({ id: 'm' + i, name: 'Miembro ' + i, username: 'm' + i, created: '2026-01-01T00:00:00Z' }))];
fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: people, creds: [], subs: [], invites: [], recoveries: [] }));
fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ routines: [], programs: [], wall: [], challenges: [], goals: [], topics: [], board: [] }));
for (const p of people) {
  writeState(p.id, { unit: 'kg', _ts: Date.now(), bodyweight: Array.from({ length: 60 }, (_, i) => ({ d: '2026-0' + (1 + i % 9) + '-10', w: 80 + (i % 5) })),
    routines: Array.from({ length: 6 }, (_, r) => ({ id: 'r' + r, name: 'Rutina ' + r, ex: Array.from({ length: 8 }, (_, e) => ({ id: '00' + e, sets: 3, reps: 10 })) })),
    workouts: Array.from({ length: WORKOUTS }, (_, i) => ({ id: 'w' + i, d: '2026-0' + (1 + i % 9) + '-' + String(10 + (i % 15)), entries: Array.from({ length: 6 }, (_, e) => ({ id: '00' + e, sets: Array.from({ length: 4 }, () => ({ w: 60, r: 8, done: true })) })) })) });
}
const stateBytes = fs.readdirSync(dir).filter(f => /^state-/.test(f)).reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
fs.rmSync(path.join(dir, 'user-summaries.json'), { force: true });
const port = 39000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['--import', pathToFileURL(path.join(here, '../test/count-state-reads.mjs')).href, 'server.js'], { cwd: apiDir, env: { ...process.env, PORT: String(port), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'inherit'] });
for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
const p = `admin:${Date.now() + 86400000}:0`, cookie = `gymsid=${p}.${crypto.createHmac('sha256', SECRET).update(p).digest('base64url')}`;
const reads = async () => { await new Promise(r => setTimeout(r, 150)); return Number(fs.readFileSync(path.join(dir, 'reads.count'), 'utf8')); };
const poll = async () => { const t = process.hrtime.bigint(); const r = await fetch(base + '/api/admin/users', { headers: { cookie } }); const body = await r.text(); return { ms: Number(process.hrtime.bigint() - t) / 1e6, bytes: Buffer.byteLength(body), ok: r.status === 200 }; };
const out = [];
let last = await reads();
for (let i = 0; i < POLLS; i++) { const r = await poll(); const now = await reads(); out.push({ ...r, reads: now - last }); last = now; }
child.kill();
const median = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)];
const warm = out.slice(1);
console.log(JSON.stringify({ api: apiDir, members: N, workoutsPerMember: WORKOUTS, stateFilesBytes: stateBytes, polls: POLLS, ok: out.every(o => o.ok),
  firstPoll: { stateFilesRead: out[0].reads, ms: Math.round(out[0].ms * 10) / 10 }, warmPolls: { stateFilesReadEach: warm.map(o => o.reads), medianMs: Math.round(median(warm.map(o => o.ms)) * 10) / 10 }, payloadBytes: out[0].bytes }, null, 1));
fs.rmSync(dir, { recursive: true, force: true });
