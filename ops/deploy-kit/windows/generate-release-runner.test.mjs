import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedPostTargetPath, renderTemplate, validateConfig, validateWebPushSubscriptionWiring, verifyRegression } from './generate-release-runner.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8')
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const restAlert = JSON.parse(fs.readFileSync(path.join(here, '../releases/android-rest-alert.json'), 'utf8'))
const trainingQuality = JSON.parse(fs.readFileSync(path.join(here, '../releases/training-quality-review.json'), 'utf8'))

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

test('release deltas may include only versioned deploy-kit paths, while source probes stay app-scoped', () => {
  assert.doesNotThrow(() => validateConfig({ ...base, deltaPaths: ['ops/deploy-kit/windows/generate-release-runner.mjs'] }))
  assert.throws(() => validateConfig({ ...base, deltaPaths: ['ops/unreviewed/anything.sh'] }), /INVALID_EXACT_DELTA_PATHS/)
  assert.throws(() => validateConfig({ ...base, probes: { ...base.probes, sourceFiles: ['ops/deploy-kit/server/2j-deploy-run'] } }), /INVALID_PROBE_PATH/)
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

test('no-Origin Web Push subscribe probe requires exact 403 and rejects every other status', () => {
  const subscribe = trainingQuality.probes.unauthenticatedRoutes.find(r => r.method === 'POST' && r.path === '/api/push/subscribe')
  assert.deepEqual(subscribe, { method: 'POST', expectUnauthenticated: true, status: 403, path: '/api/push/subscribe' })
  const rendered = renderTemplate(template, trainingQuality)
  assert.match(rendered, /wait_status 403 'https:\/\/app\.2jfitnesscenter\.com\/api\/push\/subscribe'/)

  for (const status of [200, 401, 500, 503]) {
    const probes = trainingQuality.probes.unauthenticatedRoutes.map(r => r.path === '/api/push/subscribe' ? { ...r, status } : r)
    assert.throws(
      () => validateConfig({ ...trainingQuality, probes: { ...trainingQuality.probes, unauthenticatedRoutes: probes } }),
      /NO_ORIGIN_PUSH_PROBE_MUST_MATCH_CONTRACT_403/,
    )
  }
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

test('post-target commits allow deploy tooling, handoff, line-ending metadata, and the test-only timeout harness fix', () => {
  assert.equal(isAllowedPostTargetPath('ops/deploy-kit/windows/generate-release-runner.mjs'), true)
  assert.equal(isAllowedPostTargetPath('AI_HANDOFF.md'), true)
  assert.equal(isAllowedPostTargetPath('.gitattributes'), true)
  assert.equal(isAllowedPostTargetPath('frontend/src/views/adaptive.test.jsx'), true)
  assert.equal(isAllowedPostTargetPath('frontend/src/views/Home.jsx'), false)
  assert.equal(isAllowedPostTargetPath('frontend/src/store/useUI.js'), false)
  assert.ok(template.includes("$_ -ne 'frontend/src/views/adaptive.test.jsx'"), 'PrepareOnly must allow only this post-target test-only file')
  assert.ok(template.includes("$_ -ne '.gitattributes'"), 'PrepareOnly must apply the same narrow allowlist')
})

test('timeout retry uses the supported single-worker Vitest option', () => {
  assert.ok(template.includes('npx vitest run --maxWorkers=1 --reporter=json'))
  assert.ok(!template.includes('--minWorkers='))
})

test('PrepareOnly resolves Git Bash from the Git root captured before PATH changes', () => {
  assert.ok(template.includes("$Bash = Join-Path $GitForTests 'bin\\bash.exe'"))
  assert.ok(!template.includes('$GitExe = (Get-Command git.exe -ErrorAction Stop).Source'))
})

test('Web Push subscription persistence checks the current route, upsert wiring and integration contract', () => {
  const files = ['api/server.js', 'api/lib/rest-alerts.js', 'api/test/rest-alert-routes.test.js']
  const sources = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.resolve(here, '../../../', file), 'utf8')]))
  assert.deepEqual(validateWebPushSubscriptionWiring(sources), { ok: true, missing: [] })

  const unwired = { ...sources, 'api/server.js': sources['api/server.js'].replace('upsertPushSubscription(db, sub)', 'saveSubscription(db, sub)') }
  const failed = validateWebPushSubscriptionWiring(unwired)
  assert.equal(failed.ok, false)
  assert.deepEqual(failed.missing, [{ file: 'api/server.js', marker: 'upsertPushSubscription(db, sub)' }])

  const rendered = renderTemplate(template, base)
  assert.ok(rendered.includes("grep -Fq 'upsertPushSubscription(db, sub)' \"$RELEASE_CHECK_DIR/api/server.js\""))
  assert.ok(rendered.includes("grep -Fq 'assert.equal(db.subs.length, 1)' \"$RELEASE_CHECK_DIR/api/test/rest-alert-routes.test.js\""))
  assert.ok(!rendered.includes('grep -Fq "db.subs.push"'))
  const stale = template.replace('@@WEB_PUSH_SUBSCRIPTION_PROBE@@', 'grep -Fq "db.subs.push" "$RELEASE_CHECK_DIR/api/server.js"')
  assert.throws(() => renderTemplate(stale, base), /STALE_WEB_PUSH_SUBSCRIPTION_PROBE/)
})

test('release protocol probe follows the guarded Notification API adapter', () => {
  assert.ok(template.includes('const notificationApi = () => globalThis.Notification || globalThis.window?.Notification'))
  assert.ok(template.includes("grep -Fq 'pushSupported'"))
  assert.ok(!template.includes('Notification.permission'))
})

test('release protocol probes the program-level review routes without pinning an obsolete import list', () => {
  assert.ok(template.includes("grep -Fq 'markProgramReviewed' \"$RELEASE_CHECK_DIR/api/server.js\""))
  assert.ok(template.includes("grep -Fq 'setProgramCycleDates' \"$RELEASE_CHECK_DIR/api/server.js\""))
  assert.ok(!template.includes("import { markReviewed, setCycleDates, routineReviews }"))
})
