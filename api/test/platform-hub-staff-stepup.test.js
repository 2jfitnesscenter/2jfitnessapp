// F9o · Strong STAFF actions confirmed with the 2J Hub passkey (2JHub H-106.1, H-128.3; contract §11, ADR 0037), against the REAL Training server and
// a fake Platform. ATTACK tests: reused / foreign / altered grants, other cookie, other action / target / requested role, recovery-link, members,
// trainers, ADMIN_UIDS, foreign Origin, Platform down, switch off (identical to today) and two requests with one grant.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

const { signHubRequest } = await import('../platform-hub/service-auth.js');
const API_ROOT = path.resolve('.');
const HOME = 'http://127.0.0.1:5191';
const ADMIN = 'http://127.0.0.1:5192';
const SECRET = 'a'.repeat(64);
const outbound = { keyId: 'bunker-out-o', secret: Buffer.alloc(32, 0x4f) };
const inbound = { keyId: 'platform-out-o', secret: Buffer.alloc(32, 0x6f) };
const P = { boss: randomUUID(), coach: randomUUID(), boss2: randomUUID() };

/* ------------------------------------------------------------------ fake Platform */
const ssoCodes = new Map(), stepCodes = new Map(), intents = new Map();
const fake = { intentStatus: null, redeemStatus: null, answer: null, down: false };
const platform = await new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks), h = n => req.headers[n];
      const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      if (fake.down) return reply(503, { error: 'down' });
      const { signature } = signHubRequest({ keyId: outbound.keyId, secret: outbound.secret, timestamp: h('x-2j-timestamp') || '', requestId: h('x-2j-request-id') || '', method: req.method, target: req.url, body });
      if (h('x-2j-key-id') !== outbound.keyId || h('x-2j-signature') !== signature) return reply(401, { error: 'SERVICE_AUTH_INVALID' });
      if (req.method === 'GET' && req.url === '/api/internal/platform/v2/training-staff') return reply(200, { v: 1, contract: 'training-staff-v1', generatedAt: new Date().toISOString(), items: [] });
      const r = body.length ? JSON.parse(body.toString('utf8')) : {};
      if (req.url === '/api/internal/platform/v2/training-staff-sso/redeem') {
        const e = ssoCodes.get(r.code);
        if (!e || e.used || r.audience !== '2j-training-staff') return reply(403, { error: 'STAFF_SSO_REJECTED' });
        e.used = true;
        return reply(200, { v: 1, contract: 'training-staff-v1', issuer: '2j-platform', audience: '2j-training-staff', personId: e.personId, trainingUserId: e.uid, linkStatus: 'active', staffRole: e.role, displayName: 'Equipo', assurance: 'platform_sso', correlationId: r.correlationId });
      }
      if (req.url === '/api/internal/platform/v2/training-staff-stepup/intents') {
        if (fake.intentStatus) { const s = fake.intentStatus; fake.intentStatus = null; return reply(s, { error: 'STAFF_STEPUP_REJECTED' }); }
        intents.set(r.intentId, r);
        return reply(201, { ok: true });
      }
      if (req.url === '/api/internal/platform/v2/training-staff-stepup/redeem') {
        if (fake.redeemStatus) { const s = fake.redeemStatus; fake.redeemStatus = null; return reply(s, { error: 'STAFF_STEPUP_REJECTED' }); }
        const e = stepCodes.get(r.code);
        if (!e || e.used || r.audience !== '2j-training-staff-stepup') return reply(403, { error: 'STAFF_STEPUP_REJECTED' });
        e.used = true;
        const answer = { v: 1, issuer: '2j-platform', audience: '2j-training-staff-stepup', contract: 'training-staff-stepup-v1', personId: e.personId, trainingUserId: e.uid, staffRole: e.role, action: e.intent.action, bindingHash: e.intent.bindingHash, intentId: e.intent.intentId, assurance: 'platform_passkey', verifiedAt: new Date().toISOString(), correlationId: r.correlationId };
        const o = fake.answer; fake.answer = null;
        return reply(200, o ? { ...answer, ...o } : answer);
      }
      reply(404, { error: 'not_found' });
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

