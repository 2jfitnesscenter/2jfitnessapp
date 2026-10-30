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
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve('.'), env: { ...process.env, PORT: '0', DATA_DIR: dir, RP_ID: 'localhost', ORIGIN: 'http://localhost' }, stdio: ['ignore', 'pipe', 'inherit'] });
  let startupOutput = '';
  let startupTimer;
  let port;
  try {
    port = await new Promise((resolve, reject) => {
      child.stdout.setEncoding('utf8');
      const onData = chunk => {
        startupOutput += chunk;
        const match = startupOutput.match(/gym-api on :(\d+)/);
        if (match) {
          child.stdout.off('data', onData);
          child.stdout.resume();
          resolve(Number(match[1]));
        }
      };
      child.stdout.on('data', onData);
      child.once('error', reject);
      child.once('exit', (code, signal) => reject(new Error(`isolated API exited before listening (code=${code}, signal=${signal}): ${startupOutput.trim()}`)));
      startupTimer = setTimeout(() => reject(new Error(`isolated API did not report its bound port: ${startupOutput.trim()}`)), 10_000);
    });
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    clearTimeout(startupTimer);
  }
  const base = `http://localhost:${port}`;
  try {
    const health = await fetch(base + '/api/health');
    if (!health.ok) throw new Error(`isolated API health failed with ${health.status}`);
  } catch (error) {
    child.kill();
    throw error;
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
