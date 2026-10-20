import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isAllowedPostTargetPath, isRepositoryOnlyPath, renderTemplate, validateConfig, validateNodeTestSummary, validateWebPushSubscriptionWiring, verifyRegression } from './generate-release-runner.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8')
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const restAlert = JSON.parse(fs.readFileSync(path.join(here, '../releases/android-rest-alert.json'), 'utf8'))
const trainingQuality = JSON.parse(fs.readFileSync(path.join(here, '../releases/training-quality-review.json'), 'utf8'))

test('deploy tooling TAP summary accepts a valid variable test total and allowed skips', () => {
  const output = '# tests 55\n# pass 55\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n'
  assert.deepEqual(validateNodeTestSummary(output, 0), {
    ok: true, reason: 'OK', summary: { tests: 55, pass: 55, fail: 0, cancelled: 0, skipped: 0, todo: 0 },
  })
  assert.equal(validateNodeTestSummary('# tests 3\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 1\n# todo 1\n', 0).ok, true)
  assert.equal(validateNodeTestSummary('ℹ tests 55\nℹ pass 55\nℹ fail 0\nℹ cancelled 0\nℹ skipped 0\nℹ todo 0\n', 0).ok, true)
})

test('deploy tooling TAP summary rejects failures, nonzero exit, and malformed or empty output', () => {
  assert.equal(validateNodeTestSummary('# tests 2\n# pass 1\n# fail 1\n# cancelled 0\n', 0).ok, false)
  assert.equal(validateNodeTestSummary('# tests 1\n# pass 1\n# fail 0\n# cancelled 0\n', 1).reason, 'NONZERO_EXIT:1')
  assert.equal(validateNodeTestSummary('', 0).ok, false)
  assert.equal(validateNodeTestSummary('all good', 0).ok, false)
  assert.equal(validateNodeTestSummary('# tests 0\n# pass 0\n# fail 0\n# cancelled 0\n', 0).ok, false)
  assert.equal(validateNodeTestSummary('# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n', 0).reason, 'INCONSISTENT_TEST_COUNTS')
})

test('generated runner validates tooling TAP summary structurally without a pinned count', () => {
  const rendered = renderTemplate(template, base)
  const call = rendered.match(/Invoke-Checked 'DEPLOY_TOOLING_TESTS'[^\r\n]*/)?.[0]
  assert.ok(call)
  assert.doesNotMatch(call, /tests\s+\d+|pass\s+\d+|fail\s+0/)
  assert.match(rendered, /--validate-node-test-summary/)
  assert.doesNotMatch(call, /tests 54/)
})

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

