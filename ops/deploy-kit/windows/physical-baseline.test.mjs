import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderTemplate, effectiveNonDeployable, nextExpectedCurrentPreserved, validateConfig } from './generate-release-runner.mjs'
import { buildPhysicalTree } from './physical-tree.mjs'
import { buildReleaseTree } from './release-tree.mjs'
import { makeReleaseArchive } from './release-archive.mjs'

/* Regression (verify-current-production: CURRENT_MISMATCH=.env.example, production marker b956778): b956778 was released with repository-only paths, so production
 * was marked b956778 while those paths on disk kept the OLDER value. The next release compared production against TREE(b956778) and stopped on the first repository-only
 * path. "Repository-only" means "exactly what production had before", never "ignored": the baseline is the PHYSICAL tree, rebuilt from the manifest, and verified in full.
 *
 * Chain under test: A → B (a repository-only path changes in Git) → C → D. Production is a real directory that every release is extracted over; the real
 * verify-current-production block of the runner template is executed against it. */
const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8')
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const remote = renderTemplate(template, base).replace(/\r\n/g, '\n')
const blockStart = remote.indexOf('STEP=verify-current-production\n'), blockEnd = remote.indexOf('STEP=backup-data\n', blockStart)
const VERIFY = remote.slice(blockStart + 'STEP=verify-current-production\n'.length, blockEnd)

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'physical-baseline-'))
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env }).trim()
git('init', '-q'); git('config', 'core.autocrlf', 'false')
const put = (name, text) => { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text) }
const commit = (msg, files) => { for (const [n, t] of Object.entries(files)) put(n, t); git('add', '-A'); git('commit', '-q', '-m', msg); return git('rev-parse', 'HEAD') }
const A = commit('A', { '.env.example': 'KEY=a\n', '.dockerignore': 'node_modules\n', 'api/server.js': 's1\n', 'frontend/src/app.js': 'f1\n', 'SYNC_V2_ROLLBACK_BASE': 'x\n' })
const B = commit('B: .env.example changes in Git but is repository-only', { '.env.example': 'KEY=b\n', 'api/server.js': 's2\n' })
const C = commit('C: only deployable files change', { 'api/server.js': 's3\n' })
const D = commit('D', { 'frontend/src/app.js': 'f2\n' })

// a manifest-like object for a release `current → target`: only the fields the chain logic reads
const manifest = (current, target, nd, preserved = []) => ({
  expectedCurrentCommit: current, targetCommit: target,
  deltaPaths: git('diff-tree', '--no-commit-id', '--name-only', '-r', current, target).split('\n').filter(Boolean).sort(),
  nonDeployablePaths: nd, expectedCurrentPreserved: preserved,
})
const tmpArchive = name => path.join(dir, name)
const extract = (archive, to) => { fs.mkdirSync(to, { recursive: true }); const r = spawnSync('tar', ['-xzf', path.basename(archive), '-C', path.relative(dir, to)], { cwd: dir }); assert.equal(r.status, 0, String(r.stderr)) }

// What the runner does for one hop: physical baseline → release tree → archives; and what the server does: extract the release over production.
function release(current, target, nd, preserved, prodDir, label) {
  const m = manifest(current, target, nd, preserved)
  const physical = preserved.length ? buildPhysicalTree({ cwd: dir, current, preserved }) : current
  const effective = effectiveNonDeployable(m)
  const source = effective.length ? buildReleaseTree({ cwd: dir, target, baseline: physical, nonDeployable: effective }) : target
  const rel = tmpArchive(`rel-${label}.tar.gz`), rb = tmpArchive(`rb-${label}.tar.gz`)
  makeReleaseArchive({ cwd: dir, treeish: source, output: rel }); makeReleaseArchive({ cwd: dir, treeish: physical, output: rb })
  return { m, physical, rel, rb, deploy: () => extract(rel, prodDir), next: nextExpectedCurrentPreserved(m) }
}
const treeFiles = tree => git('ls-tree', '-r', '--name-only', tree).split('\n').filter(Boolean)

