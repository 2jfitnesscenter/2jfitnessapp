import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedPostTargetPath, renderTemplate, validateConfig, verifyRegression } from './generate-release-runner.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8')
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const restAlert = JSON.parse(fs.readFileSync(path.join(here, '../releases/android-rest-alert.json'), 'utf8'))
const megasprint = JSON.parse(fs.readFileSync(path.join(here, '../releases/megasprint-2026-10-07.json'), 'utf8'))

test('derives short SHAs and emits full SHA values independently', () => {
  const rendered = renderTemplate(template, base)
  assert.ok(rendered.includes(`$Commit = '${base.targetCommit}'`))
  assert.ok(rendered.includes(`$ExpectedCurrentCommit = '${base.expectedCurrentCommit}'`))
  assert.ok(rendered.includes(`$RollbackCommit = '${base.rollbackCommit}'`))
  assert.ok(rendered.includes('TARGET_COMMIT=__TARGET_COMMIT__'))
  assert.ok(rendered.includes('ROLLBACK_COMMIT=__ROLLBACK_COMMIT__'))
  assert.ok(!rendered.includes('@@'))
})

test('historical short-SHA substitution never creates the known hybrid SHA', () => {
  const rendered = verifyRegression(template)
  assert.ok(rendered.includes("$Commit = '16a1bb779140cd28020551bf16c0628f88b46f4f'"))
  assert.ok(!rendered.includes('TARGET_COMMIT=16a1bb7bc5584c345d91727e93007fd6f8750b76'))
})

test('rejects malformed, equal, or inconsistent SHA inputs', () => {
  assert.throws(() => validateConfig({ ...base, targetCommit: '831f691' }), /INVALID_FULL_SHA40/)
  assert.throws(() => validateConfig({ ...base, expectedCurrentCommit: base.targetCommit }), /TARGET_MUST_DIFFER/)
  assert.throws(() => validateConfig({ ...base, rollbackCommit: 'a'.repeat(40) }), /ROLLBACK_MUST_EQUAL/)
})

test('rejects missing/duplicate delta paths and malformed probes', () => {
  assert.throws(() => validateConfig({ ...base, deltaPaths: ['api/server.js', 'api/server.js'] }), /INVALID_EXACT_DELTA/)
  assert.throws(() => validateConfig({ ...base, probes: { ...base.probes, sourceFiles: ['../../secret'] } }), /INVALID_PROBE_PATH/)
  assert.throws(() => validateConfig({ ...base, probes: { ...base.probes, unauthenticatedRoutes: [{ method: 'DELETE', path: '/api/x', status: 401 }] } }), /INVALID_UNAUTHENTICATED_ROUTE/)
})

test('all no-credential PIN probes require the exact contract status 403', () => {
  for (const routePath of ['/api/shared-device/pin', '/api/shared-staff/pin']) {
    const pinRoute = base.probes.unauthenticatedRoutes.find(r => r.path === routePath)
    assert.equal(pinRoute?.method, 'POST')
    assert.equal(pinRoute?.status, 403)
    for (const badStatus of [401, 404, 429]) {
      assert.throws(() => validateConfig({ ...base, probes: { ...base.probes, unauthenticatedRoutes: base.probes.unauthenticatedRoutes.map(r => r.path === routePath ? { ...r, status: badStatus } : r) } }), new RegExp(`SHARED_PIN_PROBE_MUST_MATCH_CONTRACT_403:${routePath.replaceAll('/', '\\/')}`))
    }
  }
  const rendered = renderTemplate(template, base)
  assert.ok(rendered.includes("wait_status 403 'https://app.2jfitnesscenter.com/api/shared-device/pin'"))
  assert.ok(rendered.includes("wait_status 403 'https://app.2jfitnesscenter.com/api/shared-staff/pin'"))
})

test('rejects contradictory exact statuses across unauthenticated PIN boundaries', () => {
  const conflicting = base.probes.unauthenticatedRoutes.map(r => r.path === '/api/shared-staff/pin' ? { ...r, status: 401 } : r)
  assert.throws(() => validateConfig({ ...base, probes: { ...base.probes, unauthenticatedRoutes: conflicting } }), /SHARED_PIN_PROBE_MUST_MATCH_CONTRACT_403/)
  const missing = base.probes.unauthenticatedRoutes.filter(r => r.path !== '/api/shared-staff/pin')
  assert.throws(() => validateConfig({ ...base, probes: { ...base.probes, unauthenticatedRoutes: missing } }), /SHARED_PIN_PROBE_MUST_MATCH_CONTRACT_403/)
})

