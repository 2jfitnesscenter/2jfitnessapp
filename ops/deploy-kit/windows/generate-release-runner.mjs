import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { buildPhysicalTree } from './physical-tree.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const TEMPLATE = path.join(here, 'templates', 'release-runner.ps1.in')
const SHA40 = /^[0-9a-f]{40}$/
const SAFE_PATH = /^(?:AI_HANDOFF\.md|CHANGELOG\.md|(?:api|frontend|scripts|web|docs)\/[A-Za-z0-9._/-]+)$/
// Repository-only paths: part of the Git delta (and verified there, exactly) but NEVER deployed — the release archive carries them exactly as the
// production baseline has them (see release-tree.mjs). Fail-closed: an exact list plus one narrow tooling pattern; anything else in the delta must be a
// SAFE_PATH deployable path. Nothing under api/, frontend/, scripts/, web/ or docs/ can ever be declared repository-only.
export const REPOSITORY_ONLY_EXACT = new Set([
  '.env.example', '.env.production.example', '.gitattributes', '.gitignore', '.github/workflows/test.yml',
  'contracts/2J-089-training-summary-v1.json', // read only by api/test/platform-proof.test.js (checked: no runtime code opens contracts/)
])
const REPOSITORY_ONLY_TOOLING = /^ops\/deploy-kit\/(?:releases\/[A-Za-z0-9._-]+\.json|windows\/(?:templates\/)?[A-Za-z0-9._-]+\.(?:mjs|in))$/
export const isRepositoryOnlyPath = p => typeof p === 'string' && (REPOSITORY_ONLY_EXACT.has(p) || REPOSITORY_ONLY_TOOLING.test(p))

export function validateNodeTestSummary(output, exitCode) {
  if (exitCode !== 0) return { ok: false, reason: `NONZERO_EXIT:${exitCode}` }
  if (typeof output !== 'string' || output.trim() === '') return { ok: false, reason: 'EMPTY_OUTPUT' }
  const readCount = (name, required = true) => {
    // Node's built-in test runner emits either TAP (# tests N) or spec (ℹ tests N) summaries.
    const matches = [...output.matchAll(new RegExp(`^(?:#|ℹ)\\s+${name}\\s+(\\d+)\\s*$`, 'gm'))]
    if (matches.length === 0 && !required) return { value: 0 }
    if (matches.length !== 1) return { error: `INVALID_${name.toUpperCase()}_COUNT` }
    const value = Number(matches[0][1])
    if (!Number.isSafeInteger(value) || value < 0) return { error: `INVALID_${name.toUpperCase()}_COUNT` }
    return { value }
  }
  const tests = readCount('tests')
  const pass = readCount('pass')
  const fail = readCount('fail')
  const cancelled = readCount('cancelled')
  const skipped = readCount('skipped', false)
  const todo = readCount('todo', false)
  for (const result of [tests, pass, fail, cancelled, skipped, todo]) if (result.error) return { ok: false, reason: result.error }
  const summary = { tests: tests.value, pass: pass.value, fail: fail.value, cancelled: cancelled.value, skipped: skipped.value, todo: todo.value }
  if (summary.tests < 1) return { ok: false, reason: 'NO_TESTS_EXECUTED', summary }
  if (summary.fail !== 0) return { ok: false, reason: 'TEST_FAILURES_PRESENT', summary }
  if (summary.cancelled !== 0) return { ok: false, reason: 'TESTS_CANCELLED', summary }
  if (summary.pass + summary.skipped + summary.todo !== summary.tests) return { ok: false, reason: 'INCONSISTENT_TEST_COUNTS', summary }
  return { ok: true, reason: 'OK', summary }
}

