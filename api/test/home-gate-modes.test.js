import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createPlatformIntegration } from '../platform-sso/index.js';
import { baselineCapabilities } from '../platform-sso/capabilities.js';

// Gate behaviour for a `home` session, by enforcement mode (the mode belongs to the Bunker user, as for any session).
const PERSON = randomUUID();
const GATED = 'POST /api/scan/start';        // gated: aiCoach (not in the free baseline)
const MEMBER = 'GET /api/social/feed';       // member: needs the account not to be blocked
const FREE = 'GET /api/data';                // gated: workoutHistory (free baseline)

function payload({ kind = 'baseline', trainingUserId, now = Date.now() }) {
  const base = baselineCapabilities();
  const caps = kind === 'full' ? Object.fromEntries(Object.keys(base).map(n => [n, true])) : base;
  return {
    contract: '2J-CAPABILITIES-V2', version: 2, personId: PERSON, trainingSubject: { linkStatus: 'active', trainingUserId },
    capabilityLevel: kind === 'full' ? 'full' : 'baseline', accessState: kind === 'full' ? 'active' : 'baseline', capabilities: caps,
    reasonCode: kind === 'full' ? 'ACTIVE_FULL' : 'FREE_BASELINE', suspensionStatus: 'none', effectiveFrom: null,
    expiresAt: new Date(now + 60_000).toISOString(), generatedAt: new Date(now).toISOString(), source: { platform: true },
  };
}

function build({ user, session, down = false, kind = 'baseline', warns = [], client = true, state = { calls: 0 } }) {
  const fetchImpl = async () => {
    state.calls++;
    if (down) throw new Error('down');
    const body = payload({ kind, trainingUserId: user.id });
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  };
  return createPlatformIntegration({
    config: { client: client ? { baseUrl: 'http://127.0.0.1:9', keyId: 'k', secret: Buffer.alloc(32, 3) } : null, ssoEnabled: true },
    db: { users: [user], deviceSessions: [] }, saveDb() {}, secEvent() {},
    json: (res, status, body) => { res.status = status; res.body = body; }, readBody: async () => ({}), readSession: () => session, requireAdmin: () => false, isTrainer: () => false,
    proofStore: {}, origin: 'http://x', newSsoSession: () => ({}), rateLimit: () => true, fetchImpl, log: { warn: m => warns.push(m), error() {} },
  });
}

function setup({ mode, kind = 'baseline', down = false, link = true }) {
  const user = { id: 'u1', personId: PERSON, platformEnforcement: mode, authLevel: 'home', ...(link ? { platformLink: { state: 'active' } } : {}) };
  const warns = [], state = { calls: 0 };
  const platform = build({ user, session: user, down, kind, warns, state });
  const run = async key => {
    const res = {}, req = { headers: { cookie: '2j_member=x' }, method: key.split(' ')[0], homeSession: { uid: user.id } };
    const passed = await platform.gate(req, res, key);
    return { passed, status: res.status, body: res.body };
  };
  return { run, state, warns };
}

test('legacy + home: passes without consulting Platform, even when Platform is down', async () => {
  const s = setup({ mode: 'legacy', down: true });
  for (const key of [GATED, MEMBER, FREE]) assert.equal((await s.run(key)).passed, true, key);
  assert.equal(s.state.calls, 0);
});

test('shadow + home: never blocks, logs the divergence', async () => {
  const s = setup({ mode: 'shadow' });
  const r = await s.run(GATED);
  assert.equal(r.passed, true); assert.equal(r.status, undefined);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.ok(s.warns.some(w => /shadow divergence/.test(w) && w.includes('route=POST /api/scan/start')), s.warns.join('|'));
  const down = setup({ mode: 'shadow', down: true });
  assert.equal((await down.run(GATED)).passed, true);
});

test('enforced + home: capability granted passes, baseline-only denied with capability_required', async () => {
  const full = setup({ mode: 'enforced', kind: 'full' });
  assert.equal((await full.run(GATED)).passed, true);
  const base = setup({ mode: 'enforced', kind: 'baseline' });
  const denied = await base.run(GATED);
  assert.equal(denied.passed, false); assert.equal(denied.status, 403); assert.equal(denied.body.code, 'capability_required');
  assert.equal((await base.run(FREE)).passed, true);
  assert.equal((await base.run(MEMBER)).passed, true);
});

test('enforced + home + Platform unavailable: 403 platform_unavailable when the route needs more than the free baseline', async () => {
  const s = setup({ mode: 'enforced', down: true });
  const denied = await s.run(GATED);
  assert.equal(denied.passed, false); assert.equal(denied.status, 403); assert.equal(denied.body.code, 'platform_unavailable');
  assert.equal((await s.run(FREE)).passed, true, 'free baseline is preserved under degradation');
});

test('enforced + home without an active link is denied with platform_link_inactive', async () => {
  const r = await setup({ mode: 'enforced', link: false }).run(GATED);
  assert.equal(r.status, 403); assert.equal(r.body.code, 'platform_link_inactive');
});

test('gymsid session is unchanged: enforced + Platform down keeps capability_required', async () => {
  const user = { id: 'u1', personId: PERSON, platformEnforcement: 'enforced', platformLink: { state: 'active' } };
  const platform = build({ user, session: user, down: true });
  const res = {};
  assert.equal(await platform.gate({ headers: { cookie: 'gymsid=abc' }, method: 'POST' }, res, GATED), false);
  assert.equal(res.status, 403); assert.equal(res.body.code, 'capability_required');
});

test('sso session is unchanged: passkey-only route is still passkey_required', async () => {
  const user = { id: 'u1', personId: PERSON, authLevel: 'sso', platformEnforcement: 'legacy' };
  const platform = build({ user, session: user, client: false });
  const res = {};
  assert.equal(await platform.gate({ headers: { cookie: 'gymsid=abc' }, method: 'GET' }, res, 'GET /api/me/passkeys'), false);
  assert.equal(res.body.code, 'passkey_required');
});

test('home session without a uid stays anonymous: the gate does not apply', async () => {
  const user = { id: 'u1', personId: PERSON, platformEnforcement: 'enforced' };
  const platform = build({ user, session: null, client: false });
  assert.equal(await platform.gate({ headers: { cookie: '2j_member=x' }, method: 'POST' }, {}, GATED), true);
});