test('emits only configured Shared Staff technical source and unauthenticated probes', () => {
  const rendered = renderTemplate(template, base)
  for (const marker of ['RELEASE_PROBES_SOURCE=OK files=5 markers=7', 'SHARED_STAFF_SMOKE=OK', '/api/shared-device/status', '/api/admin/shared-devices', 'IDLE_MS = 15 * 60_000']) assert.ok(rendered.includes(marker), marker)
  for (const route of base.probes.unauthenticatedRoutes.filter(r => r.path.startsWith('/api/shared-') || r.path.startsWith('/api/admin/shared-'))) {
    assert.ok(rendered.includes(`SHARED_STAFF_PROBE route=${route.path} method=${route.method} expected=${route.status}`))
  }
})

test('Shared Staff smoke summary prints actual HTTP statuses, not literal variable names', () => {
  const rendered = renderTemplate(template, base)
  const summary = rendered.split(/\r?\n/).find(line => line.includes('SHARED_STAFF_SMOKE=OK unauthenticated_statuses='))
  assert.ok(summary)
  assert.match(summary, /\/api\/shared-device\/status=%s/)
  assert.match(summary, /\/api\/shared-device\/pin=%s/)
  assert.match(summary, /"\$SHARED_ROUTE_1_STATUS"/)
  assert.match(summary, /"\$SHARED_ROUTE_7_STATUS"/)
  assert.doesNotMatch(summary, /unauthenticated_statuses=\["\$SHARED_ROUTE_1_STATUS"/)
})

test('Android rest alert release is exact-target and keeps Shared Staff probes', () => {
  assert.equal(restAlert.targetCommit, 'cca6dc4137afb28e4df823f229e939933efeae78')
  assert.equal(restAlert.expectedCurrentCommit, '831f691ca1b30a9c252bb60e8336d93edf448114')
  assert.equal(restAlert.rollbackCommit, restAlert.expectedCurrentCommit)
  assert.equal(restAlert.expectedFrontendTests, 1417)
  assert.deepEqual(restAlert.deltaPaths.sort(), [
    'AI_HANDOFF.md', 'CHANGELOG.md', 'docs/ANDROID_REST_ALERT_QA.md',
    'frontend/src/components/WorkoutGuide.jsx', 'frontend/src/lib/rest-notification.js',
    'frontend/src/lib/rest-notification.test.js', 'frontend/src/locales/es.js',
    'frontend/src/store/useUI.js', 'frontend/src/views/TrainingSettings.jsx',
    'frontend/src/views/Workout.test.jsx',
  ].sort())
  assert.equal(validateConfig(restAlert).targetShort, 'cca6dc4')
  const rendered = renderTemplate(template, restAlert)
  for (const marker of [
    'export const REST_NOTIFICATION_ID = 20261006', 'allowWhileIdle: true',
    'setRestAlertPreference(enabled)', 'setRestAlertPreference(v)',
    'route=/api/shared-device/pin method=POST expected=403',
    'route=/api/shared-staff/pin method=POST expected=403',
  ]) assert.ok(rendered.includes(marker), marker)
})

test('post-target commits allow only deploy tooling and exact release documentation paths', () => {
  assert.equal(isAllowedPostTargetPath('ops/deploy-kit/windows/generate-release-runner.mjs'), true)
  assert.equal(isAllowedPostTargetPath('AI_HANDOFF.md'), true)
  assert.equal(isAllowedPostTargetPath('.gitattributes'), true)
  assert.equal(isAllowedPostTargetPath('frontend/src/store/useUI.js'), false)
  assert.ok(template.includes("'docs/GENERATED_FILES.md'"), 'PrepareOnly must apply the same narrow allowlist')
})

test('megasprint release manifest is exact production delta with all safety probes', () => {
  assert.equal(megasprint.targetCommit, '8458b54f51cd074c63c0623c9192f63f5f6f6f2a')
  assert.equal(megasprint.expectedCurrentCommit, '4230b17f3b4f9703f4706df9df65f36315e21eff')
  assert.equal(megasprint.rollbackCommit, megasprint.expectedCurrentCommit)
  assert.equal(megasprint.expectedFrontendTests, 1445)
  assert.equal(megasprint.expectedApiTests, 450)
  assert.equal(megasprint.expectedApiPassed, 450)
  assert.equal(megasprint.expectedApiSkipped, 0)
  assert.equal(validateConfig(megasprint).targetShort, '8458b54')
  const rendered = renderTemplate(template, megasprint)
  for (const marker of [
    'export function buildTrainer(S, uid, brief = {})',
    'export const countsForProgression',
    'export function setWorkoutExcluded',
    '2j-followup-private-v1',
    'db.subs = db.subs || [];',
    'vapid.json',
    'notificationApi().permission',
    'notifications.permission',
    'https://app.2jfitnesscenter.com/api/push/public-key',
    'https://app.2jfitnesscenter.com/api/data',
    'https://app.2jfitnesscenter.com/api/sync'
  ]) assert.ok(rendered.includes(marker), marker)
})
