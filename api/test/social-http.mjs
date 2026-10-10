import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

/* A real API child with an isolated data directory and a handful of known people, for the Social tests that need the whole stack (ACL, blocks,
 * feature switches, snapshots). Sessions are signed with the directory's own secret, so no login ceremony is involved. */
export const WORKOUT_DAY = '2026-09-27';
export const baseState = () => ({
  unit: 'kg', routines: [], programs: [],
  workouts: [{ id: 'w1', d: WORKOUT_DAY, name: 'Torso', start: 1_000_000, end: 1_000_000 + 52 * 60_000, vol: 4200, prs: ['0001'],
    entries: [{ id: '0001', sets: [{ done: true, w: 10, r: 8 }, { done: true, w: 12, r: 6 }] }, { id: '0007', sets: [{ done: true, min: 20, speed: 9 }] }] }],
  badges: {},
  bodyweight: [{ d: '2026-09-01', w: 81.4 }],
  measurements: [{ d: '2026-09-01', waist: 91 }],
  health: { note: 'private health note', conditions: ['x'] },
  coach: { notes: 'private coach note' },
  privateNotes: 'do not leak',
});

export const PEOPLE = [
  { id: 'a', name: 'Ana', username: 'ana', assignedTrainers: ['trainer-a'] },
  { id: 'b', name: 'Beto', username: 'beto' },
  { id: 'c', name: 'Cris', username: 'cris' },
  { id: 'admin', name: 'Admin', username: 'admin', admin: true },
  { id: 'trainer-a', name: 'Coach A', username: 'coacha', trainer: true },
  { id: 'trainer-x', name: 'Coach X', username: 'coachx', trainer: true },
];

export async function bootSocial({ people = PEOPLE, states = {}, social = {}, tag = 'social' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), tag + '-'));
  const SECRET = 's'.repeat(64);
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users: people, creds: [], subs: [], invites: [], recoveries: [] }));
  for (const p of people) fs.writeFileSync(path.join(dir, `state-${p.id}.json`), JSON.stringify(states[p.id] || baseState()));
  fs.writeFileSync(path.join(dir, 'social.json'), JSON.stringify({ routines: [], programs: [], wall: [], challenges: [], goals: [], topics: [], board: [], ...social }));
  const port = 39000 + Math.floor(Math.random() * 10000), base = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: String(port), DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: base }, stdio: ['ignore', 'ignore', 'inherit'] });
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* not yet */ }
    await new Promise(r => setTimeout(r, 100));
    if (i === 99) throw new Error('isolated API did not become ready');
  }
  const cookie = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
  async function call(uid, method, p, body) {
    const r = await fetch(base + p, { method, headers: { cookie: cookie(uid), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await r.json(); } catch { /* empty */ }
    return { status: r.status, data, headers: r.headers };
  }
  const befriend = async (x, y) => {
    const req = await call(x, 'POST', '/api/friends/request', { username: people.find(p => p.id === y).username });
    const ok = await call(y, 'POST', '/api/friends/accept', { requestId: req.data.request.id });
    if (ok.status !== 200) throw new Error('could not befriend ' + x + ' ' + y);
  };
  const ROUTINE = { name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0001', sets: 3, reps: 10, weight: 20 }] };
  return { dir, base, call, cookie, befriend, ROUTINE, stop: () => child.kill(), read: f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) };
}