/* ------------------------------------------------------------------ Training under test */
function seed(dir) {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [
      { id: 'u-boss', name: 'Boss', username: 'boss', created: '2025-01-01T00:00:00.000Z', admin: true },
      { id: 'u-boss2', name: 'Boss Dos', username: 'bossdos', created: '2025-01-01T00:00:00.000Z', admin: true },
      { id: 'u-coach', name: 'Coach', username: 'coach', created: '2025-01-01T00:00:00.000Z', trainer: true },
      { id: 'u-env', name: 'Juanjo', username: 'juanjo', created: '2025-01-01T00:00:00.000Z' },
      { id: 'u-member', name: 'Socio Uno', username: 'socio', created: '2025-01-01T00:00:00.000Z' },
      { id: 'u-member2', name: 'Socio Dos', username: 'socio2', created: '2025-01-01T00:00:00.000Z' },
    ],
    creds: [], subs: [], invites: [{ code: 'ABCDEF0123456789', note: 'x', createdBy: 'u-boss', created: '2026-01-01T00:00:00.000Z' }], recoveries: [],
  }));
}
const freePort = () => new Promise(resolve => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
async function startTraining(extraEnv) {
  const dir = tempData(); seed(dir);
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: API_ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base, ADMIN_UIDS: 'u-env', ...extraEnv }, stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true });
  let stderr = ''; child.stderr.on('data', d => { stderr += d; });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  return { base, dir, stderr: () => stderr, stop: () => new Promise(r => { child.once('exit', r); child.kill(); }) };
}
const BRIDGE = {
  PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_HOME_URL: HOME, PLATFORM_ADMIN_URL: ADMIN,
  PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
  PLATFORM_HUB_INBOUND_KEYS: JSON.stringify({ [inbound.keyId]: inbound.secret.toString('base64url') }), PLATFORM_HUB_STAFF_ROLES_ENABLED: 'true',
};
const on = await startTraining({ ...BRIDGE, PLATFORM_HUB_STAFF_STEPUP_ENABLED: 'true' });
const off = await startTraining({ ...BRIDGE, PLATFORM_STAFF_LOGIN_RETIRED: 'true' });
after(async () => { await on.stop(); await off.stop(); platform.server.close(); });
const readDb = t => JSON.parse(fs.readFileSync(path.join(t.dir, 'db.json'), 'utf8'));
const refused = (t, reason) => readDb(t).securityEvents.some(e => e.event === 'platform_staff_stepup_refused' && e.meta?.reason === reason);

