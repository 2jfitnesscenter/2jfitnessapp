import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/* The runner finds Git for Windows by walking up from git.exe until a directory holds a bash.exe, whichever of Git\cmd, Git\bin or Git\mingw64\bin git.exe came from.
 * This runs the REAL function out of the template in PowerShell against a fake Git tree. */
const here = path.dirname(fileURLToPath(import.meta.url))
const template = fs.readFileSync(path.join(here, 'templates', 'release-runner.ps1.in'), 'utf8').replace(/\r\n/g, '\n')
const fn = template.slice(template.indexOf('# ---- begin git-root ----'), template.indexOf('# ---- end git-root ----'))
assert.ok(fn.includes('function Resolve-GitRoot'))
const PS = ['pwsh', 'powershell'].find(x => spawnSync(x, ['-NoProfile', '-Command', '1'], { encoding: 'utf8' }).status === 0)

function fakeGit(layout) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gitroot-'))
  const git = path.join(root, 'Git')
  for (const rel of layout) { const p = path.join(git, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '') }
  return { root, git }
}
function resolve(gitExe) {
  const script = `${fn}\ntry { $r = Resolve-GitRoot '${gitExe.replace(/'/g, "''")}'; Write-Output ('ROOT=' + $r.Root); Write-Output ('BASH=' + $r.Bash) } catch { Write-Output ('ERR=' + $_.Exception.Message); exit 3 }`
  const r = spawnSync(PS, ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' })
  return { code: r.status, out: r.stdout }
}
const lines = out => Object.fromEntries(out.split(/\r?\n/).filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))
const REAL = ['bin/bash.exe', 'usr/bin/bash.exe', 'cmd/git.exe', 'bin/git.exe', 'mingw64/bin/git.exe']

test('PowerShell is available for the tooling test', () => assert.ok(PS))

test('git.exe from Git\\cmd, Git\\bin and Git\\mingw64\\bin all resolve to the same root and a bash.exe', () => {
  const { git } = fakeGit(REAL)
  const found = ['cmd', 'bin', 'mingw64/bin'].map(d => lines(resolve(path.join(git, d, 'git.exe')).out))
  for (const r of found) { assert.equal(path.resolve(r.ROOT), path.resolve(git)); assert.ok(fs.existsSync(r.BASH)); assert.match(r.BASH, /bash\.exe$/) }
  assert.equal(new Set(found.map(r => path.resolve(r.ROOT))).size, 1)
  assert.equal(new Set(found.map(r => path.resolve(r.BASH))).size, 1)
})

test('the old fixed two-parent rule would have landed on Git\\mingw64 (the reported failure); the walk does not', () => {
  const { git } = fakeGit(REAL)
  const exe = path.join(git, 'mingw64', 'bin', 'git.exe')
  assert.equal(path.resolve(path.dirname(path.dirname(exe))), path.resolve(git, 'mingw64'))
  assert.equal(fs.existsSync(path.join(git, 'mingw64', 'bin', 'bash.exe')), false)
  assert.equal(path.resolve(lines(resolve(exe).out).ROOT), path.resolve(git))
})

test('a Git whose bash is only under usr\\bin (or only mingw64\\bin) is still found', () => {
  const a = fakeGit(['usr/bin/bash.exe', 'cmd/git.exe'])
  assert.equal(path.resolve(lines(resolve(path.join(a.git, 'cmd', 'git.exe')).out).ROOT), path.resolve(a.git))
  const b = fakeGit(['mingw64/bin/bash.exe', 'mingw64/bin/git.exe'])
  const r = lines(resolve(path.join(b.git, 'mingw64', 'bin', 'git.exe')).out)
  assert.ok(fs.existsSync(r.BASH))
})

test('with no bash.exe anywhere it fails and lists the paths it tried', () => {
  const { git } = fakeGit(['cmd/git.exe'])
  const r = resolve(path.join(git, 'cmd', 'git.exe'))
  assert.equal(r.code, 3)
  assert.match(r.out, /GIT_BASH_NOT_FOUND/)
  for (const rel of ['bin\\bash.exe', 'usr\\bin\\bash.exe', 'mingw64\\bin\\bash.exe']) assert.ok(r.out.includes(path.join(git, 'cmd', rel)) && r.out.includes(path.join(git, rel)), rel)
})

test('the template uses the function in both places and no longer counts parents', () => {
  assert.ok(template.includes('(Resolve-GitRoot (Get-Command git.exe -ErrorAction Stop).Source).Root'))
  assert.ok(template.includes('$GitResolved = Resolve-GitRoot $GitExe'))
  assert.equal(/Split-Path \(Split-Path \$GitExe/.test(template), false)
  assert.equal(/Split-Path \(Split-Path \(Get-Command git\.exe/.test(template), false)
})