test('API image feature probe validates FEATURE_KEYS structure without a stale fixed count', () => {
  const start = template.indexOf('if (!Array.isArray(fe.FEATURE_KEYS)')
  assert.notEqual(start, -1, 'generated API image probe must validate feature keys')
  const end = template.indexOf("throw new Error('features module wrong');", start)
  assert.notEqual(end, -1, 'feature validation must fail closed')
  const guard = template.slice(start, end + "throw new Error('features module wrong');".length)
  assert.doesNotMatch(guard, /FEATURE_KEYS\.length\s*!==\s*\d+/)
  const validate = new Function('fe', `return (() => { ${guard}; return true })()`)

  assert.equal(validate({ FEATURE_KEYS: ['coach', 'social', 'premium'] }), true)
  for (const invalid of [
    { FEATURE_KEYS: undefined },
    { FEATURE_KEYS: null },
    { FEATURE_KEYS: {} },
    { FEATURE_KEYS: [] },
    { FEATURE_KEYS: ['coach', 'coach'] },
    { FEATURE_KEYS: ['coach', ''] },
    { FEATURE_KEYS: ['coach', 1] },
  ]) assert.throws(() => validate(invalid), /features module wrong/)
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
  assert.equal(isAllowedPostTargetPath('CHANGELOG.md'), true)
  assert.equal(isAllowedPostTargetPath('docs/GENERATED_FILES.md'), true)
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

// ---- deploy marker: written by the server runner only at the very end of a SUCCESSFUL deploy -----------------------------------------
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const lf = template.replace(/\r\n?/g, '\n')
const markerBlock = lf.slice(lf.indexOf('# DEPLOY_MARKER_BEGIN'), lf.indexOf('# DEPLOY_MARKER_END'))
const repoRoot = path.resolve(here, '../../..')
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0

test('deploy marker: present once, after DEPLOY_OK and every probe, never in rollback or the error path', () => {
  assert.equal(lf.split('# DEPLOY_MARKER_BEGIN').length, 2)
  const at = lf.indexOf('# DEPLOY_MARKER_BEGIN')
  assert.ok(at > lf.indexOf("printf 'DEPLOY_OK=%s"), 'after DEPLOY_OK')
  assert.ok(at > lf.indexOf("printf 'SERVICES=OK api,web,caddy"), 'after the last probe (services)')
  assert.ok(at > lf.indexOf('trap on_error ERR'), 'in the success path, after the error trap is armed')
  assert.ok(lf.slice(lf.indexOf('# OPS_CRON_END')).startsWith('# OPS_CRON_END\nprintf \'LOG=%s\\n\' "$LOG"\n\'@'), 'the marker and the ops cron are the last things in the script, right before the final LOG line')
  assert.ok(lf.indexOf('# OPS_CRON_BEGIN') > lf.indexOf('# DEPLOY_MARKER_END'), 'the ops cron step comes after the marker')
  const rollbackFn = lf.slice(lf.indexOf('rollback() {'), lf.indexOf('trap on_error ERR'))
  assert.ok(!rollbackFn.includes('mark-deploy') && !rollbackFn.includes('DEPLOY_MARKER'), 'rollback never marks')
  assert.ok(markerBlock.includes('scripts/mark-deploy.sh') && markerBlock.includes('"$TARGET_COMMIT"'), 'reuses mark-deploy.sh with the target commit')
  assert.ok(!/\bfalse\b|\bexit\b/.test(markerBlock), 'a marker problem can never fail a good deploy')
})

function runBlock({ withScript = true, readonlyData = false } = {}) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), '2j-marker-'))
  fs.mkdirSync(path.join(app, 'scripts')); fs.mkdirSync(path.join(app, 'data'))
  if (withScript) { fs.copyFileSync(path.join(repoRoot, 'scripts/mark-deploy.sh'), path.join(app, 'scripts/mark-deploy.sh')); fs.chmodSync(path.join(app, 'scripts/mark-deploy.sh'), 0o755) }
  if (readonlyData) fs.writeFileSync(path.join(app, 'data/ops'), 'a file where the directory should be')
  const target = 'dd7897a294095a2f615cff24cfa2720bfd65d6e1'
  const script = `set -Eeuo pipefail\nAPP='${app.split(path.sep).join('/')}'\nTARGET_COMMIT=${target}\ntrap 'echo ERR_TRAP_FIRED' ERR\n${markerBlock}\necho FINISHED\n`
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
  const file = path.join(app, 'data/ops/deploy-marker.json')
  const marker = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null
  fs.rmSync(app, { recursive: true, force: true })
  return { r, marker, target }
}

test('deploy marker: a successful deploy leaves the target sha in data/ops/deploy-marker.json', { skip: !hasBash }, () => {
  const { r, marker, target } = runBlock()
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, new RegExp(`DEPLOY_MARKER=ok:${target}`)); assert.ok(r.stdout.includes('FINISHED'))
  assert.equal(marker.sha, target); assert.equal(marker.note, 'release')
})

test('deploy marker: a missing script or an unwritable ops dir is reported but never fails the deploy', { skip: !hasBash }, () => {
  for (const opt of [{ withScript: false }, { readonlyData: true }]) {
    const { r, marker } = runBlock(opt)
    assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /DEPLOY_MARKER=SKIPPED/); assert.ok(r.stdout.includes('FINISHED')); assert.ok(!r.stdout.includes('ERR_TRAP_FIRED'))
    assert.equal(marker, null)
  }
})

