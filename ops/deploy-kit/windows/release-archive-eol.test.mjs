import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderTemplate } from './generate-release-runner.mjs'

/* Regression (verify-current-production: CURRENT_MISMATCH=.dockerignore): the release/rollback archives were made with a plain `git archive`, which on a machine with
 * core.autocrlf=true ships CRLF for every text file, while production holds the committed LF bytes. The archives must not depend on the machine's config. */
const here = path.dirname(fileURLToPath(import.meta.url))
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const runner = renderTemplate(fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8'), base)
const archiveLines = runner.split('\n').filter(l => /^git\b.*\barchive\b/.test(l.trim()))

test('every git archive of the runner (release and rollback) ignores core.autocrlf', () => {
  assert.equal(archiveLines.length, 2)
  for (const l of archiveLines) assert.match(l, /^git -c core\.autocrlf=false archive --format=tar\.gz --output=\$\w+ \$\w+$/, l)
})

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archive-eol-'))
const git = (...a) => execFileSync('git', a, { cwd: dir, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } }).trim()
git('init', '-q'); git('config', 'core.autocrlf', 'true')   // the machine that produced the bad archive
fs.writeFileSync(path.join(dir, '.dockerignore'), '**/node_modules\nmedia\n.env\n')
fs.mkdirSync(path.join(dir, 'api'), { recursive: true }); fs.writeFileSync(path.join(dir, 'api/server.js'), 'a\nb\n')
git('add', '-A'); git('commit', '-q', '-m', 'c')
const COMMIT = git('rev-parse', 'HEAD')
// relative to the repo dir: GNU tar (Git for Windows) reads 'C:\...' as a remote host
const entry = (archive, name) => { const r = spawnSync('tar', ['-xOzf', path.basename(archive), name], { cwd: dir, encoding: 'buffer' }); assert.equal(r.status, 0, String(r.stderr)); return r.stdout }
const blob = name => Buffer.from(execFileSync('git', ['cat-file', 'blob', `${COMMIT}:${name}`], { cwd: dir }))

test('with core.autocrlf=true a plain git archive is CRLF (control), the runner’s form is the committed LF bytes', () => {
  const plain = path.join(dir, 'plain.tar.gz'), safe = path.join(dir, 'safe.tar.gz')
  git('archive', '--format=tar.gz', `--output=${plain}`, COMMIT)
  // the exact argument shape of the runner line, with its variables filled in
  const line = archiveLines[0].replace(/^git /, '').replace('$Release', 'OUT').replace('$ReleaseSource', COMMIT).split(' ')
  git(...line.map(x => x === 'OUT' ? safe : x.replace(/^--output=OUT$/, `--output=${safe}`)))
  for (const name of ['.dockerignore', 'api/server.js']) {
    assert.ok(entry(plain, name).includes(13), 'control: plain archive has CR in ' + name)
    assert.ok(entry(safe, name).equals(blob(name)), 'runner archive = committed bytes for ' + name)
    assert.ok(!entry(safe, name).includes(13), 'no CR in ' + name)
  }
})

test.after(() => fs.rmSync(dir, { recursive: true, force: true }))