function verifyCurrent(prodDir, rollbackArchive, releaseArchive, marker) {
  fs.mkdirSync(path.join(prodDir, 'data'), { recursive: true })
  for (const [n, t] of [['.env', 'WEB_PORT=8080\n'], ['data/db.json', '{}'], ['data/secret', 's'], ['.deployed-commit', marker + '\n']]) fs.writeFileSync(path.join(prodDir, n), t)
  const script = `set -euo pipefail\nAPP=${JSON.stringify(path.relative(dir, prodDir))}\nROLLBACK=${JSON.stringify(path.basename(rollbackArchive))}\nRELEASE=${JSON.stringify(path.basename(releaseArchive))}\nROLLBACK_COMMIT=${marker}\n${VERIFY}\necho VERIFIED\n`
  return spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8' })
}

const prod = path.join(dir, 'prod')
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0
const needBash = { skip: hasBash ? false : 'bash not available' }

test('the verify-current-production block was extracted from the real template', () => {
  assert.ok(VERIFY.includes('CURRENT_MISMATCH=') && VERIFY.includes('cmp -s "$CURRENT_CHECK_DIR/$rel" "$APP/$rel"') && VERIFY.length < 4000)
})

test('A → B: B leaves the repository-only path as production has it; production is marked B but is not TREE(B) on that path', needBash, () => {
  extract((() => { const a = tmpArchive('prod-A.tar.gz'); makeReleaseArchive({ cwd: dir, treeish: A, output: a }); return a })(), prod)
  const hopB = release(A, B, ['.env.example'], [], prod, 'B')
  assert.deepEqual(hopB.next, [{ path: '.env.example', from: A }], 'the next manifest records the commit production really holds')
  hopB.deploy()
  assert.equal(fs.readFileSync(path.join(prod, '.env.example'), 'utf8'), 'KEY=a\n', 'repository-only value NOT deployed')
  assert.equal(fs.readFileSync(path.join(prod, 'api/server.js'), 'utf8'), 's2\n', 'deployable value deployed')
  assert.notEqual(git('show', `${B}:.env.example`), 'KEY=a', 'and Git at B says something else')
})

test('B → C: the OLD design (baseline = TREE(B)) fails with CURRENT_MISMATCH=.env.example — the reported failure, reproduced', needBash, () => {
  const rb = tmpArchive('old-rb-C.tar.gz'), rel = tmpArchive('old-rel-C.tar.gz')
  makeReleaseArchive({ cwd: dir, treeish: B, output: rb }); makeReleaseArchive({ cwd: dir, treeish: C, output: rel })
  const r = verifyCurrent(prod, rb, rel, B)
  assert.notEqual(r.status, 0); assert.match(r.stdout, /CURRENT_MISMATCH=\.env\.example/, r.stdout + r.stderr)
})

const preservedForC = [{ path: '.env.example', from: A }]
test('B → C: the physical baseline verifies production in full (every file, not an ignore list) and C keeps the path as production has it', needBash, () => {
  const hopC = release(B, C, [], preservedForC, prod, 'C')
  assert.notEqual(hopC.physical, git('rev-parse', `${B}^{tree}`), 'the baseline is not TREE(B)')
  const files = treeFiles(hopC.physical)
  assert.ok(files.includes('.env.example') && files.includes('api/server.js') && files.includes('.dockerignore'), 'every file of the tree is in the baseline')
  const r = verifyCurrent(prod, hopC.rb, hopC.rel, B)
  assert.equal(r.status, 0, r.stdout + r.stderr); assert.match(r.stdout, /VERIFIED/)
  // carried: C does not change .env.example in Git, so it is still preserved although C declares nothing
  assert.deepEqual(effectiveNonDeployable(hopC.m), ['.env.example'])
  assert.equal(git('ls-tree', hopC.physical, '.env.example'), git('ls-tree', buildReleaseTree({ cwd: dir, target: C, baseline: hopC.physical, nonDeployable: ['.env.example'] }), '.env.example'))
  hopC.deploy()
  assert.equal(fs.readFileSync(path.join(prod, '.env.example'), 'utf8'), 'KEY=a\n', 'still the value of A after C')
  assert.equal(fs.readFileSync(path.join(prod, 'api/server.js'), 'utf8'), 's3\n')
  assert.deepEqual(hopC.next, [{ path: '.env.example', from: A }], 'chained: the source stays A, not B')
})

