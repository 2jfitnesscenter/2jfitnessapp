import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { CAPABILITIES_V2, CAPABILITIES_V21, baselineCapabilities, createCapabilitiesService, degradedView } from '../platform-sso/capabilities.js';
import { parsePlatformIntegrationEnv } from '../platform-sso/index.js';
import { applyStatePolicy } from '../platform-sso/state-policy.js';
import { classifyRoute } from '../platform-sso/route-policy.js';
import { snapshot21, PERSON, USER, NOW, http } from './capabilities-corpus.mjs';

const SECRET = crypto.randomBytes(32).toString('base64url');
const env = extra => ({ PLATFORM_API_BASE_URL: 'http://127.0.0.1:3100', PLATFORM_API_KEY_ID: 'bunker-1', PLATFORM_API_KEY_SECRET: SECRET, ...extra });

test('the contract is V2 unless the operator opts in to V2.1; anything else falls back to V2', () => {
  assert.equal(parsePlatformIntegrationEnv(env({})).client.contract, CAPABILITIES_V2);
  assert.equal(parsePlatformIntegrationEnv(env({ PLATFORM_CAPABILITIES_CONTRACT: CAPABILITIES_V21 })).client.contract, CAPABILITIES_V21);
  for (const value of ['', 'V2.1', '2J-CAPABILITIES-V3', '2j-capabilities-v2.1', ' 2J-CAPABILITIES-V2.1']) assert.equal(parsePlatformIntegrationEnv(env({ PLATFORM_CAPABILITIES_CONTRACT: value })).client.contract, CAPABILITIES_V2, JSON.stringify(value));
});

test('a V2.1 service asks the versioned path and signs exactly that path; a V2 service keeps asking the V2 path', async () => {
  for (const [contract, segment] of [[CAPABILITIES_V21, 'v2.1'], [CAPABILITIES_V2, 'v2']]) {
    const asked = [];
    const service = createCapabilitiesService({ config: { baseUrl: 'http://127.0.0.1:3100', keyId: 'bunker-1', secret: SECRET, contract }, now: () => NOW,
      fetchImpl: async (url, init) => { asked.push({ path: new URL(url).pathname, headers: init.headers }); return http(200, snapshot21('baseline', contract === CAPABILITIES_V21 ? {} : { contract: CAPABILITIES_V2, revision: undefined })); } });
    await service.evaluate({ personId: PERSON, id: USER }, { mode: 'enforced' });
    assert.equal(asked[0].path, `/api/internal/platform/${segment}/persons/${PERSON}/training-capabilities`);
    assert.ok(asked[0].headers['x-2j-signature']);
  }
});

test('the V2.1 free baseline opens Entrena con 2J, Premium and Oposiciones but not the AI coach or professional follow-up (D40, D41)', async () => {
  const service = createCapabilitiesService({ config: { baseUrl: 'http://127.0.0.1:3100', keyId: 'bunker-1', secret: SECRET, contract: CAPABILITIES_V21 }, now: () => NOW, fetchImpl: async () => http(200, snapshot21('baseline-unlinked')) });
  const view = await service.evaluate({ personId: PERSON, id: USER }, { mode: 'enforced' });
  assert.equal(view.verified, true);
  for (const [route, capability, expected] of [['GET /api/guided', 'guidedTraining', true], ['GET /api/premium', 'premiumPrograms', true], ['GET /api/opposition', 'premiumPrograms', true], ['POST /api/scan/start', 'aiCoach', false], ['GET /api/exercises/search', null, true]]) {
    const policy = classifyRoute(route);
    if (capability) { assert.deepEqual(policy.capabilities, [capability], route); assert.equal(service.allows(view, policy.capabilities), expected, route); }
  }
  assert.equal(view.capabilities.professionalFollowUp, false);
});

test('degraded mode (Platform unreachable) grants the baseline OF THE CONTRACT: V2.1 includes guided and premium, V2 does not; a known restriction still blocks', () => {
  const v2 = degradedView({ mode: 'enforced', contract: CAPABILITIES_V2 }), v21 = degradedView({ mode: 'enforced', contract: CAPABILITIES_V21 });
  assert.equal(v2.capabilities.guidedTraining, false); assert.equal(v21.capabilities.guidedTraining, true);
  assert.equal(v2.capabilities.premiumPrograms, false); assert.equal(v21.capabilities.premiumPrograms, true);
  assert.deepEqual(Object.keys(baselineCapabilities(CAPABILITIES_V21)).filter(key => baselineCapabilities(CAPABILITIES_V21)[key]).sort(), ['autonomousTraining', 'guidedTraining', 'personalRoutineCreation', 'personalRoutineManagement', 'premiumPrograms', 'workoutHistory', 'workoutRecording']);
  assert.equal(baselineCapabilities().guidedTraining, false, 'the default is the V2 baseline');
  for (const contract of [CAPABILITIES_V2, CAPABILITIES_V21]) {
    const blocked = degradedView({ mode: 'enforced', contract, restriction: { reasonCode: 'ADMIN_SUSPENDED' } });
    assert.equal(blocked.level, 'blocked'); assert.equal(Object.values(blocked.capabilities).some(Boolean), false);
  }
  assert.equal(degradedView({ mode: 'legacy', contract: CAPABILITIES_V21 }), null, 'a legacy user with nothing known is still left alone (A23)');
});

test('state policy with the V2.1 baseline: a free registered user keeps Premium and guided programs, the AI coach data is still protected', () => {
  const caps = baselineCapabilities(CAPABILITIES_V21);
  const current = { premium: { v: 1, active: null, history: [] }, programs: [] };
  const incoming = { premium: { v: 1, active: { id: 'inst', week: 1 }, history: [] }, programs: [{ id: 'g1', name: 'Guiada', source: 'guided-v2', status: 'active', weeks: [], routineIds: [] }], coach: { consent: { agreedAt: '2026-10-23T00:00:00.000Z', version: 1 }, profile: { goal: 'muscle' } } };
  const result = applyStatePolicy({ current, incoming, caps });
  assert.deepEqual(result.state.premium, incoming.premium, 'Premium is free (D41)');
  assert.equal(result.state.programs.length, 1, 'guided programs are free (D40)');
  assert.ok(result.stripped.includes('state.coach'), 'the AI coach (aiCoach) stays paid');
  const v2 = applyStatePolicy({ current, incoming, caps: baselineCapabilities(CAPABILITIES_V2) });
  assert.ok(v2.stripped.includes('state.premium'), 'under V2 the same write is still refused');
});
