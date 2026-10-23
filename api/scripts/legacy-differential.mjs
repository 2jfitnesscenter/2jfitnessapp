// Differential ("golden") run for historical users: the SAME request corpus is replayed against two Búnker API trees started on identical data —
// `main` (baseline) and the integration branch — with no Platform configuration at all (legacy mode). Every status, normalized response body and the
// resulting member state on disk must be identical, except for a short, explicit list of intentional differences.
//
// Usage (loopback, temp data only):
//   node scripts/legacy-differential.mjs <baseline-api-dir> <branch-api-dir> [--json out.json]
// Exit code 0 = no unexpected difference.
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const [baselineDir, branchDir] = process.argv.slice(2).filter(arg => !arg.startsWith('--')).map(dir => path.resolve(dir));
if (!baselineDir || !branchDir) { console.error('usage: node scripts/legacy-differential.mjs <baseline-api-dir> <branch-api-dir> [--json out.json]'); process.exit(2); }
const jsonOut = process.argv.includes('--json') ? process.argv[process.argv.indexOf('--json') + 1] : null;
const SECRET = crypto.randomBytes(32).toString('hex');
const cookieFor = uid => { const payload = `${uid}:${Date.now() + 86_400_000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
const freePort = () => new Promise(resolve => { const probe = http.createServer().listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => resolve(port)); }); });

/** Intentional differences, each justified. Anything else is a failure. */
const EXPECTED = new Map([
  ['PUT /api/data array-body', 'arrays are no longer accepted as the whole member state (they destroyed the stored state); now 400'],
  ['POST /api/sync save array-state', 'a non-object state is rejected before it reaches the store; now 400'],
  ['POST /api/sync save scalar-state', 'a non-object state is rejected before it reaches the store; now 400'],
]);

const users = [
  { id: 'u-ana', name: 'Ana', username: 'ana' }, { id: 'u-beto', name: 'Beto', username: 'beto' }, { id: 'u-dora', name: 'Dora', username: 'dora' },
  { id: 'u-tina', name: 'Tina', username: 'tina', trainer: true }, { id: 'u-admin', name: 'Admin', username: 'admin1', admin: true, trainer: true },
];
const seedState = () => ({
  unit: 'kg', lang: 'es', effort: 'rpe', targetW: 80,
  coach: { consent: { agreedAt: '2026-01-01T00:00:00.000Z', version: 1 }, profile: { goal: 'muscle' } },
  premium: { v: 1, active: { id: 'inst', week: 2 }, history: [] },
  routines: [{ id: 'r1', name: 'Full body A', emoji: '💪', ex: [{ id: '0001', sets: 3, reps: 10, mode: 'reps', weight: 20 }] }],
  programs: [{ id: 'g1', name: 'Guiada', source: 'guided-v2', status: 'active', weeks: [{ sessions: [{ day: 1 }] }], routineIds: [] }, { id: 'p1', name: 'Mi programa', routineIds: ['r1'] }],
  activeProgramId: 'g1', week: { 1: 'r1' }, dayPlan: {}, exWeights: { '0001': { w: 20 } },
  workouts: [{ id: 'w1', d: '2026-09-01', routineId: 'r1', entries: [{ id: '0001', sets: [{ r: 10, w: 20, done: true }] }] }],
  bodyweight: [{ d: '2026-09-01', w: 78 }],
});

async function start(apiDir, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `diff-${label}-`));
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({ users, creds: [], subs: [], invites: [], recoveries: [] }, null, 2));
  for (const user of users) fs.writeFileSync(path.join(dir, `state-${user.id}.json`), JSON.stringify(seedState()));
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: apiDir, stdio: 'ignore', windowsHide: true, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, PORT: String(port), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base } });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(resolve => setTimeout(resolve, 100)); }
  return { base, dir, label, stop: () => child.kill() };
}

// Volatile values (timestamps, random ids, tokens) are masked so the comparison is about behaviour, not noise.
const MASK = [[/"(?:token|pin)":"[^"]+"/g, m => m.replace(/:".*"/, ':"<secret>"')], [/\b\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z\b/g, '<iso>'], [/\b\d{12,}\b/g, '<ms>'], [/"(?:token|sig|id|cid|ticket|code|pin|key|sid|handle)":"[A-Za-z0-9_.:-]{8,}"/g, m => m.replace(/:".*"/, ':"<id>"')], [/gymsid=[^;"]+/g, 'gymsid=<s>']];
const normalize = text => MASK.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), text);

async function call(server, step) {
  const headers = { ...(step.cookie ? { cookie: step.cookie } : {}), ...(step.raw !== undefined || step.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(step.headers || {}) };
  const init = { method: step.method, headers, body: step.raw !== undefined ? step.raw : step.body !== undefined ? JSON.stringify(step.body) : undefined };
  try {
    const response = await fetch(server.base + step.path, init);
    const text = await response.text();
    return { status: response.status, body: normalize(text).slice(0, 4000), type: response.headers.get('content-type')?.split(';')[0] || '' };
  } catch (error) { return { status: 'error', body: String(error.message).slice(0, 80), type: '' }; }
}

const ana = cookieFor('u-ana'), beto = cookieFor('u-beto'), dora = cookieFor('u-dora'), tina = cookieFor('u-tina'), admin = cookieFor('u-admin');
const stateOf = async (server, cookie) => JSON.parse((await call(server, { method: 'GET', path: '/api/data', cookie })).body.replace(/<iso>/g, '2026-01-01T00:00:00.000Z') || 'null');
const corpus = [
  // Reads
  { name: 'health', method: 'GET', path: '/api/health' }, { name: 'config', method: 'GET', path: '/api/config' }, { name: 'features', method: 'GET', path: '/api/features' },
  { name: 'unknown route', method: 'GET', path: '/api/nope' }, { name: 'me', method: 'GET', path: '/api/me', cookie: ana }, { name: 'me anonymous', method: 'GET', path: '/api/me' },
  { name: 'GET data', method: 'GET', path: '/api/data', cookie: ana }, { name: 'GET data anonymous', method: 'GET', path: '/api/data' },
  { name: 'GET sync', method: 'GET', path: '/api/sync', cookie: ana }, { name: 'GET guided', method: 'GET', path: '/api/guided', cookie: ana }, { name: 'GET premium', method: 'GET', path: '/api/premium', cookie: ana },
  { name: 'GET opposition', method: 'GET', path: '/api/opposition', cookie: ana }, { name: 'GET followup', method: 'GET', path: '/api/followup', cookie: ana }, { name: 'coach status', method: 'GET', path: '/api/coach/status', cookie: ana },
  { name: 'coach disclosure', method: 'GET', path: '/api/coach/disclosure', cookie: ana }, { name: 'export', method: 'GET', path: '/api/me/export', cookie: ana }, { name: 'sessions', method: 'GET', path: '/api/me/sessions', cookie: ana },
  { name: 'news', method: 'GET', path: '/api/news', cookie: ana }, { name: 'notifications', method: 'GET', path: '/api/notifications', cookie: ana }, { name: 'friends', method: 'GET', path: '/api/friends', cookie: ana },
  { name: 'social wall', method: 'GET', path: '/api/social/wall', cookie: ana }, { name: 'chat threads', method: 'GET', path: '/api/chat/threads', cookie: ana }, { name: 'bunker pin', method: 'GET', path: '/api/bunker/pin', cookie: ana },
  { name: 'board', method: 'GET', path: '/api/bunker/board' }, { name: 'settings', method: 'GET', path: '/api/bunker/settings' },
  // Legacy writers, in the formats installed apps send
  { name: 'PUT data (old app: plain state)', method: 'PUT', path: '/api/data', cookie: ana, body: { state: { ...seedState(), unit: 'lb', routines: [{ id: 'r1', name: 'Renombrada', ex: [] }, { id: 'r2', name: 'Nueva', ex: [] }] } } },
  { name: 'PUT data (old app: with active/_ts/extra keys)', method: 'PUT', path: '/api/data', cookie: ana, body: { state: { ...seedState(), _ts: 1760000000000, active: { id: 'forged' }, customThing: { a: 1 } }, wipe: false } },
  { name: 'PUT data (wipe)', method: 'PUT', path: '/api/data', cookie: beto, body: { state: { unit: 'kg', routines: [], workouts: [] }, wipe: true } },
  { name: 'PUT data (premium/coach/guided edits by a legacy user)', method: 'PUT', path: '/api/data', cookie: ana, body: { state: { ...seedState(), premium: { v: 1, active: { id: 'edited', week: 5 }, history: [] }, coach: { consent: { agreedAt: '2026-02-02T00:00:00.000Z', version: 1 }, profile: { goal: 'strength' } } } } },
  { name: 'PUT data array-body', method: 'PUT', path: '/api/data', cookie: dora, body: { state: [] } },
  { name: 'PUT data missing state', method: 'PUT', path: '/api/data', cookie: ana, body: {} },
  { name: 'PUT data malformed json', method: 'PUT', path: '/api/data', cookie: ana, raw: '{"state":' },
  { name: 'PUT data anonymous', method: 'PUT', path: '/api/data', body: { state: {} } },
  { name: 'POST activity', method: 'POST', path: '/api/activity', cookie: ana, body: { at: Date.now() } },
  { name: 'POST workouts/delete', method: 'POST', path: '/api/workouts/delete', cookie: ana, body: { id: 'w1' } },
  { name: 'POST active/clear', method: 'POST', path: '/api/active/clear', cookie: ana, body: { id: 'x' } },
  { name: 'POST handoff', method: 'POST', path: '/api/bunker/handoff', cookie: ana, body: { active: { id: 'act-1', d: '2026-10-23', name: 'Sesión', start: 1760000000000, entries: [] } } },
  { name: 'POST active/activity', method: 'POST', path: '/api/active/activity', cookie: ana, body: { id: 'act-1', at: Date.now() } },
  { name: 'POST active/clear (after handoff)', method: 'POST', path: '/api/active/clear', cookie: ana, body: { id: 'act-1' } },
  // Sync V2 (new apps)
  { name: 'POST sync save (envelope)', method: 'SYNC', kind: 'save', cookie: beto },
  { name: 'POST sync save with premium edit', method: 'SYNC', kind: 'save-paid', cookie: beto },
  { name: 'POST sync replace', method: 'SYNC', kind: 'replace', cookie: beto },
  { name: 'POST sync save array-state', method: 'SYNC', kind: 'array', cookie: beto },
  { name: 'POST sync save scalar-state', method: 'SYNC', kind: 'scalar', cookie: beto },
  { name: 'POST sync delete program', method: 'SYNC', kind: 'delete', cookie: beto },
  { name: 'PUT data after sync V2 (old app on a migrated account)', method: 'PUT', path: '/api/data', cookie: beto, body: { state: seedState() } },
  // Social / chat / media writes of a legacy user
  { name: 'social wall post', method: 'POST', path: '/api/social/wall', cookie: ana, body: { text: 'hola' } },
  { name: 'friends request', method: 'POST', path: '/api/friends/request', cookie: ana, body: { code: 'ZZZZZZ' } },
  { name: 'chat message', method: 'POST', path: '/api/chat/messages', cookie: ana, body: { threadId: 'x', text: 'hola' } },
  { name: 'push subscribe', method: 'POST', path: '/api/push/subscribe', cookie: ana, body: { endpoint: 'https://example.com/x', keys: { p256dh: 'a', auth: 'b' } } },
  { name: 'coach plan', method: 'POST', path: '/api/coach/plan', cookie: ana, body: {} }, { name: 'premium started', method: 'POST', path: '/api/premium/started', cookie: ana, body: {} },
  // Staff and admin
  { name: 'admin users', method: 'GET', path: '/api/admin/users', cookie: admin }, { name: 'trainer members', method: 'GET', path: '/api/trainer/members', cookie: tina },
  { name: 'member hits admin', method: 'GET', path: '/api/admin/users', cookie: ana },
  // Kiosk flow
  { name: 'kiosk checkin bad pin', method: 'POST', path: '/api/bunker/checkin', body: { pin: '000000' } },
  { name: 'kiosk session no token', method: 'GET', path: '/api/bunker/session' },
  { name: 'kiosk flow', method: 'KIOSK', cookie: ana },
  // Shared-IP limiter: 25 wrong PINs from one address (the gym Wi-Fi) then a correct check-in
  { name: 'shared-IP limiter', method: 'LIMITER', cookie: ana },
  // Route-shape tricks
  { name: 'trailing slash', method: 'GET', path: '/api/data/', cookie: ana }, { name: 'query string', method: 'GET', path: '/api/data?x=1', cookie: ana }, { name: 'lowercase method', method: 'get', path: '/api/data', cookie: ana },
  { name: 'forged forwarded-for', method: 'GET', path: '/api/health', headers: { 'x-forwarded-for': '1.2.3.4' } },
];

async function sync(server, step) {
  const envelope = JSON.parse((await call(server, { method: 'GET', path: '/api/sync', cookie: step.cookie })).body);
  const meta = envelope.meta || {}, base = { operationId: 'op-fixed-' + step.kind.padEnd(8, 'x'), revision: meta.revision, generation: meta.generation };
  const state = JSON.parse(JSON.stringify(envelope.state || seedState())); delete state._sync;
  const bodies = {
    save: { ...base, type: 'save', state: { ...state, routines: [...(state.routines || []), { id: 'r-sync', name: 'Sync', ex: [] }] } },
    'save-paid': { ...base, type: 'save', state: { ...state, premium: { v: 1, active: { id: 'edited-sync' }, history: [] }, coach: { consent: { agreedAt: '2026-03-03T00:00:00.000Z', version: 1 }, profile: { goal: 'sync' } } } },
    replace: { ...base, type: 'replace', state: { ...state, unit: 'lb' } },
    array: { ...base, type: 'save', state: [] }, scalar: { ...base, type: 'save', state: 5 },
    delete: { ...base, type: 'delete', kind: 'programs', id: 'p1' },
  };
  return call(server, { method: 'POST', path: '/api/sync', cookie: step.cookie, body: bodies[step.kind] });
}

async function kiosk(server, step) {
  const pin = JSON.parse((await call(server, { method: 'GET', path: '/api/bunker/pin', cookie: step.cookie })).body);
  const checkin = await call(server, { method: 'POST', path: '/api/bunker/checkin', body: { pin: pin.pin } });
  let token = null; try { token = JSON.parse(checkin.body.replace(/<id>/g, 'x')).token; } catch { /* masked */ }
  const real = await fetch(server.base + '/api/bunker/checkin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin: pin.pin }) }).then(r => r.json()).catch(() => ({}));
  const bearer = real.token, auth = bearer ? { authorization: `Bearer ${bearer}` } : {};
  const results = [checkin];
  for (const [method, route, body] of [['GET', '/api/bunker/session'], ['POST', '/api/bunker/active', { active: { id: 'k-1', d: '2026-10-23', name: 'K', start: 1760000000000, entries: [] }, exName: 'x', setIdx: 0, setsTotal: 1 }], ['POST', '/api/bunker/rest', { sec: 30 }], ['POST', '/api/bunker/finish', { workout: { id: 'k-1', d: '2026-10-23', entries: [] } }], ['GET', '/api/bunker/board']]) {
    results.push(await call(server, { method, path: route, body, headers: auth }));
  }
  return { status: results.map(r => r.status).join(','), body: results.map(r => r.body).join('\n'), type: 'kiosk' };
}

async function limiter(server, step) {
  const pin = JSON.parse((await call(server, { method: 'GET', path: '/api/bunker/pin', cookie: step.cookie })).body).pin;
  const statuses = [];
  for (let i = 0; i < 25; i++) statuses.push((await call(server, { method: 'POST', path: '/api/bunker/checkin', body: { pin: String(100000 + i) } })).status);
  statuses.push((await call(server, { method: 'POST', path: '/api/bunker/checkin', body: { pin } })).status);
  return { status: statuses.join(','), body: '', type: 'limiter' };
}

async function run(server) {
  const out = [];
  for (const step of corpus) {
    const result = step.method === 'SYNC' ? await sync(server, step) : step.method === 'KIOSK' ? await kiosk(server, step) : step.method === 'LIMITER' ? await limiter(server, step) : await call(server, step);
    out.push({ name: step.name, ...result });
  }
  // Final state of every member on disk (decrypted by the server through the API for members; admin/trainer states untouched by the corpus).
  const finals = {};
  for (const [label, cookie] of [['ana', ana], ['beto', beto]]) { const r = await call(server, { method: 'GET', path: '/api/data', cookie }); finals[label] = r.body; }
  return { out, finals };
}

const baseline = await start(baselineDir, 'main'), branch = await start(branchDir, 'branch');
let exit = 0;
try {
  const [a, b] = [await run(baseline), await run(branch)];
  const rows = a.out.map((row, i) => ({ name: row.name, main: row, branch: b.out[i], same: row.status === b.out[i].status && row.body === b.out[i].body }));
  const finalsSame = Object.keys(a.finals).map(k => ({ name: `final state ${k}`, same: a.finals[k] === b.finals[k], main: a.finals[k].slice(0, 300), branch: b.finals[k].slice(0, 300) }));
  const diffs = [...rows, ...finalsSame].filter(row => !row.same);
  const unexpected = diffs.filter(row => ![...EXPECTED.keys()].some(key => key.endsWith(row.name.replace(/^PUT data /, 'PUT /api/data ').replace(/^POST sync save /, 'POST /api/sync save '))) && !EXPECTED.has(row.name));
  console.log(`# Legacy differential: main vs integration branch\n\n${rows.length} requests replayed against both trees (legacy users, no Platform configuration).\n`);
  console.log(`Identical: ${rows.length - diffs.filter(d => rows.includes(d)).length}/${rows.length} · intentional differences: ${diffs.length - unexpected.length} · UNEXPECTED differences: ${unexpected.length}\n`);
  for (const row of diffs) {
    const reason = [...EXPECTED].find(([key]) => key.endsWith(row.name.replace(/^PUT data /, 'PUT /api/data ').replace(/^POST sync save /, 'POST /api/sync save ')))?.[1];
    console.log(`- ${reason ? '[intentional]' : '[UNEXPECTED]'} ${row.name}: main ${row.main.status ?? ''} -> branch ${row.branch?.status ?? ''}${reason ? ` — ${reason}` : ''}`);
    if (!reason) console.log(`    main:   ${String(row.main.body ?? row.main).slice(0, 200)}\n    branch: ${String(row.branch?.body ?? row.branch).slice(0, 200)}`);
  }
  if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify({ rows, finalsSame, unexpected: unexpected.map(row => row.name) }, null, 2));
  if (unexpected.length) exit = 1;
} finally { baseline.stop(); branch.stop(); for (const s of [baseline, branch]) fs.rmSync(s.dir, { recursive: true, force: true }); }
process.exit(exit);
