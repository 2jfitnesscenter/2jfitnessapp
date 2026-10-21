import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderTemplate } from './generate-release-runner.mjs'
import { makeReleaseArchive } from './release-archive.mjs'

/* Regression (verify-current-production: CURRENT_MISMATCH=.dockerignore, production 57 bytes, archive 64): a plain `git archive` applies the repository's .gitattributes EOL
 * rules (`* text=auto`, `*.ps1 text eol=crlf`) with core.eol=CRLF on Windows even when core.autocrlf=false, so the release/rollback archives were not the committed bytes.
 * `-c core.autocrlf=false` alone (the previous fix) does not change that. The archives must be exactly the blobs, whatever this machine's config is. */
const here = path.dirname(fileURLToPath(import.meta.url))
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const runner = renderTemplate(fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8'), base)

test('the runner makes BOTH archives (release and rollback) with release-archive.mjs, never with a plain git archive', () => {
  const lines = runner.split('\n').map(l => l.trim())
  assert.equal(lines.filter(l => /^git\b.*\barchive\b/.test(l)).length, 0, 'no direct git archive left')
  assert.ok(lines.includes('& node ops/deploy-kit/windows/release-archive.mjs $ReleaseSource $Release'))
  assert.ok(lines.includes('& node ops/deploy-kit/windows/release-archive.mjs $CurrentPhysical $RollbackRelease'))
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-eol-'))
const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' }
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env }).trim()
git('init', '-q')
// the real repository's attribute rules, and the settings of the machines that produced the bad archives
fs.writeFileSync(path.join(dir, '.gitattributes'), '* text=auto\n*.js text eol=lf\n*.ps1 text eol=crlf\n*.png binary\n')
git('config', 'core.autocrlf', 'true'); git('config', 'core.eol', 'crlf')
const files = {
  '.dockerignore': '**/node_modules\nmedia\n.env\n',   // text=auto: the file production reported
  'Caddyfile': 'a {\n  b\n}\n',
  'api/server.js': 'a\nb\n',
  'run.ps1': 'Write-Host 1\nWrite-Host 2\n',          // eol=crlf attribute, committed as LF
  'api/Dockerfile': 'FROM node\n',
}
for (const [name, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true }); fs.writeFileSync(path.join(dir, name), text) }
fs.writeFileSync(path.join(dir, 'logo.png'), Buffer.from([0x89, 0x50, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
git('add', '-A'); git('commit', '-q', '-m', 'c')
const COMMIT = git('rev-parse', 'HEAD'), TREE = git('rev-parse', 'HEAD^{tree}')
// relative to the repo dir: GNU tar (Git for Windows) reads 'C:\...' as a remote host
const entry = (archive, name) => { const r = spawnSync('tar', ['-xOzf', path.basename(archive), name], { cwd: dir, encoding: 'buffer' }); assert.equal(r.status, 0, String(r.stderr)); return r.stdout }
const blob = name => Buffer.from(execFileSync('git', ['cat-file', 'blob', `${COMMIT}:${name}`], { cwd: dir }))
const names = [...Object.keys(files), 'logo.png']

test('control: a plain git archive (even with core.autocrlf=false) is NOT the committed bytes under these attributes', () => {
  const plain = path.join(dir, 'plain.tar.gz')
  git('-c', 'core.autocrlf=false', 'archive', '--format=tar.gz', `--output=${plain}`, COMMIT)
  assert.ok(entry(plain, 'run.ps1').includes(13), 'the eol=crlf attribute alone converts run.ps1 whatever core.autocrlf says')
  assert.ok(!entry(plain, 'run.ps1').equals(blob('run.ps1')))
})

test('release-archive.mjs: every file of the archive equals its committed blob, for a commit and for a tree id', () => {
  for (const [what, treeish] of [['commit', COMMIT], ['tree', TREE]]) {
    const out = path.join(dir, `safe-${what}.tar.gz`)
    makeReleaseArchive({ cwd: dir, treeish, output: out })
    for (const name of names) assert.ok(entry(out, name).equals(blob(name)), `${what}: ${name} = committed bytes`)
    assert.ok(!entry(out, '.dockerignore').includes(13) && !entry(out, 'run.ps1').includes(13))
  }
})

test('it refuses to overwrite, a missing tree-ish and an option-looking argument; the real repository is left untouched', () => {
  const out = path.join(dir, 'twice.tar.gz')
  makeReleaseArchive({ cwd: dir, treeish: COMMIT, output: out })
  assert.throws(() => makeReleaseArchive({ cwd: dir, treeish: COMMIT, output: out }), /RELEASE_ARCHIVE_OUTPUT_EXISTS/)
  assert.throws(() => makeReleaseArchive({ cwd: dir, treeish: '0'.repeat(40), output: path.join(dir, 'x.tar.gz') }))
  assert.throws(() => makeReleaseArchive({ cwd: dir, treeish: '--output=evil', output: path.join(dir, 'y.tar.gz') }), /BAD_TREEISH/)
  assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'tracked files unchanged')
  assert.ok(!fs.existsSync(path.join(dir, '.git', 'info', 'attributes')), 'the real info/attributes was not written')
  assert.equal(git('config', 'core.eol'), 'crlf', 'the real config was not changed')
})

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
