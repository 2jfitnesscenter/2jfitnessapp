#!/usr/bin/env node
/* Builds the official 2J block library from the coverage matrix.
 *
 *   node scripts/build-official-blocks.mjs           # write api/lib/blocks-official.json
 *   node scripts/build-official-blocks.mjs --check   # fail if stale or invalid (CI / tests)
 *
 * Pipeline (docs/TRAINING_PROTOCOL_2J.md): matrix → prescription by the protocol → validation
 * (any FAIL aborts) → id/equipment check → duplicate and diversity checks → versioned JSON.
 * Deterministic: no model, no randomness — the same matrix always produces the same library,
 * so the seed on the server is idempotent and every change is a reviewable diff.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const imp = p => import(pathToFileURL(join(root, p)).href)
const { EXDB } = await imp('frontend/src/lib/exercises-data.js')
const P = await imp('frontend/src/lib/protocol/index.js')
const { MATRIX, REVISIONS = {} } = await imp('scripts/protocol/official-blocks.matrix.mjs')

const OUT = join(root, 'api', 'lib', 'blocks-official.json')
export const SEED_VERSION = 1
// Equipment the official "2J Fitness Center" library may use — what the gym actually has
// (lib/equipment.js models its dumbbells, plates and machines). Bands, kettlebells, balls
// and other kit are left out rather than assumed.
const GYM_EQ = new Set(['barbell', 'dumbbell', 'cable', 'leverage machine', 'smith machine', 'ez barbell', 'body weight',
  'sled machine', 'trap bar', 'weighted', 'assisted', 'stationary bike', 'elliptical machine', 'stepmill machine'])

const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))
const lookup = id => byId[id] || null
const errors = []

function parseSpec(spec) {
  const [id, opt] = String(spec).split(':')
  const o = {}
  if (opt) { const [k, v] = opt.split('='); o[k] = v }
  return { id, ...o }
}

function buildBlock([focus, goal, level, variant, style, exercises, opts = {}]) {
  const type = opts.type || 'strength'
  const guided = P.isGuided(type)
  const id = ['off', focus, goal, level, variant || 'x'].join('-').toLowerCase() + (type === 'superset' ? '-ss' : '') + (type === 'cardio' && focus !== 'cardio' ? '-cardio' : '')
    + (guided ? '-' + type : '')
  const ex = []
  let sgN = 0, position = 0
  const units = exercises.map(u => Array.isArray(u) ? u : [u])
  for (const unit of units) {
    const sg = unit.length > 1 ? 'a' + (++sgN) : null
    for (const spec of unit) {
      const s = parseSpec(spec)
      const c = P.classify(s.id, lookup)
      if (!lookup(s.id)) { errors.push(`${id}: unknown exercise ${s.id}`); continue }
      // Official blocks only use exercises whose taxonomy is curated (lib/protocol/catalog.js) — a
      // name-based guess is never enough for what the library promises. Cardio is a library fact.
      if (!c.curated && lookup(s.id).bp !== 'cardio') errors.push(id + ': ' + s.id + ' is not in the curated catalogue')
      if (!GYM_EQ.has(lookup(s.id).eq)) errors.push(`${id}: ${s.id} uses "${lookup(s.id).eq}", not 2J equipment`)
      let e
      if (guided && lookup(s.id).bp === 'cardio') {
        // A cardio machine inside a timed block works in bouts (applyTiming sets their length).
        e = { id: s.id, sets: 1, mode: 'time', sec: 60, weight: 0 }
      } else if (s.cardio) {
        const [min, speed] = s.cardio.split('@').map(Number)
        e = { id: s.id, sets: 1, min, speed }
      } else if (s.time) {
        const sets = level === 'beginner' ? 2 : 3
        e = { id: s.id, sets, mode: 'time', sec: Number(s.time), weight: 0, rpe: Array.from({ length: sets }, (_, i) => i === 0 ? 6 : 8), rest: 60 }
      } else {
        e = { id: s.id, ...P.prescribe(c, { goal, level, position, role: s.role || null }) }
      }
      if (sg) {
        e.sg = sg
        // The pair rests once, after its last exercise; the first one transitions straight on.
        if (unit.indexOf(spec) < unit.length - 1) delete e.rest
      }
      ex.push(e)
      position++
    }
  }
  const timing = guided ? P.sanitizeTiming(opts.timing, type) : null
  const block = {
    id, official: true, active: true, seedVersion: REVISIONS[id] || SEED_VERSION, protocolVersion: P.PROTOCOL_VERSION,
    type, goal, level, focus, variant: variant || null, style, ex: guided ? P.applyTiming(ex, type, timing) : ex, ...(timing ? { timing } : {}),
    evidence: [...new Set(P.RULES.filter(r => relevantRule(r.id, goal, type)).flatMap(r => r.evidence))].sort(),
    createdBy: '2j', createdAt: '2026-09-25', updatedAt: '2026-09-25',
  }
  Object.assign(block, P.deriveBlockMeta(block, lookup))
  const v = P.validateAgainst2JProtocol({ kind: 'block', goal, level, type, focus, entries: block.ex, protocolVersion: block.protocolVersion }, { lookup, official: true })
  if (v.issues.some(i => i.severity === 'unverified')) errors.push(id + ': has checks that could not be verified')
  if (v.result === 'FAIL') errors.push(`${id}: FAIL — ${v.issues.filter(i => i.severity === 'fail').map(i => i.message).join(' | ')}`)
  block.validation = { result: v.result, reasons: v.issues.filter(i => i.severity === 'reason').map(i => ({ code: i.code, reason: i.reason })) }
  return block
}
function relevantRule(rid, goal, type) {
  const g = { hypertrophy: '2J-RULE-REPS-HYP', strength: '2J-RULE-REPS-STR', general: '2J-RULE-REPS-GEN', endurance: '2J-RULE-REPS-END', power: '2J-RULE-POWER', beginner: '2J-RULE-BEGINNER' }[goal]
  return rid === g || rid === '2J-RULE-RPE10' || (type === 'superset' && rid === '2J-RULE-SUPERSET') || (goal === 'hypertrophy' && rid === '2J-RULE-VOLUME')
    || (['interval', 'hiit', 'mobility'].includes(type) && rid === '2J-HEU-INTERVAL-ROUNDS')
}

const blocks = MATRIX.map(buildBlock)

// ── duplicates and diversity ────────────────────────────────────────────────────────────
const ids = new Set()
for (const b of blocks) { if (ids.has(b.id)) errors.push(`duplicate block id ${b.id}`); ids.add(b.id) }
// Same exercises in the same format and pace = the same block. A bike Tabata and bike intervals
// share an exercise but are different sessions, so type and timing are part of the signature.
const sig = b => [b.type, JSON.stringify(b.timing || null), b.ex.map(e => e.id).sort().join(',')].join('|')
const seen = new Map()
for (const b of blocks) {
  if (seen.has(sig(b))) errors.push(`${b.id} has exactly the same exercises as ${seen.get(sig(b))}`)
  seen.set(sig(b), b.id)
  const repeated = b.ex.map(e => e.id).filter((x, i, a) => a.indexOf(x) !== i)
  if (repeated.length) errors.push(`${b.id} repeats ${repeated.join(', ')}`)
}
// A/B/C of one family must be genuinely different: at most half their exercises shared, and
// not the same set of movement patterns.
const families = {}
for (const b of blocks) if (b.variant) (families[[b.focus, b.goal, b.level, b.type].join('|')] ||= []).push(b)
for (const fam of Object.values(families)) for (let i = 0; i < fam.length; i++) for (let j = i + 1; j < fam.length; j++) {
  const a = new Set(fam[i].ex.map(e => e.id)), c = new Set(fam[j].ex.map(e => e.id))
  const shared = [...a].filter(x => c.has(x)).length
  const jac = shared / new Set([...a, ...c]).size
  if (jac > 0.5) errors.push(`${fam[i].id} and ${fam[j].id} are too similar (${Math.round(jac * 100)}% shared)`)
  const pat = b => b.ex.map(e => P.classify(e.id, lookup)).map(P.redundancyKey).sort().join(',')
  if (pat(fam[i]) === pat(fam[j])) errors.push(`${fam[i].id} and ${fam[j].id} repeat the same patterns`)
}

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }

for (const rid of Object.keys(REVISIONS)) if (!ids.has(rid)) { console.error(`REVISIONS names ${rid}, which is not in the matrix`); process.exit(1) }
// The library's version is its newest block's: a per-block revision moves the seed as a whole.
const seedVersion = Math.max(SEED_VERSION, ...blocks.map(b => b.seedVersion))
const json = JSON.stringify({ protocolVersion: P.PROTOCOL_VERSION, seedVersion, count: blocks.length, blocks }, null, 1) + '\n'
if (process.argv.includes('--check')) {
  let cur = null
  try { cur = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') } catch { /* missing = stale */ }
  if (cur !== json) { console.error('api/lib/blocks-official.json is out of date — run: node scripts/build-official-blocks.mjs'); process.exit(1) }
  console.log(`Official library in sync: ${blocks.length} blocks.`)
} else {
  writeFileSync(OUT, json)
  const count = k => Object.entries(blocks.reduce((m, b) => (m[b[k]] = (m[b[k]] || 0) + 1, m), {})).map(([a, n]) => `${a} ${n}`).join(', ')
  console.log(`Wrote ${blocks.length} official blocks.\n  goal: ${count('goal')}\n  level: ${count('level')}\n  type: ${count('type')}\n  focus: ${count('focus')}`)
  const reasons = blocks.filter(b => b.validation.result === 'PASS_WITH_REASON')
  console.log(`  validation: ${blocks.length - reasons.length} PASS, ${reasons.length} PASS_WITH_REASON`)
  for (const b of reasons) console.log(`   · ${b.id}: ${b.validation.reasons.map(r => r.code).join(', ')}`)
}