test('TAMPER: a preserved repository-only path changed on the server makes verification FAIL (preserved is not ignored)', needBash, () => {
  const hopC = release(B, C, [], preservedForC, prod, 'C2')
  // production as it was after B, then someone edits the preserved file
  const p2 = path.join(dir, 'prod-tampered'); extract(tmpArchive('prod-A.tar.gz'), p2); extract(tmpArchive('rel-B.tar.gz'), p2)
  assert.equal(verifyCurrent(p2, hopC.rb, hopC.rel, B).status, 0, 'control: untouched production passes')
  fs.writeFileSync(path.join(p2, '.env.example'), 'KEY=tampered\n')
  const r = verifyCurrent(p2, hopC.rb, hopC.rel, B)
  assert.notEqual(r.status, 0); assert.match(r.stdout, /CURRENT_MISMATCH=\.env\.example/)
  // and if production wrongly holds TREE(B) on that path instead of the preserved value, it fails too
  fs.writeFileSync(path.join(p2, '.env.example'), 'KEY=b\n')
  assert.match(verifyCurrent(p2, hopC.rb, hopC.rel, B).stdout, /CURRENT_MISMATCH=\.env\.example/)
})

test('C → D: the chain keeps working, deterministically, from the manifest data alone', needBash, () => {
  const hopD = release(C, D, [], buildChain(), prod, 'D')
  const r = verifyCurrent(prod, hopD.rb, hopD.rel, C)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.deepEqual(hopD.next, [{ path: '.env.example', from: A }])
  // rebuilding it again gives the very same tree id (no dependence on temp files or earlier worktrees)
  assert.equal(buildPhysicalTree({ cwd: dir, current: C, preserved: buildChain() }), hopD.physical)
})
function buildChain() { return nextExpectedCurrentPreserved(manifest(B, C, [], preservedForC)) }

test('a release that changes a preserved path as DEPLOYABLE deploys the new bytes and the path stops being preserved', () => {
  const m = manifest(A, B, [], [{ path: '.env.example', from: A }])   // .env.example is in the delta A→B and not declared repository-only
  assert.deepEqual(effectiveNonDeployable(m), [])
  assert.deepEqual(nextExpectedCurrentPreserved(m), [])
})

test('fail-closed: the physical tree must be pinned and match; unknown commits, unsafe paths and duplicates are refused', () => {
  const pinned = buildPhysicalTree({ cwd: dir, current: B, preserved: preservedForC })
  const cfg = { ...base, expectedCurrentPreserved: preservedForC, expectedCurrentPhysicalTree: pinned }
  assert.equal(validateConfig(cfg).preserved.length, 1)
  assert.throws(() => validateConfig({ ...cfg, expectedCurrentPhysicalTree: undefined }), /PHYSICAL_TREE_REQUIRED/)
  assert.throws(() => validateConfig({ ...base, expectedCurrentPhysicalTree: pinned }), /PHYSICAL_TREE_REQUIRED/)
  assert.throws(() => validateConfig({ ...cfg, expectedCurrentPreserved: [{ path: '../x', from: A }] }), /INVALID_EXPECTED_CURRENT_PRESERVED/)
  assert.throws(() => validateConfig({ ...cfg, expectedCurrentPreserved: [...preservedForC, ...preservedForC] }), /INVALID_EXPECTED_CURRENT_PRESERVED/)
  assert.throws(() => buildPhysicalTree({ cwd: dir, current: B, preserved: [{ path: '.env.example', from: '0'.repeat(40) }] }))
  assert.throws(() => buildPhysicalTree({ cwd: dir, current: B, preserved: [{ path: 'a/../b', from: A }] }), /UNSAFE_PATH/)
  const rendered = renderTemplate(template, cfg)
  assert.ok(rendered.includes(`'${A}', '.env.example'`) && rendered.includes(`$ExpectedCurrentPhysicalTree = '${pinned}'`))
  assert.ok(rendered.includes('EXPECTED_CURRENT_PHYSICAL_TREE_MISMATCH') && rendered.includes('physical-tree.mjs $ExpectedCurrentCommit @PreservedCurrentSpecs'))
})

test('a path absent at the source commit is absent in the physical tree (production never had it)', () => {
  const tree = buildPhysicalTree({ cwd: dir, current: D, preserved: [{ path: 'api/server.js', from: A }, { path: 'brand-new.txt', from: A }] })
  assert.ok(!treeFiles(tree).includes('brand-new.txt'))
  assert.equal(git('show', `${tree}:api/server.js`), 's1')
})

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
