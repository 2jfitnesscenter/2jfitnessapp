// F9c · Training settings from 2J Home + end-of-link notice on account erasure, against the REAL Training server and a fake Platform that follows
// 2JHub docs/contracts/platform-training-v2.md §7. Also: with PLATFORM_HUB_SETTINGS_ENABLED off, everything answers exactly like F9b.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { tempData } from './helpers.mjs';

const { signHubRequest } = await import('../platform-hub/service-auth.js');
const { baselineCapabilities } = await import('../platform-sso/capabilities.js');
const { HUB_ACCENTS } = await import('../platform-hub/settings.js');
const API_ROOT = path.resolve('.');
const HOME = 'http://127.0.0.1:5174';
const SECRET = 'b'.repeat(64);
const outbound = { keyId: 'bunker-out-9', secret: Buffer.alloc(32, 0x31) };   // Training -> Platform
const inbound = { keyId: 'platform-out-9', secret: Buffer.alloc(32, 0x52) };   // Platform -> Training
const b64u = b => Buffer.from(b).toString('base64url');

/* ------------------------------------------------------------------ fake Platform: redeem, capabilities, link-ended */
const platformState = { codes: new Map(), notices: [], linkEndedStatus: 503 };
const platform = await new Promise(resolve => {
  const server = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks), h = n => req.headers[n];
      const reply = (status, payload) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload)); };
      const { signature } = signHubRequest({ keyId: outbound.keyId, secret: outbound.secret, timestamp: h('x-2j-timestamp') || '', requestId: h('x-2j-request-id') || '', method: req.method, target: req.url, body });
      if (h('x-2j-key-id') !== outbound.keyId || h('x-2j-signature') !== signature) return reply(401, { error: 'SERVICE_AUTH_INVALID' });
      const cap = /^\/api\/internal\/platform\/v2\/persons\/([0-9a-f-]{36})\/training-capabilities$/.exec(req.url);
      if (cap) {
        const entry = [...platformState.codes.values()].find(c => c.personId === cap[1]);
        const now = Date.now();
        return reply(200, { contract: '2J-CAPABILITIES-V2', version: 2, personId: cap[1], trainingSubject: { linkStatus: 'active', trainingUserId: entry?.trainingUserId }, capabilityLevel: 'baseline', accessState: 'baseline', reasonCode: 'FREE_BASELINE', capabilities: baselineCapabilities(), suspensionStatus: 'none', effectiveFrom: null, expiresAt: new Date(now + 60_000).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true } });
      }
      if (req.url === '/api/internal/platform/v2/training-sso/redeem') {
        const r = JSON.parse(body.toString('utf8'));
        const entry = platformState.codes.get(r.code);
        if (!entry || entry.used) return reply(403, { error: 'SSO_REJECTED' });
        entry.used = true;
        return reply(200, { v: 1, issuer: '2j-platform', audience: '2j-training', personId: entry.personId, trainingUserId: entry.trainingUserId, linkStatus: 'active', displayName: 'Ana', assurance: 'platform_sso', correlationId: r.correlationId });
      }
      if (req.method === 'POST' && req.url === '/api/internal/platform/v2/training-links/ended') {
        const n = JSON.parse(body.toString('utf8'));
        platformState.notices.push({ status: platformState.linkEndedStatus, body: n });
        if (platformState.linkEndedStatus !== 200) return reply(platformState.linkEndedStatus, { error: 'x' });
        return reply(200, { v: 1, eventId: n.eventId, status: 'revoked' });
      }
      reply(404, { error: 'not_found' });
    });
  });
  server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
});