// ---- ops cron: the runner keeps the backup / ops-check / logrotate installed, only on the real server layout, never failing a good deploy -------
const cronBlock = lf.slice(lf.indexOf('# OPS_CRON_BEGIN'), lf.indexOf('# OPS_CRON_END'))

test('ops cron step: present once, guarded to the real server layout, non-blocking, reuses install-ops-cron.sh', () => {
  assert.equal(lf.split('# OPS_CRON_BEGIN').length, 2)
  assert.ok(cronBlock.includes('"$APP" == /opt/2jfitness') && cronBlock.includes('/etc/2j-ops.env'), 'only /opt/2jfitness with its env file (never the local simulation)')
  assert.ok(cronBlock.includes('scripts/install-ops-cron.sh'))
  assert.ok(!/\bfalse\b|\bexit\b/.test(cronBlock), 'a cron problem can never fail a good deploy')
  const rollbackFn = lf.slice(lf.indexOf('rollback() {'), lf.indexOf('trap on_error ERR'))
  assert.ok(!rollbackFn.includes('install-ops-cron') && !rollbackFn.includes('OPS_CRON'), 'rollback never installs cron')
})

test('ops cron step: outside the server layout it is skipped quietly and the deploy goes on', { skip: !hasBash }, () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), '2j-cron-'))
  const script = `set -Eeuo pipefail\nAPP='${app.split(path.sep).join('/')}'\ntrap 'echo ERR_TRAP_FIRED' ERR\n${cronBlock}\necho FINISHED\n`
  const r = spawnSync('bash', ['-c', script], { encoding: 'utf8' })
  fs.rmSync(app, { recursive: true, force: true })
  assert.equal(r.status, 0, r.stderr); assert.match(r.stdout, /OPS_CRON=SKIPPED:not_the_server_layout/); assert.ok(r.stdout.includes('FINISHED')); assert.ok(!r.stdout.includes('ERR_TRAP_FIRED'))
})

