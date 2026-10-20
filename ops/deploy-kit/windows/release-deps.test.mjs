import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { renderTemplate } from './generate-release-runner.mjs'

/* PrepareOnly must prepare a clean worktree by itself: npm ci from the lockfile (npm is this repo's package manager), fail-closed, local binaries only, no npx download. */
const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8')
const base = JSON.parse(fs.readFileSync(path.join(here, '../releases/831f691.json'), 'utf8'))
const runner = renderTemplate(template, base)
const code = runner.split('\n').filter(l => !/^\s*#/.test(l)).join('\n')
const fn = runner.slice(runner.indexOf('# <deps-begin>'), runner.indexOf('# <deps-end>'))

test('the repo’s package manager is npm: api and frontend each ship a package-lock.json and no other manager’s lockfile exists', () => {
  const root = path.resolve(here, '../../..')
  for (const d of ['api', 'frontend']) {
    assert.ok(fs.existsSync(path.join(root, d, 'package-lock.json')), d + '/package-lock.json')
    for (const other of ['pnpm-lock.yaml', 'yarn.lock', 'bun.lockb']) assert.ok(!fs.existsSync(path.join(root, d, other)), d + '/' + other)
  }
})

test('both projects are prepared with npm ci before the first local validation; never npm install', () => {
  assert.ok(fn.includes('npm ci --no-audit --no-fund'))
  assert.ok(!/npm\s+install/.test(code), 'npm install is never used')
  const first = code.indexOf('Ensure-NodeDependencies $Frontend'), api = code.indexOf('Ensure-NodeDependencies $Api')
  assert.ok(first > 0 && api > first)
  for (const later of ["Invoke-Checked 'DEPLOY_TOOLING_TESTS'", "Invoke-Checked 'EXPERIENCE_V2_TESTS'", "Invoke-Checked 'API_TESTS'", "Invoke-Checked 'BUILD'", '\nInvoke-FrontendTests\n'])
    assert.ok(code.indexOf(later) > api, later + ' runs after the dependencies are ready')
})

test('fail-closed: a missing lockfile, a failed install and an incomplete install all throw', () => {
  assert.match(fn, /DEPS_LOCKFILE_MISSING/)
  assert.match(fn, /DEPS_INSTALL_FAILED/)
  assert.match(fn, /DEPS_INSTALL_INCOMPLETE/)
  assert.match(fn, /DEPS_PACKAGE_JSON_MISSING/)
})

test('no npx anywhere in the executable runner (nothing is downloaded ad hoc), and vitest runs from the project’s node_modules', () => {
  assert.ok(!/\bnpx\b/.test(code), 'no npx')
  assert.ok(code.includes("$VitestBin = Join-Path $Frontend 'node_modules/vitest/vitest.mjs'"))
  assert.ok(code.includes('VITEST_LOCAL_BINARY_MISSING'))
  const uses = code.split('\n').filter(l => /vitest/i.test(l) && /cmd\.exe|Invoke-Checked/.test(l) && /\brun\b/.test(l))
  assert.ok(uses.length >= 3)
  for (const l of uses) assert.ok(l.includes('$VitestBin'), l.slice(0, 120))
})

const pwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']).status === 0
test('the rendered runner is valid PowerShell', { skip: !pwsh }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-parse-'))
  const file = path.join(tmp, 'runner.ps1'); fs.writeFileSync(file, runner)
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', `$e=$null;$t=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('${file.replace(/'/g, "''")}',[ref]$t,[ref]$e); if($e.Count){$e|%{$_.Message};exit 1}`], { encoding: 'utf8' })
  fs.rmSync(tmp, { recursive: true, force: true })
  assert.equal(r.status, 0, r.stdout + r.stderr)
})

// Behaviour of the real function from the rendered runner, with a fake npm on PATH (Windows runner only: it drives cmd.exe).
const behave = { skip: !(pwsh && process.platform === 'win32') }
function scenario({ lock = true, installed = false, fail = false, pkg = { dependencies: { foo: '1.0.0' } } }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-deps-'))
  const proj = path.join(tmp, 'frontend'), bin = path.join(tmp, 'bin'), log = path.join(tmp, 'npm-calls.log')
  fs.mkdirSync(proj, { recursive: true }); fs.mkdirSync(bin)
  fs.writeFileSync(path.join(proj, 'package.json'), JSON.stringify(pkg))
  if (lock) fs.writeFileSync(path.join(proj, 'package-lock.json'), '{}')
  if (installed) { fs.mkdirSync(path.join(proj, 'node_modules/foo'), { recursive: true }); fs.writeFileSync(path.join(proj, 'node_modules/foo/package.json'), '{}') }
  fs.writeFileSync(path.join(bin, 'npm.cmd'), `@echo off\r\necho %* >> "${log}"\r\nif "${fail ? '1' : '0'}"=="1" exit /b 1\r\nmkdir node_modules\\foo 2>nul\r\necho {} > node_modules\\foo\\package.json\r\nexit /b 0\r\n`)
  const script = `Set-StrictMode -Version Latest; $ErrorActionPreference='Stop'; $ValidationDir='${tmp.replace(/'/g, "''")}'\n${fn}\ntry { Ensure-NodeDependencies '${proj.replace(/'/g, "''")}'; 'RESULT=OK' } catch { 'RESULT=THROW:' + $_.Exception.Message }`
  const file = path.join(tmp, 'case.ps1'); fs.writeFileSync(file, script)
  const r = spawnSync('pwsh', ['-NoProfile', '-File', file], { encoding: 'utf8', env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH } })
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : ''
  const out = r.stdout
  fs.rmSync(tmp, { recursive: true, force: true })
  return { out, calls }
}

test('clean worktree (no node_modules): npm ci runs once, from the lockfile, and the preparation succeeds', behave, () => {
  const s = scenario({})
  assert.match(s.out, /DEPS_INSTALL=/); assert.match(s.out, /DEPS_INSTALLED=/); assert.match(s.out, /RESULT=OK/)
  assert.equal(s.calls, 'ci --no-audit --no-fund')
})

test('dependencies already installed: reused, no install', behave, () => {
  const s = scenario({ installed: true })
  assert.match(s.out, /DEPS_REUSED=/); assert.match(s.out, /RESULT=OK/)
  assert.equal(s.calls, '')
})

test('a failing npm ci fails the preparation (nothing else is tried)', behave, () => {
  const s = scenario({ fail: true })
  assert.match(s.out, /RESULT=THROW:DEPS_INSTALL_FAILED=/)
  assert.equal(s.calls, 'ci --no-audit --no-fund')
})

test('no lockfile: fails before npm is ever called', behave, () => {
  const s = scenario({ lock: false })
  assert.match(s.out, /RESULT=THROW:DEPS_LOCKFILE_MISSING=/)
  assert.equal(s.calls, '')
})

// The runner runs under Set-StrictMode -Version Latest: an absent section must not throw PropertyNotFoundStrict.
test('package.json with only dependencies / only devDependencies / both / neither: no strict-mode error, npm ci only when something declared is missing', behave, () => {
  assert.match(runner, /Set-StrictMode -Version Latest/)
  const only = scenario({ pkg: { dependencies: { foo: '1.0.0' } } })
  assert.doesNotMatch(only.out, /PropertyNotFound/); assert.match(only.out, /RESULT=OK/); assert.equal(only.calls, 'ci --no-audit --no-fund')
  const dev = scenario({ pkg: { devDependencies: { foo: '1.0.0' } } })
  assert.doesNotMatch(dev.out, /PropertyNotFound/); assert.match(dev.out, /RESULT=OK/); assert.equal(dev.calls, 'ci --no-audit --no-fund')
  const both = scenario({ pkg: { dependencies: { foo: '1.0.0' }, devDependencies: { bar: '1.0.0' } }, installed: true })
  assert.doesNotMatch(both.out, /PropertyNotFound/); assert.match(both.out, /DEPS_INSTALL=.*missing 1 of 2/); assert.match(both.out, /RESULT=THROW:DEPS_INSTALL_INCOMPLETE=.*bar/); assert.equal(both.calls, 'ci --no-audit --no-fund')
  const none = scenario({ pkg: { name: 'x' } })
  assert.doesNotMatch(none.out, /PropertyNotFound/); assert.match(none.out, /DEPS_REUSED=.*declared=0/); assert.match(none.out, /RESULT=OK/); assert.equal(none.calls, '', 'nothing declared: nothing invented, nothing installed')
  const empty = scenario({ pkg: { dependencies: {}, devDependencies: null } })
  assert.doesNotMatch(empty.out, /PropertyNotFound/); assert.match(empty.out, /RESULT=OK/)
})
