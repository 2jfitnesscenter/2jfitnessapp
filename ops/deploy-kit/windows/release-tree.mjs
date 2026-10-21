// Builds the tree a release archive is made from when some paths of the Git delta are repository-only (never deployed).
//
// The release is the target tree, except that every declared non-deployable path is put back EXACTLY as it is in the production baseline (the same blob and
// mode, or absent if the baseline never had it). The archive of that tree then differs from the baseline archive only in the deployable paths, so a
// non-deployable path can neither reach production nor make the archive-vs-archive delta check disagree with the manifest.
//
// Usage: node release-tree.mjs <targetCommit> <baselineCommit> <path>...   → prints the 40-hex tree id (nothing is written to the work tree or the real index).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const SHA40 = /^[0-9a-f]{40}$/

function git(cwd, args, env = {}) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
}

export function buildReleaseTree({ cwd, target, baseline, nonDeployable }) {
  if (!SHA40.test(target || '') || !SHA40.test(baseline || '')) throw new Error('RELEASE_TREE_REQUIRES_FULL_SHAS')
  if (!Array.isArray(nonDeployable) || !nonDeployable.length) throw new Error('RELEASE_TREE_REQUIRES_PATHS')
  if (new Set(nonDeployable).size !== nonDeployable.length) throw new Error('RELEASE_TREE_DUPLICATE_PATH')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2j-release-tree-'))
  const env = { GIT_INDEX_FILE: path.join(dir, 'index') }
  try {
    git(cwd, ['read-tree', target], env)
    for (const p of nonDeployable) {
      // Exact path only: ls-tree with a literal pathspec; a directory, a glob or an unknown name is refused.
      if (/[\0\r\n*?[\]\\]/.test(p) || p.startsWith('/') || p.split('/').includes('..')) throw new Error(`RELEASE_TREE_UNSAFE_PATH:${p}`)
      const inTarget = git(cwd, ['ls-tree', target, '--', p]).trim()
      const old = git(cwd, ['ls-tree', baseline, '--', p]).trim()
      // A path the target no longer has is accepted only when the baseline (the physical production tree) holds it: it stays exactly as production has it.
      if (!inTarget && !old) throw new Error(`RELEASE_TREE_PATH_NOT_IN_TARGET:${p}`)
      if (inTarget && !inTarget.startsWith('100644 blob') && !inTarget.startsWith('100755 blob')) throw new Error(`RELEASE_TREE_NOT_A_FILE:${p}`)
      if (old) {
        const m = /^(100644|100755) blob ([0-9a-f]{40})\t(.+)$/.exec(old)
        if (!m || m[3] !== p) throw new Error(`RELEASE_TREE_BASELINE_NOT_A_FILE:${p}`)
        git(cwd, ['update-index', '--add', '--cacheinfo', `${m[1]},${m[2]},${p}`], env)
      } else {
        git(cwd, ['update-index', '--force-remove', '--', p], env)
      }
    }
    const tree = git(cwd, ['write-tree'], env).trim()
    // Post-condition (fail-closed): each non-deployable path is now identical to the baseline, and every other path identical to the target.
    for (const p of nonDeployable) {
      const a = git(cwd, ['ls-tree', tree, '--', p]).trim(), b = git(cwd, ['ls-tree', baseline, '--', p]).trim()
      if (a !== b) throw new Error(`RELEASE_TREE_NON_DEPLOYABLE_LEAKED:${p}`)
    }
    const changed = git(cwd, ['diff-tree', '-r', '--name-only', '--no-commit-id', tree, target]).split('\n').filter(Boolean).sort()
    if (JSON.stringify(changed) !== JSON.stringify([...nonDeployable].filter(p => git(cwd, ['ls-tree', baseline, '--', p]).trim() !== git(cwd, ['ls-tree', target, '--', p]).trim()).sort())) throw new Error('RELEASE_TREE_TOUCHED_OTHER_PATHS')
    return tree
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [target, baseline, ...paths] = process.argv.slice(2)
    process.stdout.write(buildReleaseTree({ cwd: process.cwd(), target, baseline, nonDeployable: paths }) + '\n')
  } catch (error) {
    console.error(`RELEASE_TREE_FAILED=${error.message}`)
    process.exitCode = 1
  }
}