/* ---------- repository-only (non-deployable) paths: in the Git delta, never deployed ---------- */
// The real 89-path delta of the retarget 1a40473 over production 3106e4a: 76 deployable paths + 13 repository-only ones.
const DEPLOYABLE_89 = `AI_HANDOFF.md
CHANGELOG.md
api/coach/adapters/gemini.js
api/coach/ai-generate.js
api/coach/ai-run.js
api/coach/config.js
api/coach/jobs.js
api/coach/routes.js
api/coach/trainer-ai.js
api/coach/trainer-jobs.js
api/coach/trainer-routes.js
api/lib/account-erasure.js
api/lib/ai-metrics.js
api/lib/ai-vision.js
api/lib/aux-ai-config.js
api/lib/aux-ai-routes.js
api/lib/coach-followup-routes.js
api/lib/exercise-name-match.js
api/lib/exercise-notes.js
api/lib/machine-scan.js
api/lib/measurements-consensus.js
api/lib/measurements-scan.js
api/lib/routine-scan.js
api/lib/routine-validate.js
api/lib/scan-jobs.js
api/lib/scan-routes.js
api/lib/staff-ai-consent.js
api/package.json
api/platform-proof/routes.js
api/platform-proof/service-auth.js
api/platform-proof/store.js
api/scripts/ai-scan-benchmark.mjs
api/server.js
api/test/ai-reliability.test.js
api/test/ai-stability.test.js
api/test/exercise-notes.test.js
api/test/platform-proof.test.js
api/test/trainer-acl.test.js
docs/ACCOUNT_ERASURE.md
docs/AI_RELIABILITY.md
docs/CENTER_MANAGEMENT_V1.md
docs/COACH_FOLLOWUP_V3.md
docs/DATA_MAP.md
docs/HANDOFF_2J-089.md
docs/PRIVACY_POLICY.md
docs/SOCIAL_V2.md
docs/TASK_2J-089.md
frontend/src/components/DeleteAccountSheet.jsx
frontend/src/components/ScanUpload.jsx
frontend/src/components/SharedExerciseNote.jsx
frontend/src/components/StaffAiConsentSheet.jsx
frontend/src/components/coach/CoachMember.jsx
frontend/src/components/constructor/DayCanvas.jsx
frontend/src/components/shared-exercise-note.test.jsx
frontend/src/index.css
frontend/src/lib/coach-api.js
frontend/src/lib/exercise-notes.js
frontend/src/lib/legal-controller.js
frontend/src/lib/media.js
frontend/src/lib/scan-consent.js
frontend/src/lib/trainer-ai-api.js
frontend/src/lib/trainer-api.js
frontend/src/locales/es.js
frontend/src/store/useStore.js
frontend/src/views/Coach.jsx
frontend/src/views/Legal.jsx
frontend/src/views/Legal.test.jsx
frontend/src/views/Privacy.jsx
frontend/src/views/Privacy.test.jsx
frontend/src/views/Settings.jsx
frontend/src/views/Workout.jsx
frontend/src/views/trainer/Constructor.jsx
frontend/src/views/trainer/TrainerAIGenerate.jsx
frontend/src/views/trainer/TrainerClientPlan.jsx
frontend/src/views/trainer/TrainerRoutineBuilder.jsx
frontend/src/views/trainer/routine-actions.test.js`.split('\n')
const REPO_ONLY_89 = [".env.example",".env.production.example",".gitattributes",".github/workflows/test.yml",".gitignore","contracts/2J-089-training-summary-v1.json","ops/deploy-kit/releases/bunker-v2.json","ops/deploy-kit/releases/megasprint-2026-10-07.json","ops/deploy-kit/windows/feature-gate-probe.test.mjs","ops/deploy-kit/windows/generate-release-runner.mjs","ops/deploy-kit/windows/generate-release-runner.test.mjs","ops/deploy-kit/windows/git-root.test.mjs","ops/deploy-kit/windows/templates/release-runner.ps1.in"]
const withRepoOnly = (extra = {}) => ({ ...base, deltaPaths: [...DEPLOYABLE_89, ...REPO_ONLY_89], deployablePaths: DEPLOYABLE_89, nonDeployablePaths: REPO_ONLY_89, expectedCommitCount: 1, maxCommits: 1, ...extra })

test('the real 89-path delta validates with SAFE_PATH untouched: 76 deployable + 13 exact repository-only', () => {
  assert.equal(DEPLOYABLE_89.length, 76); assert.equal(REPO_ONLY_89.length, 13)
  const v = validateConfig(withRepoOnly())
  assert.equal(v.deployable.length, 76); assert.equal(v.nonDeployable.length, 13)
  // the same delta without the classification is refused exactly as before
  assert.throws(() => validateConfig({ ...withRepoOnly(), nonDeployablePaths: undefined, deployablePaths: undefined }), /INVALID_EXACT_DELTA_PATHS/)
})

test('the rendered runner expects the DEPLOYABLE delta from the archives, the full delta from Git, and builds the release from the production-preserving tree', () => {
  const out = renderTemplate(template, withRepoOnly())
  const start = out.indexOf('cat > "$EXPECTED_DELTA" <<')
  const expected = out.slice(start, out.indexOf('\nDELTA\n', start)).split('\n').slice(1)
  assert.deepEqual([...expected].sort(), [...DEPLOYABLE_89].sort(), 'the archive delta is exactly the deployable paths')
  for (const p of REPO_ONLY_89) assert.ok(!expected.includes(p), 'never in the archive delta: ' + p)
  assert.ok(out.includes('TARGET_DELTA=OK 89 files') && out.includes('deployable=76'))
  assert.ok(out.includes('RELEASE_SCOPE=OK changed=76'))
  assert.ok(out.includes('release-tree.mjs $Commit $RollbackCommit @NonDeployablePaths'))
  assert.ok(out.includes('git archive --format=tar.gz --output=$Release $ReleaseSource'))
  assert.ok(out.includes('git archive --format=tar.gz --output=$RollbackRelease $RollbackCommit'), 'the rollback archive stays the exact baseline')
  for (const p of REPO_ONLY_89) assert.ok(out.includes("'" + p + "'"), 'declared in the runner: ' + p)
})

