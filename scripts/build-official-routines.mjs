#!/usr/bin/env node
// Copyright (C) 2026 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Builds the official 2J guided routines ("Entrena con 2J") from the coverage matrix.
 *
 *   node scripts/build-official-routines.mjs           # write api/lib/guided-official.json
 *   node scripts/build-official-routines.mjs --check   # fail if stale or invalid (CI / tests)
 *
 * Pipeline: matrix → each part copied from the official block library as a versioned snapshot
 * (instantiateBlock, deterministic instance ids) → the whole routine validated under the 2J
 * protocol (any FAIL, unverified or unreviewed reason aborts) → level/category/equipment checks →
 * duplicate and similarity checks → collections resolved → versioned JSON. No model, no
 * randomness: the same matrix always produces the same catalogue, so the seed is idempotent.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const imp = p => import(pathToFileURL(join(root, p)).href)
const { EXDB } = await imp('frontend/src/lib/exercises-data.js')
const P = await imp('frontend/src/lib/protocol/index.js')
const { ROUTINES, COLLECTIONS, FEATURED } = await imp('scripts/protocol/official-routines.matrix.mjs')
const LIB = JSON.parse(readFileSync(join(root, 'api', 'lib', 'blocks-official.json'), 'utf8'))

const OUT = join(root, 'api', 'lib', 'guided-official.json')
export const SEED_VERSION = 1
const PUBLISHED = '2026-09-26'
export const CATEGORIES = ['tabata', 'hiit', 'circuit', 'interval', 'mobility', 'core', 'mixed']
// Reasons (PASS_WITH_REASON) a routine may ship with, each reviewed by a person. Empty on purpose.
const REVIEWED_REASONS = {}

const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))
const lookup = id => byId[id] || null
const blockById = Object.fromEntries(LIB.blocks.map(b => [b.id, b]))
const errors = []
const LEVEL_RANK = { beginner: 0, intermediate: 1, advanced: 2 }
const restOf = (e, goal) => e.rest ?? P.REST_DEFAULTS[P.restDemand(P.classify(e.id, lookup), goal, e.role)]

function build(r) {
  const err = m => errors.push(`${r.id}: ${m}`)
  if (!CATEGORIES.includes(r.category)) err('unknown category ' + r.category)
  if (!P.GOALS.includes(r.goal) || !P.LEVELS.includes(r.level)) err('bad goal/level')
  const ex = [], blocks = [], parts = []
  let seconds = 0, n = 0
  for (const [role, src] of r.parts) {
    const b = blockById[src]
    if (!b) { err('unknown block ' + src); continue }
    if (b.active === false) err('inactive block ' + src)
    // Deterministic instance ids: the same matrix always yields the same routine.
    const seq = () => createHash('sha1').update(`${r.id}:${n++}`).digest('hex').slice(0, 8)
    const inst = P.instantiateBlock(b, s => s, seq)
    inst.meta.name = null            // the client names parts from type/role in the viewer's language
    inst.meta.role = role
    inst.meta.seedVersion = b.seedVersion
    blocks.push(inst.meta)
    ex.push(...inst.ex)
    const s = P.isGuided(b.type) ? P.guidedSeconds(inst.ex, b.timing, b.type) : P.estimateSeconds(inst.ex, e => restOf(e, b.goal))
    seconds += s
    parts.push({ iid: inst.meta.iid, role, src, type: b.type, minutes: Math.max(1, Math.round(s / 60)), exercises: inst.ex.length, ...(b.timing ? { timing: b.timing } : {}) })
  }
  const mains = parts.filter(p => p.role === 'main')
  if (!mains.length) err('no main part')
  // category ↔ what the main parts really are
  const mainTypes = mains.map(p => p.type)
  const okCat = {
    tabata: () => mainTypes.every(t => t === 'hiit') && mains.every(p => p.timing?.preset === 'tabata'),
    hiit: () => mainTypes.every(t => t === 'hiit'),
    circuit: () => mainTypes.every(t => t === 'circuit'),
    core: () => mains.every(p => blockById[p.src].focus === 'abs'),
    interval: () => mainTypes.every(t => t === 'interval'),
    mobility: () => parts.every(p => p.type === 'mobility'),
    mixed: () => mains.length >= 2 && mainTypes.some(t => t === 'hiit' || t === 'interval') && mainTypes.some(t => t === 'circuit' || t === 'strength'),
  }[r.category]
  if (okCat && !okCat()) err(`main parts (${mainTypes.join(', ')}) do not match category ${r.category}`)
  // the level on the card is honest: beginner = only beginner pieces; advanced = an advanced main part
  const lv = r.parts.map(([, id]) => blockById[id]?.level).filter(Boolean)
  if (r.level === 'beginner' && lv.some(l => l !== 'beginner')) err('beginner routine with non-beginner parts')
  if (r.level === 'intermediate' && lv.some(l => l === 'advanced')) err('intermediate routine with advanced parts')
  if (r.level === 'advanced' && !mains.some(p => blockById[p.src].level === 'advanced')) err('advanced routine without an advanced main part')
  const goals = new Set(mains.map(p => blockById[p.src].goal))
  if (goals.size !== 1 || !goals.has(r.goal)) err(`goal ${r.goal} differs from its main parts (${[...goals].join(', ')})`)
  // exercises: real, curated or cardio machines, never repeated inside one routine
  const ids = ex.map(e => e.id)
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i)
  if (dup.length) err('repeats ' + [...new Set(dup)].join(', '))
  if (ex.length > P.SESSION_EXERCISES.allow[1]) err(`${ex.length} exercises — more than one session`)
  for (const e of ex) if (!lookup(e.id)) err('unknown exercise ' + e.id)
  // duration, equipment and tags come from the shared routineFacts (same as the server and the app)
  const facts = P.routineFacts({ ex, blocks, goal: r.goal }, lookup, r.lowImpact ? ['low-impact'] : [])
  if (r.lowImpact && !facts.tags.includes('low-impact')) err('marked low impact but has jumps or running')
  if (Math.abs(facts.seconds - seconds) > 1) err('duration mismatch between parts and routineFacts')
  // the whole routine under the protocol, judged as the day it is
  const blockTypes = P.blockTypesOf(blocks)
  const v = P.validateAgainst2JProtocol({ kind: 'routine', goal: r.goal, level: r.level, entries: ex, blockTypes, protocolVersion: P.PROTOCOL_VERSION }, { lookup, official: true })
  if (v.result === 'FAIL') err('FAIL — ' + v.issues.filter(i => i.severity === 'fail').map(i => i.message).join(' | '))
  if (v.issues.some(i => i.severity === 'unverified')) err('has checks that could not be verified')
  const reasons = v.issues.filter(i => i.severity === 'reason').map(i => i.code)
  for (const c of reasons) if (!(REVIEWED_REASONS[r.id] || []).includes(c)) err('unreviewed reason ' + c)
  const evidence = [...new Set(r.parts.flatMap(([, id]) => blockById[id]?.evidence || []))].sort()
  return {
    id: r.id, official: true, active: true, seedVersion: SEED_VERSION, protocolVersion: P.PROTOCOL_VERSION, publishedAt: PUBLISHED,
    category: r.category, name: r.name, subtitle: r.subtitle || null, description: r.description, goal: r.goal, level: r.level, focus: r.focus,
    estimatedMinutes: facts.minutes, equipment: facts.equipment, tags: facts.tags, parts, blocks, ex,
    validation: { result: v.result, reasons }, evidence,
  }
}