/* ------------------------------------------------------------------ Training under test */
const keyOf = () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([Buffer.from('a50102032620012158' + '20', 'hex'), Buffer.from(jwk.x, 'base64url'), Buffer.from('225820', 'hex'), Buffer.from(jwk.y, 'base64url')]);
  return { privateKey, cose: b64u(cose) };
};
const keyE = keyOf();
const P = { a: randomUUID(), b: randomUUID(), erase: randomUUID() };
const linked = (id, personId, extra = {}) => ({ id, name: `Member ${id}`, username: id.replace(/[^a-z]/g, ''), personId, platformLink: { personId, state: 'active', origin: 'platform_admin' }, ...extra });
function seed(dir) {
  fs.writeFileSync(path.join(dir, 'secret'), SECRET, { mode: 0o600 });
  fs.writeFileSync(path.join(dir, 'db.json'), JSON.stringify({
    users: [linked('u-a', P.a), linked('u-b', P.b), { id: 'u-free', name: 'Free', username: 'free' }, { ...linked('u-staff', randomUUID()), trainer: true }, linked('u-erase', P.erase)],
    creds: [{ id: 'cred-e', userId: 'u-erase', publicKey: keyE.cose, counter: 1, transports: ['internal'] }],
    subs: [], invites: [], recoveries: [],
  }));
}
const freePort = () => new Promise(resolve => { const p = http.createServer().listen(0, '127.0.0.1', () => { const { port } = p.address(); p.close(() => resolve(port)); }); });
async function startTraining(extraEnv) {
  const dir = tempData(); seed(dir);
  const port = await freePort(), base = `http://localhost:${port}`;
  const child = spawn(process.execPath, ['server.js'], { cwd: API_ROOT, env: { ...process.env, PORT: String(port), DATA_DIR: dir, SECRET_FILE: path.join(dir, 'secret'), RP_ID: 'localhost', ORIGIN: base, ...extraEnv }, stdio: ['ignore', 'ignore', 'ignore'], windowsHide: true });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 100)); }
  return { base, dir, stop: () => child.kill() };
}
const BRIDGE = {
  PLATFORM_SSO_ENABLED: 'true', PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_HOME_URL: HOME,
  PLATFORM_API_BASE_URL: `http://127.0.0.1:${platform.port}`, PLATFORM_API_KEY_ID: outbound.keyId, PLATFORM_API_KEY_SECRET: outbound.secret.toString('base64url'),
  PLATFORM_HUB_INBOUND_KEYS: JSON.stringify({ [inbound.keyId]: inbound.secret.toString('base64url') }),
};
const on = await startTraining({ ...BRIDGE, PLATFORM_HUB_SETTINGS_ENABLED: 'true' });
const off = await startTraining(BRIDGE);
after(() => { on.stop(); off.stop(); platform.server.close(); });

