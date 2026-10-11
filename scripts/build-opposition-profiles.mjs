#!/usr/bin/env node
/* Builds the official Oposiciones seed: api/lib/opposition-official.json, from scripts/opposition/profiles.mjs.
 *
 *   node scripts/build-opposition-profiles.mjs           # validate + write
 *   node scripts/build-opposition-profiles.mjs --check   # fail if the committed seed is stale or invalid (CI, PrepareOnly)
 *
 * The API reads the JSON from the release on every boot; nothing is generated at runtime, so a redeploy never duplicates anything and an administrator's
 * edits (an overlay in DATA/opposition.json) are never overwritten by a new seed. Validation: every profile passes validateProfile() and carries an
 * explicit official source (organism, reference, date); ids and slugs are unique.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { OFFICIAL_PROFILES, SEED_VERSION } from './opposition/profiles.mjs'
import { validateProfile } from '../frontend/src/lib/opposition-model.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'api', 'lib', 'opposition-official.json')
const problems = []
const ids = new Set(), slugs = new Set()
for (const p of OFFICIAL_PROFILES) {
  for (const i of validateProfile(p)) problems.push(`${p.id}: ${i}`)
  if (ids.has(p.id)) problems.push(`${p.id}: duplicate id`)
  if (slugs.has(p.slug)) problems.push(`${p.id}: duplicate slug`)
  ids.add(p.id); slugs.add(p.slug)
}
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }

const text = JSON.stringify({ seedVersion: SEED_VERSION, count: OFFICIAL_PROFILES.length, profiles: OFFICIAL_PROFILES }, null, 1) + '\n'
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(out, 'utf8').replaceAll('\r\n', '\n') } catch { /* missing */ }
  if (current !== text) { console.error('opposition-official.json is out of date: run node scripts/build-opposition-profiles.mjs'); process.exit(1) }
  console.log(`Opposition seed in sync: ${OFFICIAL_PROFILES.length} profiles, seed v${SEED_VERSION}.`)
} else {
  writeFileSync(out, text)
  console.log(`Wrote ${out} (${OFFICIAL_PROFILES.length} profiles).`)
}
