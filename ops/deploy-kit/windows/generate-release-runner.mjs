import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const TEMPLATE = path.join(here, 'templates', 'release-runner.ps1.in')
const SHA40 = /^[0-9a-f]{40}$/
const SAFE_PATH = /^(?:AI_HANDOFF\.md|CHANGELOG\.md|(?:api|frontend|scripts|web|docs)\/[A-Za-z0-9._/-]+)$/
const NO_CREDENTIAL_PIN_PROBES = [
  { method: 'POST', path: '/api/shared-device/pin', status: 403 },
  { method: 'POST', path: '/api/shared-staff/pin', status: 403 },
]
export const isAllowedPostTargetPath = p => ['AI_HANDOFF.md', 'CHANGELOG.md', '.gitattributes', 'docs/GENERATED_FILES.md'].includes(p) || p.startsWith('ops/deploy-kit/')

function fail(message) { throw new Error(message) }
function psQuote(value) { return `'${String(value).replaceAll("'", "''")}'` }
function shQuote(value) { return `'${String(value).replaceAll("'", "'\\''")}'` }

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
  if (!Array.isArray(c.deltaPaths) || !c.deltaPaths.length || new Set(c.deltaPaths).size !== c.deltaPaths.length || c.deltaPaths.some(p => !SAFE_PATH.test(p))) fail('INVALID_EXACT_DELTA_PATHS')
  if (c.maxCommits !== c.expectedCommitCount || !Number.isInteger(c.expectedCommitCount) || c.expectedCommitCount < 1) fail('INVALID_COMMIT_COUNT')
  if (!c.sync || !SHA40.test(c.sync.rollbackBase || '') || !/^[0-9a-f]{64}$/.test(c.sync.syncJsSha256Lf || '') || !/^[0-9a-f]{64}$/.test(c.sync.syncJsSha256CrLf || '')) fail('INVALID_SYNC_GUARD')
  if (!c.probes || !Array.isArray(c.probes.sourceFiles) || !Array.isArray(c.probes.sourceMarkers) || !Array.isArray(c.probes.unauthenticatedRoutes)) fail('INVALID_RELEASE_PROBES')
  for (const f of c.probes.sourceFiles) if (!SAFE_PATH.test(f)) fail(`INVALID_PROBE_PATH:${f}`)
  for (const m of c.probes.sourceMarkers) if (!SAFE_PATH.test(m.file) || typeof m.marker !== 'string' || !m.marker || /[\r\n]/.test(m.marker)) fail('INVALID_SOURCE_MARKER')
  const pinProbeStatuses = []
  for (const r of c.probes.unauthenticatedRoutes) {
    if (!['GET', 'POST'].includes(r.method) || !/^\/api\/[A-Za-z0-9/_-]+$/.test(r.path) || !Number.isInteger(r.status) || r.status < 200 || r.status > 599) fail('INVALID_UNAUTHENTICATED_ROUTE')
    if (NO_CREDENTIAL_PIN_PROBES.some(p => p.method === r.method && p.path === r.path)) pinProbeStatuses.push({ route: r, status: r.status })
  }
  for (const expected of NO_CREDENTIAL_PIN_PROBES) {
    const matches = c.probes.unauthenticatedRoutes.filter(r => r.method === expected.method && r.path === expected.path)
    if (matches.length !== 1 || matches[0].status !== expected.status) fail(`SHARED_PIN_PROBE_MUST_MATCH_CONTRACT_403:${expected.path}`)
  }
  if (new Set(pinProbeStatuses.map(p => p.status)).size !== 1 || pinProbeStatuses.length !== NO_CREDENTIAL_PIN_PROBES.length) fail('CONTRADICTORY_NO_CREDENTIAL_PIN_EXPECTATIONS')
  return { targetShort: c.targetCommit.slice(0, 7), expectedShort: c.expectedCurrentCommit.slice(0, 7) }
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
    lines.push(`${key}_STATUS=$(wait_status ${route.status} ${shQuote(url)} ${body} ${headers} 45${route.method === 'POST' ? ` '' POST '{}'` : ''})`)
    if (route.expectUnauthenticated === true) lines.push(`if grep -Eqi '"(user|staff|session|deviceToken|pinHash)"[[:space:]]*:' ${body}; then printf 'SHARED_ROUTE_DATA_LEAK=${route.path}\\n'; false; fi`)
    if (route.requiredBodyMarker) lines.push(`grep -Fq ${shQuote(route.requiredBodyMarker)} ${body}`)
  }
  const statusFormat = c.probes.unauthenticatedRoutes.map(route => `${route.path}=%s`).join(', ')
  const statusArgs = c.probes.unauthenticatedRoutes.map((_, i) => `"$SHARED_ROUTE_${i + 1}_STATUS"`).join(' ')
  lines.push(`printf 'SHARED_STAFF_SMOKE=OK unauthenticated_statuses=[${statusFormat}]\\n' ${statusArgs}`)
  return lines.join('\n')
}

export function renderTemplate(template, c) {
  const { targetShort, expectedShort } = validateConfig(c)
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
    EXPECTED_DELTA_PATHS: [...c.deltaPaths].sort().join('\n'),
    DELTA_PATHS_PS: c.deltaPaths.map(psQuote).join(', '),
    SYNC_BASE: c.sync.rollbackBase,
    SYNC_JS_SHA256_LF: c.sync.syncJsSha256Lf,
    SYNC_JS_SHA256_CRLF: c.sync.syncJsSha256CrLf,
    SOURCE_PROBES: renderSourceProbes(c),
    POSTSTART_PROBES: renderPostStartProbes(c),
  }
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
  try { main() } catch (error) { console.error(`RUNNER_GENERATION_FAILED=${error.message}`); process.exitCode = 1 }
}