async function staffSession(t, personId, uid, role) {
  const code = crypto.randomBytes(32).toString('base64url');
  ssoCodes.set(code, { personId, uid, role });
  const r = await fetch(t.base + '/api/platform/v1/staff-sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code, correlationId: randomUUID() }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ADMIN } });
  const set = r.headers.get('set-cookie');
  assert.ok(set, `sin sesión para ${uid}`);
  return set.split(';', 1)[0];
}
const as = (t, cookie, method, p, body) => fetch(t.base + p, { method, headers: { cookie, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
async function start(t, cookie, action, body) {
  const r = await as(t, cookie, 'POST', '/api/platform/v1/staff-stepup/start', { action, body });
  let json = null; try { json = await r.json(); } catch { /* none */ }
  return { status: r.status, json, intent: json?.confirmUrl ? intents.get(json.confirmUrl.split('/').pop()) : null };
}
/** What 2J Hub Admin sends back after the passkey: a code Platform will answer for, bound to that intent. */
async function confirm(t, cookie, intent, { personId, uid, role }, { origin = ADMIN, raw = null } = {}) {
  const code = crypto.randomBytes(32).toString('base64url');
  stepCodes.set(code, { personId, uid, role, intent });
  const body = raw ?? new URLSearchParams({ stepupCode: code, stepupCorrelationId: randomUUID(), intentId: intent.intentId }).toString();
  const r = await fetch(t.base + '/api/platform/v1/staff-stepup/receive', { method: 'POST', redirect: 'manual', body, headers: { 'content-type': 'application/x-www-form-urlencoded', ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) } });
  return { status: r.status, location: r.headers.get('location'), cache: r.headers.get('cache-control') };
}
const BOSS = { personId: P.boss, uid: 'u-boss', role: 'admin' };
const role = (id, r) => ({ id, role: r });

/* ------------------------------------------------------------------ switch off = today */
test('apagado: la sesión de personal de 2J Hub sigue pidiendo la passkey de Búnker; las rutas nuevas no existen; aviso al arrancar', async () => {
  const cookie = await staffSession(off, P.boss, 'u-boss', 'admin');
  const r = await as(off, cookie, 'POST', '/api/admin/user/role', role('u-member', 'trainer'));
  assert.equal(r.status, 403);
  const j = await r.json();
  assert.equal(j.code, 'passkey_required'); assert.equal(j.staffStepUp, undefined);
  assert.equal((await as(off, cookie, 'POST', '/api/platform/v1/staff-stepup/start', { action: 'user_role', body: {} })).status, 404);
  assert.match(off.stderr(), /PLATFORM_STAFF_LOGIN_RETIRED está encendido sin PLATFORM_HUB_STAFF_STEPUP_ENABLED/);
});

/* ------------------------------------------------------------------ the happy path */
test('ADMIN: passkey_required ofrece 2J Hub → intención fijada en el servidor → un permiso de un uso para esa acción y ese cuerpo', async () => {
  const cookie = await staffSession(on, P.boss, 'u-boss', 'admin');
  const first = await as(on, cookie, 'POST', '/api/admin/user/role', role('u-member', 'trainer'));
  const offer = await first.json();
  assert.equal(first.status, 403); assert.equal(offer.code, 'passkey_required'); assert.equal(offer.staffStepUp, true);
  const s = await start(on, cookie, 'user_role', role('u-member', 'trainer'));
  assert.equal(s.status, 200, JSON.stringify(s.json));
  assert.match(s.json.confirmUrl, new RegExp(`^${ADMIN}/#/bunker-confirmar/[0-9a-f-]{36}$`));
  assert.deepEqual(s.intent.target, { kind: 'user', trainingUserId: 'u-member', displayName: 'Socio Uno' });
  assert.deepEqual(s.intent.requested, { role: 'trainer' });
  assert.equal(s.intent.trainingUserId, 'u-boss');
  const c = await confirm(on, cookie, s.intent, BOSS);
  assert.equal(c.status, 303); assert.equal(c.location, '/#/admin'); assert.equal(c.cache, 'no-store');
  const ok = await as(on, cookie, 'POST', '/api/admin/user/role', role('u-member', 'trainer'));
  assert.equal(ok.status, 200, await ok.clone().text());
  // Un solo uso.
  assert.equal((await (await as(on, cookie, 'POST', '/api/admin/user/role', role('u-member', 'member'))).json()).code, 'passkey_required');
  const ev = readDb(on).securityEvents.map(e => e.event);
  for (const name of ['platform_staff_stepup_started', 'platform_staff_stepup_granted', 'platform_staff_stepup_used']) assert.ok(ev.includes(name), name);
  assert.ok(!JSON.stringify(readDb(on).securityEvents).includes('ABCDEF0123456789'));
});

test('cuerpo alterado, otro objetivo, otro rol pedido u otra acción: no pasa y el permiso NO se gasta', async () => {
  const cookie = await staffSession(on, P.boss, 'u-boss', 'admin');
  const s = await start(on, cookie, 'user_role', role('u-member2', 'trainer'));
  assert.equal((await confirm(on, cookie, s.intent, BOSS)).status, 303);
  for (const [p, body] of [
    ['/api/admin/user/role', role('u-member2', 'admin')],          // otro rol pedido
    ['/api/admin/user/role', role('u-member', 'trainer')],         // otro objetivo
    ['/api/admin/user/role', { id: 'u-member2', role: 'trainer', extra: 1, ...{ role: 'admin' } }],
    ['/api/admin/user/trainer', { id: 'u-member2', trainer: true }], // otra acción
    ['/api/admin/invites/new', {}],
  ]) {
    const r = await as(on, cookie, 'POST', p, body);
    assert.equal(r.status, 403, p); assert.equal((await r.json()).code, 'passkey_required');
  }
  assert.equal((await as(on, cookie, 'POST', '/api/admin/user/role', role('u-member2', 'trainer'))).status, 200);
});

test('dos peticiones a la vez con un solo permiso: pasa una', async () => {
  const cookie = await staffSession(on, P.boss, 'u-boss', 'admin');
  const s = await start(on, cookie, 'invite_new', { note: 'doble' });
  assert.equal((await confirm(on, cookie, s.intent, BOSS)).status, 303);
  const both = await Promise.all([1, 2].map(() => as(on, cookie, 'POST', '/api/admin/invites/new', { note: 'doble' })));
  assert.deepEqual(both.map(r => r.status).sort(), [200, 403]);
});

test('otra cookie u otra cuenta no puede recoger la confirmación; Origin ajeno, formulario manipulado y respuesta cruzada se rechazan', async () => {
  const cookie = await staffSession(on, P.boss, 'u-boss', 'admin');
  const other = await staffSession(on, P.boss2, 'u-boss2', 'admin');
  const s = await start(on, cookie, 'user_disable', { id: 'u-member2', disabled: true });
  let r = await confirm(on, other, s.intent, { personId: P.boss2, uid: 'u-boss2', role: 'admin' });
  assert.equal(r.location, '/sso#error=denied'); assert.ok(refused(on, 'other_session'));
  r = await confirm(on, cookie, s.intent, BOSS, { origin: 'https://evil.example' });
  assert.equal(r.location, '/sso#error=denied'); assert.ok(refused(on, 'origin_rejected'));
  r = await confirm(on, cookie, s.intent, BOSS, { raw: 'stepupCode=x&intentId=y' });
  assert.ok(refused(on, 'bad_form'));
  // Respuesta de Platform de otra acción / otro hash / otro usuario / otra persona / sin passkey (un código de F9d-2 o de SSO).
  for (const o of [{ action: 'invite_new' }, { bindingHash: 'b'.repeat(64) }, { trainingUserId: 'u-boss2' }, { personId: randomUUID() }, { assurance: 'platform_sso' }, { audience: '2j-training-stepup' }]) {
    const again = await start(on, cookie, 'user_disable', { id: 'u-member2', disabled: true });
    fake.answer = o;
    const x = await confirm(on, cookie, again.intent, BOSS);
    assert.equal(x.location, '/sso#error=denied', JSON.stringify(o));
  }
  assert.equal((await as(on, cookie, 'POST', '/api/admin/user/disable', { id: 'u-member2', disabled: true })).status, 403);
});

test('recovery-link nunca; me/delete no es de aquí; entrenador solo cierra SUS sesiones; ADMIN_UIDS y passkey de Búnker, fuera', async () => {
  const cookie = await staffSession(on, P.boss, 'u-boss', 'admin');
  const rl = await as(on, cookie, 'POST', '/api/admin/user/recovery-link', { id: 'u-member' });
  const rlj = await rl.json();
  assert.equal(rl.status, 403); assert.equal(rlj.code, 'passkey_required'); assert.equal(rlj.staffStepUp, undefined);
  for (const action of ['recovery_link', 'me_delete', 'export']) assert.equal((await start(on, cookie, action, {})).status, 400);
  // Platform decide el rol: a un entrenador solo le deja cerrar sus propias sesiones.
  const coach = await staffSession(on, P.coach, 'u-coach', 'trainer');
  fake.intentStatus = 403;
  assert.equal((await start(on, coach, 'invite_new', {})).json.code, 'staff_stepup_denied');
  const lo = await start(on, coach, 'logout_all', {});
  assert.equal(lo.status, 200); assert.deepEqual(lo.intent.target, { kind: 'self', trainingUserId: 'u-coach' });
  assert.equal((await confirm(on, coach, lo.intent, { personId: P.coach, uid: 'u-coach', role: 'trainer' })).location, '/#/settings/security');
  assert.equal((await as(on, coach, 'POST', '/api/logout/all', {})).status, 200);
  // Un entrenador con una respuesta de «trainer» para una acción de administración → rechazo aunque Platform se equivocara.
  const coach2 = await staffSession(on, P.coach, 'u-coach', 'trainer');
  const s = await start(on, coach2, 'logout_all', {});
  fake.answer = { action: 'user_role' };
  assert.equal((await confirm(on, coach2, s.intent, { personId: P.coach, uid: 'u-coach', role: 'trainer' })).location, '/sso#error=denied');
  // Sin sesión de personal de 2J Hub (anónimo) → nada.
  assert.equal((await as(on, '', 'POST', '/api/platform/v1/staff-stepup/start', { action: 'logout_all', body: {} })).status, 403);
});

test('rol quitado o vínculo terminado (Platform rechaza el canje) y Platform caído: se niega con aviso claro', async () => {
  const cookie = await staffSession(on, P.boss, 'u-boss', 'admin');
  let s = await start(on, cookie, 'invite_revoke', { code: 'abcdef0123456789' });
  assert.equal(s.status, 200); assert.deepEqual(s.intent.target, { kind: 'invite', inviteHint: '6789' });
  fake.redeemStatus = 403;
  assert.equal((await confirm(on, cookie, s.intent, BOSS)).location, '/sso#error=denied');
  s = await start(on, cookie, 'invite_revoke', { code: 'abcdef0123456789' });
  fake.redeemStatus = 503;
  assert.equal((await confirm(on, cookie, s.intent, BOSS)).location, '/sso#error=unavailable');
  fake.down = true;
  const d = await start(on, cookie, 'invite_new', {});
  fake.down = false;
  assert.equal(d.status, 503); assert.equal(d.json.code, 'platform_unavailable'); assert.match(d.json.error, /2J Hub no responde/);
  // Una confirmación ya usada no se reutiliza.
  s = await start(on, cookie, 'invite_new', { note: 'reuso' });
  const code = crypto.randomBytes(32).toString('base64url');
  stepCodes.set(code, { ...BOSS, intent: s.intent });
  const form = new URLSearchParams({ stepupCode: code, stepupCorrelationId: randomUUID(), intentId: s.intent.intentId }).toString();
  const post = () => fetch(on.base + '/api/platform/v1/staff-stepup/receive', { method: 'POST', redirect: 'manual', body: form, headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ADMIN, cookie } });
  assert.equal((await post()).headers.get('location'), '/#/admin');
  assert.equal((await post()).headers.get('location'), '/sso#error=denied');
});

test('ADMIN_UIDS nunca: ni entra como personal de 2J Hub ni puede empezar una confirmación', async () => {
  const code = crypto.randomBytes(32).toString('base64url');
  ssoCodes.set(code, { personId: randomUUID(), uid: 'u-env', role: 'admin' });
  const r = await fetch(on.base + '/api/platform/v1/staff-sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code, correlationId: randomUUID() }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: ADMIN } });
  assert.equal(r.headers.get('set-cookie'), null);
  assert.equal(r.headers.get('location'), '/sso#error=denied');
});
