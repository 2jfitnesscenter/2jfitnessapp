// Rebuild/check the asset-level provenance ledger for Exercise Library media.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const output = join(root, 'docs/legal/exercise-media-inventory.csv')
const DATASET_REV = '7455efae41b330c265e7cd4b78dfa848e7ce5ebd'
const { EXDB } = await import(pathToFileURL(join(root, 'frontend/src/lib/exercises-data.js')).href)
const { STRETCHES } = await import(pathToFileURL(join(root, 'frontend/src/lib/stretches.js')).href)
const esc = value => `"${String(value ?? '').replaceAll('"', '""')}"`
const rows = [[
  'asset', 'exercise_ids', 'source', 'rights_status', 'license', 'attribution_required',
  'redistribution', 'commercial_use', 'modification', 'evidence', 'notes',
]]

for (const ex of [...EXDB].sort((a, b) => String(a.id).localeCompare(String(b.id)))) {
  rows.push([
    `frontend/src/lib/exercises-data.js#${ex.id}`, ex.id,
    'hasaneyldrm/exercises-dataset (non-media exercise data)', 'UPSTREAM_LICENSED', 'MIT',
    'Yes — retain copyright and MIT notice', 'Yes, under MIT notice conditions', 'Yes, under MIT', 'Yes, under MIT',
    `https://github.com/hasaneyldrm/exercises-dataset/blob/${DATASET_REV}/LICENSE; https://github.com/hasaneyldrm/exercises-dataset/blob/${DATASET_REV}/NOTICE.md`,
    'Exercise metadata/instructions only; does not include image/GIF rights. 2J taxonomy and overrides are separate project code.'
  ])
  for (const [kind, file] of [['thumbnail', ex.img], ['animation', ex.gif]]) {
    if (!file) continue
    rows.push([
      `media/${kind === 'thumbnail' ? 'img' : 'gif'}/${file}`, ex.id,
      'hasaneyldrm/exercises-dataset → Gym visual', 'UNKNOWN_OR_UNVERIFIED',
      'Gym visual copyright; upstream repository has separate written permission and refers to Gym visual terms; no 2J grant evidenced',
      'Yes — © Gym visual — https://gymvisual.com/; upstream permission limits media to 180×180',
      'Not cleared for 2J; upstream explicitly says cloning does not grant downstream rights',
      'Not cleared for 2J', 'Not cleared for 2J',
      `https://github.com/hasaneyldrm/exercises-dataset/blob/${DATASET_REV}/LICENSE; https://github.com/hasaneyldrm/exercises-dataset/blob/${DATASET_REV}/NOTICE.md; scripts/fetch-media.sh; docker-compose.yml`,
      'Media is excluded from the dataset MIT licence. The mobile CDN and restored web fetch use this pinned revision; old runtime cache provenance was not recorded. The owner has chosen to re-enable display; this is not evidence of a 2J grant or ownership. See THIRD_PARTY_NOTICES.md.'
    ])
  }
}

const stretchRoot = join(root, 'frontend/public/stretch')
const referenced = new Map()
for (const stretch of STRETCHES) {
  if (!stretch.img) continue
  const key = basename(stretch.img)
  referenced.set(key, [...(referenced.get(key) || []), stretch.id])
}
for (const file of readdirSync(stretchRoot).filter(x => /\.(png|jpe?g|gif|webp|svg|mp4|webm)$/i.test(x)).sort()) {
  rows.push([
    `frontend/public/stretch/${file}`, (referenced.get(file) || []).sort().join(';'),
    '2J repository; stretches.js comment says Juanjo supplied the illustrations, but creator/license evidence is not recorded',
    'UNKNOWN_OR_UNVERIFIED', 'Not documented', 'Unknown', 'Unknown', 'Unknown', 'Unknown',
    'frontend/src/lib/stretches.js comment; git history for frontend/public/stretch',
    referenced.has(file) ? 'Display re-enabled by project-owner decision; creator/license evidence remains unverified and is not asserted. See THIRD_PARTY_NOTICES.md.' : 'Tracked asset not referenced by the current stretch catalogue; provenance/rights remain unverified. See THIRD_PARTY_NOTICES.md.'
  ])
}

const csv = rows.map(row => row.map(esc).join(',')).join('\n') + '\n'
if (process.argv.includes('--check')) {
  let current = ''
  try { current = readFileSync(output, 'utf8').replace(/\r\n/g, '\n') } catch {}
  if (current !== csv) {
    console.error('EXERCISE_MEDIA_INVENTORY_STALE')
    process.exit(1)
  }
  console.log(`EXERCISE_MEDIA_INVENTORY_OK rows=${rows.length - 1}`)
} else {
  mkdirSync(dirname(output), { recursive: true })
  writeFileSync(output, csv, 'utf8')
  console.log(`EXERCISE_MEDIA_INVENTORY_WRITTEN rows=${rows.length - 1}`)
}