async function service(t, method, route, payload, { key = inbound, at = Date.now(), requestId = randomUUID(), headers = {}, raw } = {}) {
  const body = raw ?? (payload === undefined ? '' : JSON.stringify(payload));
  const timestamp = new Date(at).toISOString();
  const { signature } = signHubRequest({ keyId: key.keyId, secret: key.secret, timestamp, requestId, method, target: route, body });
  const r = await fetch(t.base + route, { method, body: body || undefined, headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-2j-key-id': key.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': requestId, 'x-2j-signature': signature, ...headers } });
  let json = null; try { json = await r.json(); } catch { /* not json */ }
  return { status: r.status, json };
}
const settingsPath = uid => `/api/internal/platform/v1/training-users/${uid}/settings`;
const patch = (t, uid, body, key = `k-${randomUUID()}`) => service(t, 'PATCH', settingsPath(uid), body, { headers: { 'idempotency-key': key } });
const cookie = uid => { const payload = `${uid}:${Date.now() + 86400000}:0`; return `gymsid=${payload}.${crypto.createHmac('sha256', SECRET).update(payload).digest('base64url')}`; };
const member = async (t, uid, method, p, body) => {
  const r = await fetch(t.base + p, { method, headers: { cookie: cookie(uid), 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = null; try { data = await r.json(); } catch { /* none */ }
  return { status: r.status, data };
};
const readDb = t => JSON.parse(fs.readFileSync(path.join(t.dir, 'db.json'), 'utf8'));

/* ------------------------------------------------------------------ tests */
test('settings: GET gives what Settings shows; PATCH applies with Training\'s own rules and Training\'s own screens see it', async () => {
  const g = await service(on, 'GET', settingsPath('u-a'));
  assert.equal(g.status, 200);
  assert.deepEqual(g.json.personalization, { accent: 'lime', appearance: 'system', textScale: 1 });
  assert.equal(g.json.privacy.profile, 'friends');
  assert.equal('push' in g.json.notifications, false, 'push stays a per-device choice in Training');

  const w = await patch(on, 'u-a', { v: 1, personalization: { accent: 'violet', appearance: 'dark' }, notifications: { messages: false }, privacy: { profile: 'private', workouts: true } });
  assert.equal(w.status, 200, JSON.stringify(w.json));
  assert.deepEqual(w.json.personalization, { accent: 'violet', appearance: 'dark', textScale: 1 });
  // The SAME stores Training's own Settings use: the synced state and the social preferences.
  const sync = await member(on, 'u-a', 'GET', '/api/sync?owner=u-a');
  assert.equal(sync.data.state.accent, 'violet'); assert.equal(sync.data.state.theme, 'dark');
  const prefs = await member(on, 'u-a', 'GET', '/api/social/preferences');
  assert.equal(prefs.data.notifications.messages, false); assert.equal(prefs.data.privacy.profile, 'private'); assert.equal(prefs.data.privacy.workouts, true);
  // From Training (the member's own Settings) → Home reads the same value: one source of truth, last write wins.
  await member(on, 'u-a', 'POST', '/api/social/preferences', { privacy: { profile: 'community' } });
  assert.equal((await service(on, 'GET', settingsPath('u-a'))).json.privacy.profile, 'community');
  // Audited as a security event with the groups, never the values.
  const ev = readDb(on).securityEvents.filter(e => e.event === 'platform_hub_settings_changed' && e.userId === 'u-a');
  assert.equal(ev.length, 1); assert.equal(JSON.stringify(ev).includes('violet'), false); assert.equal(ev[0].meta.count, 5);
});

test('settings: a server-side change bumps the sync revision, so a stale device cannot silently undo it', async () => {
  const before = (await member(on, 'u-b', 'GET', '/api/sync?owner=u-b')).data.meta.revision;
  assert.equal((await patch(on, 'u-b', { v: 1, personalization: { accent: 'teal' } })).status, 200);
  const now = (await member(on, 'u-b', 'GET', '/api/sync?owner=u-b')).data;
  assert.ok(now.meta.revision > before);
  const stale = await member(on, 'u-b', 'POST', '/api/sync', { operationId: randomUUID(), owner: 'u-b', type: 'save', revision: before, generation: now.meta.generation, state: { ...now.state, accent: 'lime' } });
  assert.equal(stale.status, 409, 'stale write is refused (conflict screen), never a silent overwrite');
  assert.equal((await service(on, 'GET', settingsPath('u-b'))).json.personalization.accent, 'teal');
});

test('settings: strict allowlist, values out of range, idempotency, unknown / unlinked / staff users', async () => {
  for (const body of [
    { v: 1, personalization: { accent: '#ff0000' } }, { v: 1, personalization: { glass: true } }, { v: 1, personalization: { textScale: 2 } },
    { v: 1, notifications: { push: true } }, { v: 1, privacy: { profile: 'everyone' } }, { v: 1, health: { whoop: false } }, { v: 1 }, { v: 2, privacy: { prs: false } },
    { v: 1, trainingUserId: 'u-b', privacy: { prs: false } },
  ]) assert.equal((await patch(on, 'u-a', body)).status, 400, JSON.stringify(body));
  assert.equal((await service(on, 'PATCH', settingsPath('u-a'), { v: 1, privacy: { prs: false } })).status, 400, 'Idempotency-Key required');
  const key = `k-${randomUUID()}`;
  assert.equal((await patch(on, 'u-a', { v: 1, privacy: { prs: false } }, key)).status, 200);
  assert.equal((await patch(on, 'u-a', { v: 1, privacy: { prs: false } }, key)).status, 200, 'same key, same body → same answer');
  assert.equal((await patch(on, 'u-a', { v: 1, privacy: { prs: true } }, key)).status, 422, 'same key, other body');
  assert.equal((await patch(on, 'u-a', { v: 1, privacy: { prs: true } }, key)).status, 422);
  for (const uid of ['u-nobody', 'u-free', 'u-staff']) assert.equal((await service(on, 'GET', settingsPath(uid))).status, 404, uid);
  // Accent list = the frontend palette.
  assert.equal(HUB_ACCENTS.length, 11);
});

test('settings: signature, replay, ±30 s, altered body, other method or path → generic 401', async () => {
  const route = settingsPath('u-a');
  const requestId = randomUUID();
  assert.equal((await service(on, 'GET', route, undefined, { requestId })).status, 200);
  assert.equal((await service(on, 'GET', route, undefined, { requestId })).status, 401, 'replay');
  assert.equal((await service(on, 'GET', route, undefined, { at: Date.now() - 31_000 })).status, 401);
  assert.equal((await service(on, 'GET', route, undefined, { at: Date.now() + 31_000 })).status, 401);
  assert.equal((await service(on, 'GET', route, undefined, { key: { keyId: 'stranger', secret: Buffer.alloc(32, 9) } })).status, 401);
  // Signed one body, sent another.
  const timestamp = new Date().toISOString(), rid = randomUUID();
  const { signature } = signHubRequest({ keyId: inbound.keyId, secret: inbound.secret, timestamp, requestId: rid, method: 'PATCH', target: route, body: JSON.stringify({ v: 1, privacy: { prs: true } }) });
  const tampered = await fetch(on.base + route, { method: 'PATCH', body: JSON.stringify({ v: 1, privacy: { prs: false } }), headers: { 'content-type': 'application/json', 'idempotency-key': 'k-tampered-1', 'x-2j-key-id': inbound.keyId, 'x-2j-timestamp': timestamp, 'x-2j-request-id': rid, 'x-2j-signature': signature } });
  assert.equal(tampered.status, 401);
  assert.equal((await service(on, 'POST', route, { v: 1 })).status, 404, 'POST is not a settings method');
});

test('receiver: `next` from the closed list lands in Settings → Data; anything else is refused', async () => {
  const form = fields => fetch(on.base + '/api/platform/v1/sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams(fields).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: HOME } });
  const issue = () => { const code = crypto.randomBytes(32).toString('base64url'); platformState.codes.set(code, { personId: P.a, trainingUserId: 'u-a' }); return { code, correlationId: randomUUID() }; };
  const ok = await form({ ...issue(), next: 'account' });
  assert.equal(ok.status, 303); assert.equal(ok.headers.get('location'), '/settings#data');
  for (const next of ['https://evil.example', '/admin', 'account/../x', '']) {
    const r = await form({ ...issue(), next });
    assert.equal(r.headers.get('location'), '/sso#error=denied', next);
  }
  // Without the settings switch the third field is refused exactly as in F9b.
  const code = crypto.randomBytes(32).toString('base64url'); platformState.codes.set(code, { personId: P.a, trainingUserId: 'u-a' });
  const r = await fetch(off.base + '/api/platform/v1/sso/receive', { method: 'POST', redirect: 'manual', body: new URLSearchParams({ code, correlationId: randomUUID(), next: 'account' }).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', origin: HOME } });
  assert.equal(r.headers.get('location'), '/sso#error=denied');
});

test('erasure: unchanged and never blocked; the end-of-link notice is queued, retried and delivered once', async () => {
  platformState.linkEndedStatus = 503;   // Platform down at erasure time
  const o = await member(on, 'u-erase', 'POST', '/api/me/delete/options', {});
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const rpIdHash = crypto.createHash('sha256').update('localhost').digest();
  const authData = Buffer.concat([rpIdHash, Buffer.from([0x01]), Buffer.from([0, 0, 0, 9])]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge: o.data.options.challenge, origin: on.base, crossOrigin: false }));
  const sig = crypto.sign('sha256', Buffer.concat([authData, crypto.createHash('sha256').update(clientDataJSON).digest()]), keyE.privateKey);
  const credential = { id: 'cred-e', rawId: 'cred-e', type: 'public-key', response: { authenticatorData: b64u(authData), clientDataJSON: b64u(clientDataJSON), signature: b64u(sig) }, clientExtensionResults: {} };
  const res = await member(on, 'u-erase', 'POST', '/api/me/delete', { cid: o.data.cid, credential, confirm: 'uerase' });
  assert.equal(res.status, 200, JSON.stringify(res.data));
  assert.equal(readDb(on).users.some(u => u.id === 'u-erase'), false, 'the account is gone even though Platform is down');
  for (let i = 0; i < 50 && !platformState.notices.length; i++) await new Promise(r => setTimeout(r, 50));
  assert.equal(platformState.notices.length, 1);
  const first = platformState.notices[0].body;
  assert.deepEqual(Object.keys(first).sort(), ['correlationId', 'endedAt', 'eventId', 'personId', 'reason', 'trainingUserId', 'v']);
  assert.deepEqual([first.personId, first.trainingUserId, first.reason], [P.erase, 'u-erase', 'deleted_in_training']);
  const outbox = JSON.parse(fs.readFileSync(path.join(on.dir, 'platform-hub-outbox.json'), 'utf8'));
  assert.equal(outbox.items.length, 1, 'kept in the persistent queue for a retry');
  assert.equal(outbox.items[0].eventId, first.eventId);
});

test('settings switch off (bridge on): settings and the notice do not exist; F9b answers unchanged', async () => {
  assert.equal((await service(off, 'GET', settingsPath('u-a'))).status, 404);
  assert.equal((await patch(off, 'u-a', { v: 1, privacy: { prs: false } })).status, 404);
  assert.equal(fs.existsSync(path.join(off.dir, 'platform-hub-outbox.json')), false);
  const cfg = await (await fetch(off.base + '/api/config')).json();
  assert.equal(cfg.platformBridge, true);
});