test('a path in the delta that is neither SAFE_PATH nor explicitly declared repository-only fails', () => {
  const extra = 'contracts/other.json'
  assert.throws(() => validateConfig(withRepoOnly({ deltaPaths: [...DEPLOYABLE_89, ...REPO_ONLY_89, extra] })), /DEPLOYABLE_PATHS_MISMATCH|INVALID_EXACT_DELTA_PATHS/)
  assert.throws(() => validateConfig(withRepoOnly({ deltaPaths: [...DEPLOYABLE_89, ...REPO_ONLY_89, extra], deployablePaths: [...DEPLOYABLE_89, extra] })), /INVALID_EXACT_DELTA_PATHS/)
})

test('a repository-only path that is not in the delta, or is not on the fixed list, fails', () => {
  assert.throws(() => validateConfig(withRepoOnly({ nonDeployablePaths: [...REPO_ONLY_89, '.gitkeep'] })), /INVALID_NON_DEPLOYABLE_PATHS/)
  assert.throws(() => validateConfig(withRepoOnly({ deltaPaths: [...DEPLOYABLE_89, ...REPO_ONLY_89.slice(1)] })), /NON_DEPLOYABLE_NOT_IN_DELTA/)
  for (const p of ['api/server.js', 'frontend/src/App.jsx', 'docs/X.md', 'CHANGELOG.md', 'ops/server/2j-deploy-gate', 'ops/deploy-kit/windows/2j-transport.ps1', 'ops/x', '.github/workflows/other.yml', '.env', '.env.production', 'data/db.json'])
    assert.equal(isRepositoryOnlyPath(p), false, p + ' can never be repository-only')
  for (const p of REPO_ONLY_89) assert.equal(isRepositoryOnlyPath(p), true, p)
})

test('an unsafe path declared deployable still fails; code paths cannot hide as repository-only', () => {
  assert.throws(() => validateConfig(withRepoOnly({ deltaPaths: [...DEPLOYABLE_89, ...REPO_ONLY_89, '.env.production.local'], deployablePaths: [...DEPLOYABLE_89, '.env.production.local'] })), /INVALID_EXACT_DELTA_PATHS/)
  const hidden = 'api/server.js'
  assert.throws(() => validateConfig(withRepoOnly({ nonDeployablePaths: [...REPO_ONLY_89, hidden], deployablePaths: DEPLOYABLE_89.filter(p => p !== hidden) })), /INVALID_NON_DEPLOYABLE_PATHS/)
})

test('hiding a path of the delta (or inflating the classification) is refused: deployable must be exactly delta minus repository-only', () => {
  assert.throws(() => validateConfig(withRepoOnly({ deployablePaths: DEPLOYABLE_89.slice(1) })), /DEPLOYABLE_PATHS_MISMATCH/)
  assert.throws(() => validateConfig(withRepoOnly({ deployablePaths: [...DEPLOYABLE_89, '.gitignore'] })), /DEPLOYABLE_PATHS_MISMATCH/)
  assert.throws(() => validateConfig(withRepoOnly({ nonDeployablePaths: [...REPO_ONLY_89, REPO_ONLY_89[0]] })), /INVALID_NON_DEPLOYABLE_PATHS/)
  assert.throws(() => validateConfig(withRepoOnly({ nonDeployablePaths: REPO_ONLY_89, deployablePaths: undefined })), /DEPLOYABLE_PATHS_MISMATCH/)
})

test('manifests without repository-only paths render with an empty list (the archive is the plain target)', () => {
  const out = renderTemplate(template, base)
  assert.ok(out.includes('$NonDeployablePaths = @()'))
})
