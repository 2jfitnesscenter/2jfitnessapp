import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderTemplate } from './generate-release-runner.mjs'

/* Regression for "LOCAL_VERIFY_RELEASE_PROTOCOL_FAILED": the release-protocol step greps the TARGET tree for source markers. After #38 moved the retry call
 * (invokeWithRetry) from api/coach/jobs.js and trainer-jobs.js into ai-generate.js, two guards were stale, the step died silently (set -e + grep -q), and the
 * runner only said "failed". Every literal guard of that step must hold against the source of the repository, so drift fails here (CI), not in PrepareOnly. */
const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../..')
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const runner = renderTemplate(fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8'), base)
const step = runner.slice(runner.indexOf('STEP=verify-release-protocol\n'), runner.indexOf('STEP=verify-current-production\n'))
const guards = []
for (const line of step.split('\n')) {
  const m = /^grep -Fq (?:'([^']*)'|"([^"]*)") "\$RELEASE_CHECK_DIR\/([^"]+)"$/.exec(line.trim())
  if (m && !(m[1] ?? m[2]).includes('$')) guards.push({ marker: m[1] ?? m[2], file: m[3] })   // literal markers only (loop variables are checked by the loop's own list)
}

test('the protocol step has a meaningful set of literal source guards', () => {
  assert.ok(step.length > 1000)
  assert.ok(guards.length >= 50, 'parsed ' + guards.length)
})

test('every literal guard of the protocol step holds in the repository source (no stale marker)', () => {
  const stale = guards.filter(g => {
    const f = path.join(root, g.file)
    return !fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes(g.marker)
  }).map(g => `${g.file} :: ${g.marker}`)
  assert.deepEqual(stale, [])
})

test('the AI retry layer guard follows the code: ai-run exports invokeWithRetry, ai-generate calls it, jobs/trainer-jobs go through generateWithRepair', () => {
  const has = (file, marker) => guards.some(g => g.file === file && g.marker === marker)
  assert.ok(has('api/coach/ai-run.js', 'export async function invokeWithRetry'))
  assert.ok(has('api/coach/ai-generate.js', 'invokeWithRetry'))
  assert.ok(has('api/coach/jobs.js', 'generateWithRepair') && has('api/coach/trainer-jobs.js', 'generateWithRepair'))
  assert.ok(!has('api/coach/jobs.js', 'invokeWithRetry') && !has('api/coach/trainer-jobs.js', 'invokeWithRetry'), 'the stale direct-call guard is gone')
})

test('a failing protocol check names the failing command and the exit code (no opaque message)', () => {
  assert.match(runner, /trap 'printf "VERIFY_PROTOCOL_FAILED exit=%s line=%s command=%s\\n" "\$\?" "\$LINENO" "\$BASH_COMMAND" >&2' ERR/)
  assert.match(runner, /LOCAL_VERIFY_RELEASE_PROTOCOL_FAILED exit=\$ProtocolCode/)
  assert.ok(!runner.includes("throw 'LOCAL_VERIFY_RELEASE_PROTOCOL_FAILED; no production connection was made'"))
})
