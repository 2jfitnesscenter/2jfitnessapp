import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { buildReleaseTree } from './release-tree.mjs'

// A throwaway repository: a production baseline and a later target that changes deployable and repository-only paths.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-tree-'))
const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
const put = (p, text) => { fs.mkdirSync(path.dirname(path.join(dir, p)), { recursive: true }); fs.writeFileSync(path.join(dir, p), text) }
git('init', '-q'); git('config', 'core.autocrlf', 'false')
put('api/a.js', 'one\n'); put('.gitignore', 'node_modules\n'); put('.gitattributes', '* -text\n'); put('README.md', 'r\n')
git('add', '-A'); git('commit', '-q', '-m', 'prod')
const PROD = git('rev-parse', 'HEAD')
put('api/a.js', 'two\n'); put('.gitignore', 'node_modules\nbenchmarks/\n'); put('.gitattributes', '* text=auto\n'); put('.env.example', 'X=1\n')
put('ops/deploy-kit/windows/new.mjs', 'x\n'); put('api/b.js', 'new\n')
git('add', '-A'); git('commit', '-q', '-m', 'target')
const TARGET = git('rev-parse', 'HEAD')
const entry = (rev, p) => git('ls-tree', rev, '--', p)
const NON = ['.gitignore', '.gitattributes', '.env.example', 'ops/deploy-kit/windows/new.mjs']

test('repository-only paths come out exactly as in the baseline (or absent), every other path as in the target', () => {
  const tree = buildReleaseTree({ cwd: dir, target: TARGET, baseline: PROD, nonDeployable: NON })
  assert.match(tree, /^[0-9a-f]{40}$/)
  assert.equal(entry(tree, '.gitignore'), entry(PROD, '.gitignore'), 'modified repo-only file = the production version')
  assert.equal(entry(tree, '.gitattributes'), entry(PROD, '.gitattributes'))
  assert.equal(entry(tree, '.env.example'), '', 'a repo-only file production never had is not in the release')
  assert.equal(entry(tree, 'ops/deploy-kit/windows/new.mjs'), '')
  assert.equal(entry(tree, 'api/a.js'), entry(TARGET, 'api/a.js'), 'deployable paths are the target’s')
  assert.equal(entry(tree, 'api/b.js'), entry(TARGET, 'api/b.js'))
  assert.equal(entry(tree, 'README.md'), entry(TARGET, 'README.md'))
})

test('the archive-vs-baseline delta of that tree is exactly the deployable paths', () => {
  const tree = buildReleaseTree({ cwd: dir, target: TARGET, baseline: PROD, nonDeployable: NON })
  const delta = git('diff-tree', '-r', '--name-only', '--no-commit-id', PROD, tree).split('\n').filter(Boolean).sort()
  assert.deepEqual(delta, ['api/a.js', 'api/b.js'])
})

test('nothing is written to the real index or the work tree', () => {
  const before = git('status', '--porcelain')
  buildReleaseTree({ cwd: dir, target: TARGET, baseline: PROD, nonDeployable: NON })
  assert.equal(git('status', '--porcelain'), before)
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'node_modules\nbenchmarks/\n')
})

test('fail-closed: unknown, directory, glob, traversal, duplicate and short-SHA inputs are refused', () => {
  const run = nonDeployable => () => buildReleaseTree({ cwd: dir, target: TARGET, baseline: PROD, nonDeployable })
  assert.throws(run(['not/in/target.js']), /PATH_NOT_IN_TARGET/)
  assert.throws(run(['api']), /NOT_A_FILE/)
  assert.throws(run(['api/*.js']), /UNSAFE_PATH/)
  assert.throws(run(['../x']), /UNSAFE_PATH/)
  assert.throws(run(['.gitignore', '.gitignore']), /DUPLICATE/)
  assert.throws(run([]), /REQUIRES_PATHS/)
  assert.throws(() => buildReleaseTree({ cwd: dir, target: 'abc1234', baseline: PROD, nonDeployable: NON }), /FULL_SHAS/)
})

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
