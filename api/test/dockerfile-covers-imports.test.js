import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

// A module that exists in the repository but is not COPY-ed into the image only fails when the container starts. This test reads the Dockerfile and
// every relative import of the code that runs in production and refuses a top-level directory/file that the image would not contain.
const root = path.resolve('.')
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8')
const copied = new Set([...dockerfile.matchAll(/^COPY\s+(?!--from)(\S+)\s+\.\/(\S*)\s*$/gm)].map(match => match[1].replace(/\/$/, '')))

test('every top-level directory or file imported by production code is copied into the image', () => {
  const needed = new Map()
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (['node_modules', 'test', 'tests', 'scripts', 'dist'].includes(entry.name)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { walk(full); continue }
      if (!/\.(js|mjs)$/.test(entry.name)) continue
      const source = fs.readFileSync(full, 'utf8')
      for (const match of source.matchAll(/(?:from\s+|import\s*\(\s*|require\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
        const target = path.relative(root, path.resolve(path.dirname(full), match[1]))
        if (target.startsWith('..')) continue                       // outside api/ (not part of the image)
        const top = target.split(path.sep)[0]
        needed.set(top, path.relative(root, full))
      }
    }
  }
  walk(root)
  const missing = [...needed].filter(([top]) => !copied.has(top) && !copied.has(top + '/') && !copied.has(top.replace(/\.[a-z]+$/, '')))
    .map(([top, firstImporter]) => `${top} (imported by ${firstImporter})`)
  assert.deepEqual(missing, [], 'add a COPY line to api/Dockerfile for each of these, or the container will crash on start')
})

test('the dependencies the integration code imports are declared as production dependencies', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  for (const name of ['zod', '@simplewebauthn/server']) assert.ok(pkg.dependencies?.[name], `${name} must be in dependencies`)
})
