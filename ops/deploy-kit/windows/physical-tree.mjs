// The tree production PHYSICALLY holds after a release, which is not always TREE(commit).
//
// A release can carry repository-only paths (see release-tree.mjs): they are part of the commit but were deliberately not deployed, so production kept the value it
// had before. After such a release the production marker says <commit>, yet on those paths the files on disk are an older value. verify-current-production and the
// rollback archive of the NEXT release must therefore be built from the physical tree, not from TREE(marker commit).
//
// The physical tree is described by data that travels with the manifest, so it is reproducible at every hop of A → B → C → D with nothing but the repository:
//   TREE(expectedCurrentCommit), with every preserved path replaced by its blob at commit `from` (a path missing at `from` is absent in production).
// `from` is always a commit whose blob production really holds for that path (for a path preserved over several releases it is the original commit, not the
// intermediate one: see nextExpectedCurrentPreserved in generate-release-runner.mjs).
//
// Usage: node physical-tree.mjs <expectedCurrentCommit> <from>:<path>...   → prints the 40-hex tree id (nothing is written to the work tree or the real index).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SHA40 = /^[0-9a-f]{40}$/
const git = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })

export function buildPhysicalTree({ cwd, current, preserved }) {
  if (!SHA40.test(current || '')) throw new Error('PHYSICAL_TREE_REQUIRES_FULL_SHA')
  if (!Array.isArray(preserved)) throw new Error('PHYSICAL_TREE_REQUIRES_PRESERVED_LIST')
  if (new Set(preserved.map(e => e.path)).size !== preserved.length) throw new Error('PHYSICAL_TREE_DUPLICATE_PATH')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2j-physical-tree-'))
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') }
  try {
    git(cwd, ['read-tree', current], env)
    for (const { path: p, from } of preserved) {
      if (typeof p !== 'string' || /[\0\r\n*?[\]\\]/.test(p) || p.startsWith('/') || p.split('/').includes('..') || !p) throw new Error(`PHYSICAL_TREE_UNSAFE_PATH:${p}`)
      if (!SHA40.test(from || '')) throw new Error(`PHYSICAL_TREE_BAD_SOURCE:${p}`)
      git(cwd, ['cat-file', '-e', `${from}^{commit}`])
      const old = git(cwd, ['ls-tree', from, '--', p]).trim()
      if (old) {
        const m = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(old)
        if (!m || m[3] !== p) throw new Error(`PHYSICAL_TREE_SOURCE_NOT_A_FILE:${p}`)
        git(cwd, ['update-index', '--add', '--cacheinfo', `${m[1]},${m[2]},${p}`], env)
      } else {
        git(cwd, ['update-index', '--force-remove', '--', p], env)
      }
    }
    const tree = git(cwd, ['write-tree'], env).trim()
    // Post-condition (fail-closed): each preserved path is exactly its source, every other path is exactly TREE(current).
    for (const { path: p, from } of preserved) {
      if (git(cwd, ['ls-tree', tree, '--', p]).trim() !== git(cwd, ['ls-tree', from, '--', p]).trim()) throw new Error(`PHYSICAL_TREE_PATH_NOT_PRESERVED:${p}`)
    }
    const changed = git(cwd, ['diff-tree', '-r', '--name-only', '--no-commit-id', tree, current]).split('\n').filter(Boolean).sort()
    const expected = preserved.filter(({ path: p, from }) => git(cwd, ['ls-tree', from, '--', p]).trim() !== git(cwd, ['ls-tree', current, '--', p]).trim()).map(e => e.path).sort()
    if (JSON.stringify(changed) !== JSON.stringify(expected)) throw new Error('PHYSICAL_TREE_TOUCHED_OTHER_PATHS')
    return tree
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [current, ...specs] = process.argv.slice(2)
    const preserved = specs.map(s => { const i = s.indexOf(':'); return { from: s.slice(0, i), path: s.slice(i + 1) } })
    process.stdout.write(buildPhysicalTree({ cwd: process.cwd(), current, preserved }) + '\n')
  } catch (error) {
    console.error(`PHYSICAL_TREE_FAILED=${error.message}`)
    process.exitCode = 1
  }
}
