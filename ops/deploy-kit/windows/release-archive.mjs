// Makes a release/rollback tar.gz whose every file is byte-for-byte the committed blob, whatever this machine's git config is.
//
// A plain `git archive` is NOT byte-stable: it applies the EOL conversion of the repository's .gitattributes (`* text=auto`, `*.ps1 text eol=crlf`) using core.eol, which
// is CRLF on Windows, even with core.autocrlf=false. Production holds the committed bytes (LF), so verify-current-production stopped on CURRENT_MISMATCH=.dockerignore
// (57 bytes in production, 64 in the archive). The tree's own .gitattributes cannot be switched off with a -c option, but $GIT_DIR/info/attributes outranks it, so the
// archive is made through a throw-away bare repository that borrows the real object store (objects/info/alternates) and carries a neutral info/attributes. The real
// repository, its config, its index and its work tree are not touched.
//
// Usage: node release-archive.mjs <tree-ish> <output.tar.gz>
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const run = (cwd, args, env = {}) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] }).trim()
// no text conversion, no eol conversion, no keyword expansion, nothing left out
export const NEUTRAL_ATTRIBUTES = '* -text -eol -ident -filter -export-subst -export-ignore\n'

export function makeReleaseArchive({ cwd, treeish, output }) {
  if (!treeish || /^-/.test(treeish)) throw new Error('RELEASE_ARCHIVE_BAD_TREEISH')
  if (!output) throw new Error('RELEASE_ARCHIVE_NO_OUTPUT')
  if (fs.existsSync(output)) throw new Error(`RELEASE_ARCHIVE_OUTPUT_EXISTS:${output}`)
  const objects = path.resolve(cwd, run(cwd, ['rev-parse', '--git-path', 'objects']))
  run(cwd, ['cat-file', '-e', `${treeish}^{tree}`])
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), '2j-release-archive-'))
  try {
    const gitDir = path.join(dir, 'neutral.git')
    run(dir, ['init', '-q', '--bare', gitDir])
    fs.mkdirSync(path.join(gitDir, 'info'), { recursive: true })
    fs.writeFileSync(path.join(gitDir, 'objects', 'info', 'alternates'), objects.replace(/\\/g, '/') + '\n')
    fs.writeFileSync(path.join(gitDir, 'info', 'attributes'), NEUTRAL_ATTRIBUTES)
    // core.autocrlf/core.eol pinned as well: nothing of this machine's config may shape the bytes.
    run(dir, ['--git-dir', gitDir, '-c', 'core.autocrlf=false', '-c', 'core.eol=lf', 'archive', '--format=tar.gz', `--output=${output}`, treeish])
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [treeish, output] = process.argv.slice(2)
    makeReleaseArchive({ cwd: process.cwd(), treeish, output: output && path.resolve(output) })
  } catch (error) {
    console.error(`RELEASE_ARCHIVE_FAILED=${String(error.stderr || error.message).trim()}`)
    process.exitCode = 1
  }
}