function validateNodeTestSummaryFile(file, exitCode) {
  const result = validateNodeTestSummary(fs.readFileSync(file, 'utf8'), Number(exitCode))
  if (!result.ok) {
    process.stderr.write(`DEPLOY_TOOLING_TEST_SUMMARY=FAIL reason=${result.reason}\n`)
    process.exitCode = 1
    return
  }
  const s = result.summary
  process.stdout.write(`DEPLOY_TOOLING_TEST_SUMMARY=PASS tests=${s.tests} pass=${s.pass} skipped=${s.skipped} todo=${s.todo}\n`)
}
const NO_CREDENTIAL_PIN_PROBES = [
  { method: 'POST', path: '/api/shared-device/pin', status: 403 },
  { method: 'POST', path: '/api/shared-staff/pin', status: 403 },
]
// The deploy smoke intentionally sends no Origin header. pushSession rejects that
// request at the origin guard before its unauthenticated-session check.
const NO_ORIGIN_PUSH_PROBES = [
  { method: 'POST', path: '/api/push/subscribe', status: 403 },
]
const WEB_PUSH_SUBSCRIPTION_MARKERS = [
  { file: 'api/server.js', marker: "'GET /api/push/public-key'" },
  { file: 'api/server.js', marker: "'POST /api/push/subscribe'" },
  { file: 'api/server.js', marker: 'upsertPushSubscription(db, sub)' },
  { file: 'api/lib/rest-alerts.js', marker: 'export function upsertPushSubscription' },
  { file: 'api/test/rest-alert-routes.test.js', marker: "call('POST', '/api/push/subscribe'" },
  { file: 'api/test/rest-alert-routes.test.js', marker: 'assert.equal(db.subs.length, 1)' },
]
export const isAllowedPostTargetPath = p => p === 'AI_HANDOFF.md' || p === 'CHANGELOG.md' || p === '.gitattributes' || p === 'docs/GENERATED_FILES.md' || p === 'frontend/src/views/adaptive.test.jsx' || p.startsWith('ops/deploy-kit/')

function fail(message) { throw new Error(message) }
function psQuote(value) { return `'${String(value).replaceAll("'", "''")}'` }
function shQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'` }

export function validateWebPushSubscriptionWiring(sourceByPath) {
  const missing = WEB_PUSH_SUBSCRIPTION_MARKERS.filter(({ file, marker }) => !String(sourceByPath?.[file] || '').includes(marker))
  return { ok: missing.length === 0, missing }
}

function renderWebPushSubscriptionProbe() {
  return WEB_PUSH_SUBSCRIPTION_MARKERS.map(({ file, marker }) => `grep -Fq ${shQuote(marker)} "$RELEASE_CHECK_DIR/${file}"`).join('\n')
}

