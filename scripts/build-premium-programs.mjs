#!/usr/bin/env node
/* Builds the official Premium seed: api/lib/premium-official.json, from scripts/premium/official-programs.mjs.
 *
 *   node scripts/build-premium-programs.mjs           # validate + write
 *   node scripts/build-premium-programs.mjs --check   # fail if the committed seed is stale or invalid (CI, PrepareOnly)
 *
 * The API reads the JSON from the release on every boot; nothing is generated at runtime, so a redeploy never duplicates anything and an admin's
 * edits (an overlay in DATA/premium.json) are never overwritten by a new seed. Validation: every program passes validateProgram() against the real
 * exercise library (ids exist, none deprecated), ids/slugs are unique, the legal flag is explicit for every third-party method.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OFFICIAL_PROGRAMS, SEED_VERSION } from './premium/official-programs.mjs'
import { validateProgram } from '../frontend/src/lib/premium-model.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'api', 'lib', 'premium-official.json')
const lib = JSON.parse(readFileSync(join(root, 'api', 'coach', 'library.json'), 'utf8')).exercises
const byId = new Map(lib.map(e => [e.id, e]))
const ctx = { exerciseExists: id => byId.has(id), preferred: id => byId.get(id)?.pref || id }

const problems = []
const ids = new Set(), slugs = new Set()
for (const p of OFFICIAL_PROGRAMS) {
  for (const i of validateProgram(p, ctx)) problems.push(`${p.id}: ${i}`)
  if (ids.has(p.id)) problems.push(`${p.id}: duplicate id`)
  if (slugs.has(p.slug)) problems.push(`${p.id}: duplicate slug`)
  ids.add(p.id); slugs.add(p.slug)
  if (!p.legal || !['none', 'review'].includes(p.legal.status)) problems.push(`${p.id}: legal flag missing`)
  if (p.sourceType === 'established' && p.legal.status !== 'review') problems.push(`${p.id}: a third-party method needs legal review`)
  for (const l of p.programDefinition.lifts || []) if (!byId.get(l.exercise)?.rec) problems.push(`${p.id}: lift ${l.key} is not a Recommended 2J exercise`)
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }

const text = JSON.stringify({ seedVersion: SEED_VERSION, count: OFFICIAL_PROGRAMS.length, programs: OFFICIAL_PROGRAMS }, null, 1) + '\n'
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(out, 'utf8').replaceAll('\r\n', '\n') } catch { /* missing */ }
  if (current !== text) { console.error('premium-official.json is out of date: run node scripts/build-premium-programs.mjs'); process.exit(1) }
  console.log(`Premium seed in sync: ${OFFICIAL_PROGRAMS.length} programs, seed v${SEED_VERSION}.`)
} else {
  writeFileSync(out, text)
  console.log(`Wrote ${out} (${OFFICIAL_PROGRAMS.length} programs).`)
}
