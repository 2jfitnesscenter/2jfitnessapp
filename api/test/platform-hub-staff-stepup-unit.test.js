// F9o · Unit tests of the staff step-up (2JHub contract §11): the binding, the closed list, expiry of intents and grants (5 min, injected clock),
// and that nothing exists with the switch off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { HUB_STAFF_STEPUP, parseHubEnv } from '../platform-hub/config.js';
import { STAFF_STEPUP_ROUTES, bindingOf, createHubStaffStepup } from '../platform-hub/staff-stepup.js';

const boss = { id: 'u-boss', authLevel: 'sso', staffSso: true, platformStaffLink: { state: 'active', personId: '11111111-1111-4111-8111-111111111111' } };

test('lista cerrada: 6 rutas, sin recovery-link ni me/delete', () => {
  assert.deepEqual([...STAFF_STEPUP_ROUTES].sort(), [
    'POST /api/admin/invites/new', 'POST /api/admin/invites/revoke', 'POST /api/admin/user/disable',
    'POST /api/admin/user/role', 'POST /api/admin/user/trainer', 'POST /api/logout/all',
  ]);
  assert.ok(!STAFF_STEPUP_ROUTES.includes('POST /api/admin/user/recovery-link'));
  assert.ok(!STAFF_STEPUP_ROUTES.includes('POST /api/me/delete'));
});

test('el vínculo cambia con la acción, el objetivo, el rol pedido y cualquier campo; ignora lo que el manejador no lee', () => {
  const h = (a, b) => bindingOf(a, b, boss).bindingHash;
  const base = h('user_role', { id: 'u-1', role: 'trainer' });
  assert.equal(base, h('user_role', { id: 'u-1', role: 'trainer', extra: 'ignorado' }));
  assert.notEqual(base, h('user_role', { id: 'u-1', role: 'admin' }));
  assert.notEqual(base, h('user_role', { id: 'u-2', role: 'trainer' }));
  assert.notEqual(base, h('user_trainer', { id: 'u-1', trainer: true }));
  assert.notEqual(h('user_disable', { id: 'u-1', disabled: true }), h('user_disable', { id: 'u-1', disabled: false }));
  // Un id que no es texto no se parece a ninguno (los manejadores comparan con ===).
  assert.notEqual(h('user_role', { id: 1, role: 'trainer' }), h('user_role', { id: '1', role: 'trainer' }));
  // La invitación se ata a su código (sin guardarlo en claro) y sin distinguir mayúsculas, como el manejador.
  assert.equal(h('invite_revoke', { code: 'abcd' }), h('invite_revoke', { code: 'ABCD' }));
  assert.ok(!JSON.stringify(bindingOf('invite_revoke', { code: 'ABCD' }, boss).target).includes('ABCD'));
  assert.equal(bindingOf('logout_all', {}, boss).target, 'u-boss');
});

test('apagado por defecto y sin el interruptor de roles no se enciende', () => {
  const env = { PLATFORM_TRAINING_BRIDGE_ENABLED: 'true', PLATFORM_SSO_ENABLED: 'true' };
  assert.equal(parseHubEnv(env).staffStepupEnabled, false);
  assert.equal(parseHubEnv({ ...env, PLATFORM_HUB_STAFF_STEPUP_ENABLED: 'true' }).staffStepupEnabled, false);
  assert.equal(parseHubEnv({ ...env, PLATFORM_HUB_STAFF_ROLES_ENABLED: 'true' }).staffStepupEnabled, false);
  assert.equal(parseHubEnv({ ...env, PLATFORM_HUB_STAFF_ROLES_ENABLED: 'true', PLATFORM_HUB_STAFF_STEPUP_ENABLED: 'true' }).staffStepupEnabled, true);
  const off = createHubStaffStepup({ hub: { staffStepupEnabled: false }, db: { users: [] }, saveDb() {}, secEvent() {}, json() {}, readBody: async () => ({}), readSession: () => boss, isEnvAdmin: () => false, rateLimit: {} });
  assert.deepEqual(off.routes, {});
  assert.equal(off.stepUp.offered({ headers: {} }, 'POST /api/admin/user/role'), false);
});

test('un permiso caducado (5 min) no abre nada', async () => {
  let t = 1_000_000;
  const m = createHubStaffStepup({ hub: { staffStepupEnabled: true }, db: { users: [] }, saveDb() {}, secEvent() {}, json() {}, readBody: async () => ({ id: 'u-1', role: 'trainer' }), readSession: () => boss, isEnvAdmin: () => false, rateLimit: {}, now: () => t });
  const req = Object.assign(new EventEmitter(), { headers: { cookie: 'gymsid=abc' } });
  const { createHash } = await import('node:crypto');
  const key = createHash('sha256').update('abc').digest('base64url');
  const grant = { userId: 'u-boss', action: 'user_role', bindingHash: bindingOf('user_role', { id: 'u-1', role: 'trainer' }, boss).bindingHash };
  m.grantsForTests.set(key, { ...grant, expiresAt: t + HUB_STAFF_STEPUP.grantMs });
  t += HUB_STAFF_STEPUP.grantMs;   // justo al caducar
  assert.equal(await m.stepUp.admits(req, 'POST /api/admin/user/role'), false);
  m.grantsForTests.set(key, { ...grant, expiresAt: t + 1000 });
  assert.equal(await m.stepUp.admits(req, 'POST /api/admin/user/role'), true);
  assert.equal(await m.stepUp.admits(req, 'POST /api/admin/user/role'), false, 'un solo uso');
  // ADMIN_UIDS o una sesión con la passkey de Búnker: nunca.
  const env = createHubStaffStepup({ hub: { staffStepupEnabled: true }, db: { users: [] }, saveDb() {}, secEvent() {}, json() {}, readBody: async () => ({}), readSession: () => boss, isEnvAdmin: () => true, rateLimit: {}, now: () => t });
  assert.equal(env.stepUp.offered(req, 'POST /api/admin/user/role'), false);
  const pk = createHubStaffStepup({ hub: { staffStepupEnabled: true }, db: { users: [] }, saveDb() {}, secEvent() {}, json() {}, readBody: async () => ({}), readSession: () => ({ ...boss, authLevel: 'passkey' }), isEnvAdmin: () => false, rateLimit: {}, now: () => t });
  assert.equal(pk.stepUp.offered(req, 'POST /api/admin/user/role'), false);
});
