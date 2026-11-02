import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRoute, routePolicyForTests } from '../platform-sso/route-policy.js';

const keysByKind = kind => routePolicyForTests.exactKeys.filter(k => classifyRoute(k).kind === kind);

test('homeAllowed is a boolean on every classification', () => {
  for (const key of [...routePolicyForTests.exactKeys, 'GET /api/social/feed', 'GET /api/nope']) assert.equal(typeof classifyRoute(key).homeAllowed, 'boolean', key);
});

test('homeAllowed is false for every staff route, exact or by prefix', () => {
  for (const key of keysByKind('staff')) assert.equal(classifyRoute(key).homeAllowed, false, key);
  for (const key of ['GET /api/admin/users', 'POST /api/trainer/x', 'GET /api/center/x', 'POST /api/guided/x', 'GET /api/shared-staff/x', 'GET /api/blocks']) assert.equal(classifyRoute(key).homeAllowed, false, key);
});

test('homeAllowed is false for passkey-only (not ssoAllowed) and kiosk routes', () => {
  for (const key of routePolicyForTests.exactKeys) {
    const policy = classifyRoute(key);
    if (!policy.ssoAllowed || policy.kind === 'kiosk') assert.equal(policy.homeAllowed, false, key);
  }
});

test('homeAllowed is false for identity, passkey, step-up, destructive and third-party routes', () => {
  for (const key of ['GET /api/me/passkeys', 'POST /api/me/delete', 'POST /api/me/delete/options', 'GET /api/me/export', 'POST /api/logout/all', 'POST /api/me/sessions/revoke',
    'POST /api/coach/forget', 'POST /api/login/options', 'POST /api/login/verify', 'POST /api/register/options', 'POST /api/recover/x', 'POST /api/link/x', 'POST /api/me/step-up/options',
    'GET /api/me/passkeys/x', 'GET /api/whoop/x', 'GET /api/strava/x', 'GET /api/me/sessions', 'GET /api/me/security-events', 'POST /api/me/username', 'POST /api/me/avatar', 'POST /api/logout']) {
    assert.equal(classifyRoute(key).homeAllowed, false, key);
  }
});

test('homeAllowed is true for member read routes and member-level gated routes', () => {
  for (const key of ['GET /api/social/feed', 'GET /api/friends', 'GET /api/chat/x', 'GET /api/notifications', 'GET /api/news', 'GET /api/media/x', 'GET /api/data', 'GET /api/sync', 'GET /api/guided', 'GET /api/me', 'GET /api/followup']) {
    assert.equal(classifyRoute(key).homeAllowed, true, key);
  }
});

test('homeAllowed implies ssoAllowed for every exact route (home is never wider than sso)', () => {
  for (const key of routePolicyForTests.exactKeys) { const p = classifyRoute(key); if (p.homeAllowed) assert.equal(p.ssoAllowed, true, key); }
});

test('ssoAllowed is unchanged for the known routes', () => {
  assert.equal(classifyRoute('GET /api/data').ssoAllowed, true);
  assert.equal(classifyRoute('POST /api/me/username').ssoAllowed, true);
  assert.equal(classifyRoute('GET /api/me/passkeys').ssoAllowed, false);
  assert.equal(classifyRoute('GET /api/admin/users').ssoAllowed, false);
});

test('pre-session and kiosk routes are marked homeAnonymous; member routes are not', () => {
  for (const key of ['POST /api/login/options', 'POST /api/login/verify', 'POST /api/register/options', 'POST /api/recover/x', 'GET /api/link/x', 'POST /api/me/step-up/options',
    'POST /api/bunker/checkin', 'GET /api/bunker/session', 'GET /api/bunker/board', 'POST /api/bunker/active', 'GET /api/shared-staff/x', 'GET /api/shared-device/status', 'POST /api/shared-staff/pin/options']) {
    assert.equal(classifyRoute(key).homeAnonymous, true, key);
  }
  for (const key of ['GET /api/data', 'GET /api/me', 'GET /api/social/feed', 'GET /api/me/passkeys', 'GET /api/admin/users', 'GET /api/bunker/pin']) {
    assert.equal(Boolean(classifyRoute(key).homeAnonymous), false, key);
  }
});