const routines = ROUTINES.map(build)

// ── uniqueness and similarity ───────────────────────────────────────────────────────────────
const seen = new Set(), names = new Set()
for (const r of routines) {
  if (seen.has(r.id)) errors.push('duplicate id ' + r.id)
  if (names.has(r.name)) errors.push('duplicate name ' + r.name)
  seen.add(r.id); names.add(r.name)
}
const mainIds = r => new Set(r.parts.filter(p => p.role === 'main').flatMap(p => blockById[p.src].ex.map(e => e.id)))
const mainSeq = r => r.parts.filter(p => p.role === 'main').map(p => p.src).join('>')
for (let i = 0; i < routines.length; i++) for (let j = i + 1; j < routines.length; j++) {
  const a = routines[i], b = routines[j]
  if (mainSeq(a) === mainSeq(b)) errors.push(`${a.id} and ${b.id} have the same main parts (the same workout under another name)`)
  if (a.category !== b.category) continue
  const x = mainIds(a), y = mainIds(b)
  const shared = [...x].filter(k => y.has(k)).length
  const jac = shared / new Set([...x, ...y]).size
  if (jac > 0.6) errors.push(`${a.id} and ${b.id} are too similar (${Math.round(jac * 100)}% of their main exercises)`)
}

// ── collections and featured ────────────────────────────────────────────────────────────────
const asList = v => v == null ? null : [].concat(v)
const collections = COLLECTIONS.map((c, order) => {
  let ids = c.routineIds ? [...c.routineIds] : routines.filter(r => {
    const cats = asList(c.auto?.category)
    if (cats && !cats.includes(r.category)) return false
    if (c.auto?.maxMinutes && r.estimatedMinutes > c.auto.maxMinutes) return false
    if (c.auto?.notCategory && asList(c.auto.notCategory).includes(r.category)) return false
    return true
  }).map(r => r.id)
  for (const x of c.extra || []) if (!ids.includes(x)) ids.push(x)
  for (const x of ids) if (!seen.has(x)) errors.push(`collection ${c.id} lists unknown routine ${x}`)
  if (!ids.length) errors.push(`collection ${c.id} is empty`)
  return { id: c.id, name: c.name, description: c.description, style: c.style, order, active: true, seedVersion: SEED_VERSION, routineIds: ids }
})
for (const id of FEATURED) if (!seen.has(id)) errors.push('featured routine missing: ' + id)
routines.forEach(r => { const k = FEATURED.indexOf(r.id); if (k >= 0) r.featured = k + 1 })

if (errors.length) { console.error(errors.join('\n')); process.exit(1) }

const json = JSON.stringify({ protocolVersion: P.PROTOCOL_VERSION, seedVersion: SEED_VERSION, count: routines.length, routines, collections }, null, 1) + '\n'
if (process.argv.includes('--check')) {
  let cur = null
  try { cur = readFileSync(OUT, 'utf8').replace(/\r\n/g, '\n') } catch { /* missing = stale */ }
  if (cur !== json) { console.error('api/lib/guided-official.json is out of date — run: node scripts/build-official-routines.mjs'); process.exit(1) }
  console.log(`Official guided routines in sync: ${routines.length} routines, ${collections.length} collections.`)
} else {
  writeFileSync(OUT, json)
  const count = k => Object.entries(routines.reduce((m, r) => (m[r[k]] = (m[r[k]] || 0) + 1, m), {})).map(([a, n]) => `${a} ${n}`).join(', ')
  console.log(`Wrote ${routines.length} official guided routines, ${collections.length} collections.`)
  console.log(`  category: ${count('category')}\n  level: ${count('level')}\n  minutes: ${count('estimatedMinutes')}`)
  console.log(`  validation: ${routines.filter(r => r.validation.result === 'PASS').length} PASS, ${routines.filter(r => r.validation.result !== 'PASS').length} other`)
  for (const c of collections) console.log(`  ${c.id}: ${c.routineIds.length}`)
}