function rejectLegacyWebPushProbe(template) {
  if (/grep\s+-Fq\s+["']db\.subs\.push["']/.test(template)) fail('STALE_WEB_PUSH_SUBSCRIPTION_PROBE')
}

export function validateConfig(c) {
  if (!c || typeof c !== 'object') fail('CONFIG_OBJECT_REQUIRED')
  for (const key of ['targetCommit', 'expectedCurrentCommit', 'rollbackCommit']) {
    if (!SHA40.test(c[key] || '')) fail(`INVALID_FULL_SHA40:${key}`)
  }
  if (c.targetCommit === c.expectedCurrentCommit) fail('TARGET_MUST_DIFFER_FROM_CURRENT')
  if (c.rollbackCommit !== c.expectedCurrentCommit && (c.rollbackException !== true || !/^[\x20-\x7e]{12,200}$/.test(c.rollbackExceptionReason || ''))) fail('ROLLBACK_MUST_EQUAL_EXPECTED_CURRENT_OR_DOCUMENT_EXCEPTION')
  if (!c.metadata || typeof c.metadata.title !== 'string' || !/^[\x20-\x7e]{8,140}$/.test(c.metadata.title)) fail('INVALID_ASCII_RELEASE_TITLE')
  if (!Number.isInteger(c.expectedFrontendTests) || c.expectedFrontendTests < 1) fail('INVALID_FRONTEND_TEST_COUNT')
  if (!Number.isInteger(c.expectedApiTests) || c.expectedApiTests < 1) fail('INVALID_API_TEST_COUNT')
  if (!Number.isInteger(c.expectedApiPassed) || !Number.isInteger(c.expectedApiSkipped) || c.expectedApiPassed + c.expectedApiSkipped !== c.expectedApiTests) fail('API_TEST_TOTAL_MISMATCH')
  if (!Array.isArray(c.deltaPaths) || !c.deltaPaths.length || new Set(c.deltaPaths).size !== c.deltaPaths.length || c.deltaPaths.some(p => typeof p !== 'string')) fail('INVALID_EXACT_DELTA_PATHS')
  // deltaPaths is the COMPLETE Git delta. nonDeployablePaths are exact members of it that are never deployed; deployablePaths is everything else and must
  // pass SAFE_PATH exactly as before.
  const nonDeployable = c.nonDeployablePaths ?? []
  if (!Array.isArray(nonDeployable) || new Set(nonDeployable).size !== nonDeployable.length || nonDeployable.some(p => !isRepositoryOnlyPath(p))) fail('INVALID_NON_DEPLOYABLE_PATHS')
  if (nonDeployable.some(p => !c.deltaPaths.includes(p))) fail('NON_DEPLOYABLE_NOT_IN_DELTA')
  const deployable = c.deltaPaths.filter(p => !nonDeployable.includes(p))
  if (nonDeployable.length || c.deployablePaths !== undefined) {
    if (!Array.isArray(c.deployablePaths) || JSON.stringify([...c.deployablePaths].sort()) !== JSON.stringify([...deployable].sort())) fail('DEPLOYABLE_PATHS_MISMATCH')
  }
  if (!deployable.length || deployable.some(p => !SAFE_PATH.test(p))) fail('INVALID_EXACT_DELTA_PATHS')
  if (c.maxCommits !== c.expectedCommitCount || !Number.isInteger(c.expectedCommitCount) || c.expectedCommitCount < 1) fail('INVALID_COMMIT_COUNT')
  if (!c.sync || !SHA40.test(c.sync.rollbackBase || '') || !/^[0-9a-f]{64}$/.test(c.sync.syncJsSha256Lf || '') || !/^[0-9a-f]{64}$/.test(c.sync.syncJsSha256CrLf || '')) fail('INVALID_SYNC_GUARD')
  if (!c.probes || !Array.isArray(c.probes.sourceFiles) || !Array.isArray(c.probes.sourceMarkers) || !Array.isArray(c.probes.unauthenticatedRoutes)) fail('INVALID_RELEASE_PROBES')
  for (const f of c.probes.sourceFiles) if (!SAFE_PATH.test(f)) fail(`INVALID_PROBE_PATH:${f}`)
  for (const m of c.probes.sourceMarkers) if (!SAFE_PATH.test(m.file) || typeof m.marker !== 'string' || !m.marker || /[\r\n]/.test(m.marker)) fail('INVALID_SOURCE_MARKER')
  const pinProbeStatuses = []
  const noOriginPushProbeStatuses = []
  for (const r of c.probes.unauthenticatedRoutes) {
    if (r.featureGate !== undefined && (r.featureGate !== true || r.status !== 401 || r.expectUnauthenticated !== true)) fail('INVALID_FEATURE_GATE_ROUTE')
    if (!['GET', 'POST'].includes(r.method) || !/^\/api\/[A-Za-z0-9/_-]+$/.test(r.path) || !Number.isInteger(r.status) || r.status < 200 || r.status > 599) fail('INVALID_UNAUTHENTICATED_ROUTE')
    if (NO_CREDENTIAL_PIN_PROBES.some(p => p.method === r.method && p.path === r.path)) pinProbeStatuses.push({ route: r, status: r.status })
    if (NO_ORIGIN_PUSH_PROBES.some(p => p.method === r.method && p.path === r.path)) noOriginPushProbeStatuses.push({ route: r, status: r.status })
  }
  for (const expected of NO_CREDENTIAL_PIN_PROBES) {
    const matches = c.probes.unauthenticatedRoutes.filter(r => r.method === expected.method && r.path === expected.path)
    if (matches.length !== 1 || matches[0].status !== expected.status) fail(`SHARED_PIN_PROBE_MUST_MATCH_CONTRACT_403:${expected.path}`)
  }
  if (new Set(pinProbeStatuses.map(p => p.status)).size !== 1 || pinProbeStatuses.length !== NO_CREDENTIAL_PIN_PROBES.length) fail('CONTRADICTORY_NO_CREDENTIAL_PIN_EXPECTATIONS')
  for (const expected of NO_ORIGIN_PUSH_PROBES) {
    const matches = c.probes.unauthenticatedRoutes.filter(r => r.method === expected.method && r.path === expected.path)
    if (matches.length > 1 || (matches.length === 1 && matches[0].status !== expected.status)) fail(`NO_ORIGIN_PUSH_PROBE_MUST_MATCH_CONTRACT_403:${expected.path}`)
  }
  if (new Set(noOriginPushProbeStatuses.map(p => p.status)).size > 1) fail('CONTRADICTORY_NO_ORIGIN_PUSH_EXPECTATIONS')
  // What production PHYSICALLY holds after the previous release (see physical-tree.mjs). Empty = production is exactly TREE(expectedCurrentCommit).
  const preserved = c.expectedCurrentPreserved ?? []
  if (!Array.isArray(preserved) || preserved.some(e => !e || typeof e.path !== 'string' || !e.path || /[\0\r\n*?[\]\\']/.test(e.path) || e.path.startsWith('/') || e.path.split('/').includes('..') || !SHA40.test(e.from || '')) || new Set(preserved.map(e => e.path)).size !== preserved.length) fail('INVALID_EXPECTED_CURRENT_PRESERVED')
  if (preserved.length ? !SHA40.test(c.expectedCurrentPhysicalTree || '') : c.expectedCurrentPhysicalTree !== undefined) fail('EXPECTED_CURRENT_PHYSICAL_TREE_REQUIRED_EXACTLY_WITH_PRESERVED_PATHS')
  return { targetShort: c.targetCommit.slice(0, 7), expectedShort: c.expectedCurrentCommit.slice(0, 7), deployable, nonDeployable, preserved }
}

// Repository-only paths of THIS release, as the runner applies them: the declared ones, plus every path production still holds from an earlier release that this
// release does not change in Git (repository-only stays "exactly what production has", it is never silently overwritten by TREE(commit)). A preserved path that this
// release changes and declares deployable is deployed and stops being preserved.
export function effectiveNonDeployable(c) {
  const delta = new Set(c.deltaPaths)
  const declared = c.nonDeployablePaths ?? []
  return [...declared, ...(c.expectedCurrentPreserved ?? []).map(e => e.path).filter(p => !delta.has(p))]
}

// The preserved list for the manifest of the release AFTER this one (its expectedCurrentPreserved). For each path this release leaves as production has it, the
// source is the commit whose blob production really holds: the original source if it was already preserved, otherwise the commit production is at now.
export function nextExpectedCurrentPreserved(c) {
  const known = new Map((c.expectedCurrentPreserved ?? []).map(e => [e.path, e.from]))
  return effectiveNonDeployable(c).map(p => ({ path: p, from: known.get(p) ?? c.expectedCurrentCommit })).sort((a, b) => (a.path < b.path ? -1 : 1))
}

function renderSourceProbes(c) {
  const files = c.probes.sourceFiles.map(f => `test -s "$RELEASE_CHECK_DIR/${f}"`).join('\n')
  const markers = c.probes.sourceMarkers.map(({ file, marker }) => `grep -Fq ${shQuote(marker)} "$RELEASE_CHECK_DIR/${file}"`).join('\n')
  const summary = `printf 'RELEASE_PROBES_SOURCE=OK files=${c.probes.sourceFiles.length} markers=${c.probes.sourceMarkers.length}\\n'`
  return [files, markers, summary].filter(Boolean).join('\n')
}

function renderPostStartProbes(c) {
  const lines = []
  for (const [i, route] of c.probes.unauthenticatedRoutes.entries()) {
    const key = `SHARED_ROUTE_${i + 1}`
    const body = `/tmp/2j-release-probe-${i + 1}-body`
    const headers = `/tmp/2j-release-probe-${i + 1}-headers`
    const url = `https://app.2jfitnesscenter.com${route.path}`
    if (route.path.startsWith('/api/shared-') || route.path.startsWith('/api/admin/shared-')) lines.push(`printf 'SHARED_STAFF_PROBE route=${route.path} method=${route.method} expected=${route.status}\\n'`)
    lines.push(`${key}_STATUS=$(wait_status ${route.status} ${shQuote(url)} ${body} ${headers} 45${route.method === 'POST' ? ` '' POST '{}'` : route.featureGate ? ` '' GET ''` : ''}${route.featureGate ? ' feature_off' : ''})`)
    if (route.expectUnauthenticated === true) lines.push(`if grep -Eqi '"(user|staff|session|deviceToken|pinHash)"[[:space:]]*:' ${body}; then printf 'SHARED_ROUTE_DATA_LEAK=${route.path}\\n'; false; fi`)
    if (route.requiredBodyMarker) lines.push(`grep -Fq ${shQuote(route.requiredBodyMarker)} ${body}`)
  }
  const statusFormat = c.probes.unauthenticatedRoutes.map(route => `${route.path}=%s`).join(', ')
  const statusArgs = c.probes.unauthenticatedRoutes.map((_, i) => `"$SHARED_ROUTE_${i + 1}_STATUS"`).join(' ')
  lines.push(`printf 'SHARED_STAFF_SMOKE=OK unauthenticated_statuses=[${statusFormat}]\\n' ${statusArgs}`)
  return lines.join('\n')
}

export function renderTemplate(template, c) {
  const { targetShort, expectedShort, deployable, nonDeployable, preserved } = validateConfig(c)
  template = template.replace(/\r\n/g, '\n')
  const values = {
    RELEASE_TITLE: c.metadata.title,
    TARGET_COMMIT: c.targetCommit,
    TARGET_SHORT: targetShort,
    EXPECTED_CURRENT_COMMIT: c.expectedCurrentCommit,
    EXPECTED_CURRENT_SHORT: expectedShort,
    ROLLBACK_COMMIT: c.rollbackCommit,
    FRONTEND_TESTS: String(c.expectedFrontendTests),
    API_TESTS: String(c.expectedApiTests),
    API_PASSED: String(c.expectedApiPassed),
    API_SKIPPED: String(c.expectedApiSkipped),
    MAX_COMMITS: String(c.maxCommits),
    DELTA_COUNT: String(c.deltaPaths.length),
    EXPECTED_DELTA_PATHS: [...deployable].sort().join('\n'),
    DEPLOYABLE_COUNT: String(deployable.length),
    NON_DEPLOYABLE_PATHS_PS: nonDeployable.map(psQuote).join(', '),
    PRESERVED_CURRENT_PS: preserved.map(e => `${psQuote(e.from)}, ${psQuote(e.path)}`).join(', '),
    EXPECTED_CURRENT_PHYSICAL_TREE: c.expectedCurrentPhysicalTree ?? '',
    DELTA_PATHS_PS: c.deltaPaths.map(psQuote).join(', '),
    SYNC_BASE: c.sync.rollbackBase,
    SYNC_JS_SHA256_LF: c.sync.syncJsSha256Lf,
    SYNC_JS_SHA256_CRLF: c.sync.syncJsSha256CrLf,
    SOURCE_PROBES: renderSourceProbes(c),
    POSTSTART_PROBES: renderPostStartProbes(c),
    WEB_PUSH_SUBSCRIPTION_PROBE: renderWebPushSubscriptionProbe(),
  }
  rejectLegacyWebPushProbe(template)
  let out = template
  for (const [key, value] of Object.entries(values)) {
    const token = `@@${key}@@`
    const count = out.split(token).length - 1
    if (count < 1) fail(`TEMPLATE_TOKEN_MISSING:${key}`)
    out = out.replaceAll(token, value)
  }
  if (/@@[A-Z0-9_]+@@/.test(out)) fail('UNRESOLVED_TEMPLATE_TOKEN')
  const targetToken = 'TARGET_COMMIT=__TARGET_COMMIT__'
  const rollbackToken = 'ROLLBACK_COMMIT=__ROLLBACK_COMMIT__'
  const remoteStart = out.indexOf("$RemoteScriptTemplate = @'\n")
  const remoteEnd = remoteStart < 0 ? -1 : out.indexOf("\n'@", remoteStart)
  if (remoteStart < 0 || remoteEnd < 0) fail('REMOTE_SCRIPT_TEMPLATE_BOUNDARY_MISSING')
  const remoteTemplate = out.slice(remoteStart, remoteEnd)
  if (remoteTemplate.split(targetToken).length - 1 !== 1 || remoteTemplate.split(rollbackToken).length - 1 !== 1) fail('REMOTE_SHA_TEMPLATE_MISMATCH')
  const remoteRendered = out.replace(targetToken, `TARGET_COMMIT=${c.targetCommit}`).replace(rollbackToken, `ROLLBACK_COMMIT=${c.rollbackCommit}`)
  if (!new RegExp(`^TARGET_COMMIT=${c.targetCommit}$`, 'm').test(remoteRendered) || !new RegExp(`^ROLLBACK_COMMIT=${c.rollbackCommit}$`, 'm').test(remoteRendered)) fail('REMOTE_SHA_ASSIGNMENT_MISMATCH')
  if (!out.includes(`$Commit = '${c.targetCommit}'`) || !out.includes(`$ExpectedCurrentCommit = '${c.expectedCurrentCommit}'`) || !out.includes(`$RollbackCommit = '${c.rollbackCommit}'`)) fail('POWERSHELL_SHA_ASSIGNMENT_MISMATCH')
  const historicalHybrid = '16a1bb7bc5584c345d91727e93007fd6f8750b76'
  if (remoteRendered.includes(`TARGET_COMMIT=${historicalHybrid}`) || remoteRendered.includes(`ROLLBACK_COMMIT=${historicalHybrid}`) || remoteRendered.includes(`$Commit = '${historicalHybrid}'`) || remoteRendered.includes(`$ExpectedCurrentCommit = '${historicalHybrid}'`)) fail('HISTORICAL_HYBRID_SHA_PRESENT')
  return out
}

export function verifyRegression(template) {
  const old = '0b34b9bbc5584c345d91727e93007fd6f8750b76'
  const next = '16a1bb779140cd28020551bf16c0628f88b46f4f'
  const config = {
    targetCommit: next, expectedCurrentCommit: old, rollbackCommit: old,
    metadata: { title: 'Historical SHA regression fixture' }, expectedFrontendTests: 1,
    expectedApiTests: 1, expectedApiPassed: 1, expectedApiSkipped: 0,
    expectedCommitCount: 1, maxCommits: 1, deltaPaths: ['api/test/shared-staff.test.js'],
    sync: { rollbackBase: old, syncJsSha256Lf: 'a'.repeat(64), syncJsSha256CrLf: 'b'.repeat(64) },
    probes: {
      sourceFiles: ['api/test/shared-staff.test.js'], sourceMarkers: [],
      unauthenticatedRoutes: NO_CREDENTIAL_PIN_PROBES.map(route => ({ ...route, expectUnauthenticated: true })),
    },
  }
  const result = renderTemplate(template, config)
  const remoteTemplate = result.slice(result.indexOf("$RemoteScriptTemplate = @'\n"))
  const remoteRendered = remoteTemplate.replace('TARGET_COMMIT=__TARGET_COMMIT__', `TARGET_COMMIT=${next}`).replace('ROLLBACK_COMMIT=__ROLLBACK_COMMIT__', `ROLLBACK_COMMIT=${old}`)
  const hybrid = '16a1bb7bc5584c345d91727e93007fd6f8750b76'
  if (!result.includes(`$Commit = '${next}'`) || !remoteRendered.includes(`TARGET_COMMIT=${next}`) || !remoteRendered.includes(`ROLLBACK_COMMIT=${old}`) || remoteRendered.includes(`TARGET_COMMIT=${hybrid}`) || remoteRendered.includes(`ROLLBACK_COMMIT=${hybrid}`)) fail('HISTORICAL_SHA_REGRESSION_FAILED')
  return result
}

function git(args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim() }
function main() {
  const [configArg, outputArg] = process.argv.slice(2)
  if (!configArg) fail('usage: node generate-release-runner.mjs <release.json> [output.ps1]')
  const configPath = path.resolve(process.cwd(), configArg)
  const c = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const { targetShort } = validateConfig(c)
  const head = git(['rev-parse', 'HEAD'])
  if (head !== c.targetCommit) {
    try { execFileSync('git', ['merge-base', '--is-ancestor', c.targetCommit, head], { cwd: root, stdio: 'ignore' }) }
    catch { fail('TARGET_MUST_EQUAL_HEAD_OR_BE_ANCESTOR_OF_TOOLING_COMMIT') }
    const laterPaths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', c.targetCommit, head]).split(/\r?\n/).filter(Boolean)
    if (laterPaths.some(p => !isAllowedPostTargetPath(p))) fail('POST_TARGET_COMMIT_CONTAINS_NON_TOOLING_CHANGES')
  }
  const actualDelta = git(['diff-tree', '--no-commit-id', '--name-only', '-r', c.expectedCurrentCommit, c.targetCommit]).split(/\r?\n/).filter(Boolean).sort()
  const expectedDelta = [...c.deltaPaths].sort()
  if (JSON.stringify(actualDelta) !== JSON.stringify(expectedDelta)) fail('TARGET_DELTA_MISMATCH')
  // The physical production tree pinned in the manifest must be exactly what the preserved list reconstructs from this repository.
  if (c.expectedCurrentPreserved?.length) {
    const rebuilt = buildPhysicalTree({ cwd: root, current: c.expectedCurrentCommit, preserved: c.expectedCurrentPreserved })
    if (rebuilt !== c.expectedCurrentPhysicalTree) fail(`EXPECTED_CURRENT_PHYSICAL_TREE_MISMATCH:${rebuilt}`)
  }
  const count = Number(git(['rev-list', '--count', `${c.expectedCurrentCommit}..${c.targetCommit}`]))
  if (count !== c.expectedCommitCount) fail('TARGET_COMMIT_COUNT_MISMATCH')
  const template = fs.readFileSync(TEMPLATE, 'utf8')
  verifyRegression(template)
  const rendered = renderTemplate(template, c)
  const out = path.resolve(process.cwd(), outputArg || `deploy-${targetShort}.ps1`)
  fs.writeFileSync(out, rendered, 'utf8')
  process.stdout.write(`RUNNER_GENERATED=${out}\nTARGET_COMMIT=${c.targetCommit}\nEXPECTED_CURRENT_COMMIT=${c.expectedCurrentCommit}\nROLLBACK_COMMIT=${c.rollbackCommit}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === '--validate-node-test-summary') {
      if (!process.argv[3] || process.argv[4] === undefined) fail('usage: --validate-node-test-summary <log> <exit-code>')
      validateNodeTestSummaryFile(process.argv[3], process.argv[4])
    } else main()
  } catch (error) { console.error(`RUNNER_GENERATION_FAILED=${error.message}`); process.exitCode = 1 }
}
