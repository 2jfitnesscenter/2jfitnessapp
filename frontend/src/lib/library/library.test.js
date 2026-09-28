// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EXDB } from '../exercises-data.js'
import esNames from '../../names/es.js'
import { classify } from '../protocol/classify.js'
import { MOVEMENT_BY_ID, EQUIPMENT_BY_ID, equipmentIdOf, validateAgainst2JProtocol } from '../protocol/index.js'
import { checkLibrary, facetsOf, RECOMMENDED, isDeprecated, preferredOf, similarVariants, aliasIndexOf, norm } from './core.js'
import { DEPRECATED, EXTRA_RECOMMENDED, ALIASES, REVIEWED_VARIANTS } from './overrides.js'

/* Exercise Library V2 — identity is the dataset id; everything else is metadata on top. */
const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..', '..', '..', '..')
const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'))
const X = Object.fromEntries(EXDB.map(e => [e.id, e]))
const OFFICIAL = new Set([
  ...json('api/lib/blocks-official.json').blocks.flatMap(b => b.ex.map(e => e.id)),
  ...json('api/lib/guided-official.json').routines.flatMap(r => r.ex.map(e => e.id)),
])

describe('taxonomy and integrity', () => {
  it('the library passes its own check (the same one scripts/check-exercise-library.mjs runs)', () => {
    const r = checkLibrary({ es: esNames, officialIds: OFFICIAL })
    expect(r.errors).toEqual([])
  })
  it('ids are preserved: 1324 records, unique, none removed or renumbered', () => {
    expect(EXDB).toHaveLength(1324)
    expect(new Set(EXDB.map(e => e.id)).size).toBe(1324)
    for (const id of [...Object.keys(DEPRECATED), ...Object.values(DEPRECATED)]) expect(X[id], id).toBeTruthy()
  })
  it('every exercise has a canonical equipment; ~95 % a canonical movement', () => {
    for (const e of EXDB) expect(EQUIPMENT_BY_ID[facetsOf(e).equipment], e.id).toBeTruthy()
    const withMove = EXDB.filter(e => facetsOf(e).movement).length
    expect(withMove / EXDB.length).toBeGreaterThan(0.93)
    for (const e of EXDB) { const m = facetsOf(e).movement; if (m) expect(MOVEMENT_BY_ID[m], e.id).toBeTruthy() }
  })
  it('canonical mapping examples', () => {
    const mv = id => facetsOf(X[id]).movement
    expect([mv('0043'), mv('0739'), mv('0743'), mv('0058'), mv('1409'), mv('0085'), mv('0861'), mv('0198'), mv('0025'), mv('0405')])
      .toEqual(['squat', 'squat', 'squat', 'hip_thrust', 'hip_thrust', 'hinge', 'horizontal_pull', 'vertical_pull', 'horizontal_push', 'vertical_push'])
    expect(mv('1511')).toBe('mobility') // hamstring stretch: mobility, never volume
    expect(mv('0684')).toBe('cardio')
    expect(mv('1160')).toBe('conditioning') // a burpee is not a cardio machine
    expect(mv('2139')).toBe('cardio') // arm ergometer, filed under chest by the dataset
  })
  it('equipment mapping, with evidence-based precision only where it exists', () => {
    const eq = id => facetsOf(X[id]).equipment
    expect([eq('0576'), eq('0577'), eq('0798'), eq('2331'), eq('0684'), eq('0025'), eq('0043')])
      .toEqual(['plate_loaded', 'selectorized', 'bike', 'elliptical', 'treadmill', 'barbell', 'barbell'])
    expect(equipmentIdOf({ id: 'x', eq: 'olympic barbell' })).toBe('barbell')
    expect(equipmentIdOf({ id: 'cx', eq: 'custom', custom: true })).toBe('custom')
  })
  it('classifier regressions: bridges, side bridges, mountain climbers, "outstretched", wrist curls, stretches', () => {
    const mv = id => facetsOf(X[id]).movement
    expect(mv('0058')).toBe('hip_thrust') // barbell hip thrust
    expect(mv('1409')).toBe('hip_thrust') // barbell glute bridge
    expect(mv('1422')).toBe('hip_thrust') // pelvic tilt into bridge
    expect(mv('0705')).toBe('core_lateral') // side bridge v. 2 — not a hip thrust
    expect(mv('1775')).toBe('core_lateral') // side plank hip adduction
    expect(mv('0609')).not.toBe('hip_thrust') // london bridge (rings abs)
    expect(mv('2466')).toBe('conditioning') // bridge - mountain climber
    expect(mv('0630')).toBe('conditioning') // mountain climber
    expect(mv('3645')).toBe('hip_thrust') // single leg bridge with outstretched leg — not mobility
    expect(mv('0125')).toBe('wrist') // barbell wrist curl
    expect(mv('0031')).toBe('elbow_flexion') // barbell curl
    expect(mv('1259')).toBe('mobility') // behind head chest stretch
    expect(mv('1511')).toBe('mobility')
  })
  it('stretches and cardio stay out of direct volume; wrist curls are not biceps curls', () => {
    const lookup = id => X[id]
    expect(classify('1511', lookup).group).toBeFalsy() // curated stretch: group ''
    expect(classify('1259', lookup).pattern).toBe('mobility') // uncurated "behind head chest stretch"
    expect(classify('1259', lookup).group).toBe(null)
    expect(classify('0125', lookup).pattern).toBe('wrist')
    expect(classify('0031', lookup).pattern).toBe('curl')
  })
})

describe('recommended vs master, deprecated vs preferred', () => {
  it('Recommended 2J = curated catalogue + a short controlled extension, never a deprecated id', () => {
    expect(RECOMMENDED.size).toBeGreaterThan(150)
    expect(RECOMMENDED.size).toBeLessThan(250)
    for (const id of EXTRA_RECOMMENDED) expect(RECOMMENDED.has(id), id).toBe(true)
    for (const id of Object.keys(DEPRECATED)) expect(RECOMMENDED.has(id), id).toBe(false)
  })
  it('deprecated ids resolve to a live preferred id with the same movement; no chains', () => {
    for (const [dep, pref] of Object.entries(DEPRECATED)) {
      expect(isDeprecated(dep)).toBe(true)
      expect(preferredOf(dep)).toBe(pref)
      expect(isDeprecated(pref)).toBe(false)
      expect(facetsOf(X[dep]).movement).toBe(facetsOf(X[pref]).movement)
    }
    expect(preferredOf('0025')).toBe('0025')
  })
  it('no official block or guided routine uses a deprecated id', () => {
    expect(json('api/lib/blocks-official.json').blocks).toHaveLength(158)
    expect(json('api/lib/guided-official.json').routines).toHaveLength(69)
    for (const id of Object.keys(DEPRECATED)) expect(OFFICIAL.has(id), id).toBe(false)
  })
  it('names that were shared by two different exercises are now distinct (reviewed variants)', () => {
    for (const [a, b] of REVIEWED_VARIANTS) {
      expect(X[a].n).not.toBe(X[b].n)
      expect(esNames[a]).not.toBe(esNames[b])
    }
    expect(X['0739'].n).toBe('sled 45° leg press') // mojibake fixed, old name kept as alias
    expect(ALIASES['0739']).toContain('sled 45в° leg press')
    expect(X['0684'].n).toBe('treadmill run')
  })
  it('aliases are unambiguous', () => {
    const idx = aliasIndexOf()
    expect(idx.get(norm('press banca'))).toBe('0025')
    expect(idx.get(norm('Peso muerto rumano'))).toBe('0085')
    expect(idx.get(norm('run (equipment)'))).toBe('0684')
    expect(idx.get(norm('cuerdas de batalla'))).toBe('0128')
  })
  it('the quality pass resolves only evidence-backed duplicate and movement decisions', () => {
    expect(DEPRECATED).toMatchObject({ '0312': '0313', '0395': '0396', '2318': '0869' })
    for (const [a, b] of [['0312', '0313'], ['0395', '0396'], ['2318', '0869']]) {
      expect(X[a].st).toEqual(X[b].st)
      expect(preferredOf(a)).toBe(b)
    }
    for (const [id, movement] of Object.entries({ '1408': 'hip_thrust', '0325': 'vertical_push', '0128': 'conditioning', '1362': 'mobility', '0500': 'core_rotation', '0628': 'hip_abduction' }))
      expect(facetsOf(X[id]).movement, id).toBe(movement)
    expect(EXDB.filter(e => !facetsOf(e).movement)).toHaveLength(28)
    expect(RECOMMENDED.has('0128') && RECOMMENDED.has('0500') && RECOMMENDED.has('1362')).toBe(true)
  })
})

describe('similar variants (deterministic swap)', () => {
  it('same movement only, same pattern/equipment first, reasons stated, no deprecated', () => {
    const vs = similarVariants(X['0058'], EXDB)
    expect(vs.length).toBeGreaterThan(0)
    expect(vs.every(v => facetsOf(v.ex).movement === 'hip_thrust')).toBe(true)
    expect(vs.every(v => v.reasons[0] === 'sameMovement')).toBe(true)
    const row = similarVariants(X['1350'], EXDB, { limit: 40 })
    expect(row.every(v => !isDeprecated(v.ex.id))).toBe(true)
    expect(row[0].reasons).toContain('samePattern')
    expect(similarVariants(X['1511'], EXDB).every(v => facetsOf(v.ex).movement === 'mobility')).toBe(true)
  })
  it('an unclassified exercise gets no invented variants', () => {
    const odd = EXDB.find(e => !facetsOf(e).movement)
    expect(similarVariants(odd, EXDB)).toEqual([])
  })
})

describe('validator: redundancy by canonical movement', () => {
  const lk = { lookup: id => X[id] }
  const day = ids => validateAgainst2JProtocol({ kind: 'routine', goal: 'hypertrophy', level: 'intermediate', entries: ids.map(id => ({ id, sets: 3, mode: 'reps', reps: 10 })) }, lk)
  it('same movement + same equipment under different ids is a note (high overlap), not a failure', () => {
    const v = day(['0289', '0296'])
    expect(v.result).toBe('PASS')
    expect(v.issues.some(i => i.code === 'high_overlap' && i.severity === 'note')).toBe(true)
  })
  it('an intentional variant (other equipment or angle) is not flagged', () => {
    expect(day(['0025', '0314']).issues.some(i => i.code === 'high_overlap')).toBe(false) // flat barbell vs incline dumbbell
    expect(day(['0025', '0289']).issues.some(i => i.code === 'high_overlap')).toBe(false) // barbell vs dumbbells
  })
})

describe('search, families, scopes (app layer, Spanish)', () => {
  let lib, i18n
  beforeAll(async () => {
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {} })
    i18n = await import('../i18n.js')
    await i18n.setLang('es')
    lib = await import('./index.js')
  })
  const names = list => list.slice(0, 8).map(e => e.id)
  it('finds by alias, name, movement, muscle and equipment in Spanish', () => {
    const s = q => lib.searchExercises(EXDB, q)
    expect(s('hip thrust')[0].id).toBe('0058')
    expect(s('press banca')[0].id).toBe('0025')
    expect(names(s('remo máquina'))).toContain('1350')
    expect(s('pecho mancuernas').slice(0, 10).every(e => ['dumbbell'].includes(e.eq))).toBe(true)
    expect(s('glúteo barra').slice(0, 5).map(e => e.id)).toEqual(expect.arrayContaining(['0058']))
    expect(s('bisagra').slice(0, 10).every(e => lib.facets(e).movement === 'hinge')).toBe(true)
    expect(names(s('treadmill'))).toEqual(expect.arrayContaining(['0684', '3666']))
    expect(s('zzzz')).toEqual([])
  })
  it('deprecated duplicates sink below their preferred twin', () => {
    const r = lib.searchExercises(EXDB, 'dumbbell close grip press').map(e => e.id)
    expect(r.indexOf('0296')).toBeLessThan(r.indexOf('1731'))
  })
  it('families group variants by movement, Recommended 2J first, deprecated left out', () => {
    const fams = lib.familiesOf(EXDB)
    const ht = fams.find(f => f.movement === 'hip_thrust')
    expect(ht.recommended.map(e => e.id)).toEqual(expect.arrayContaining(['0058', '1409']))
    expect(fams.flatMap(f => [...f.recommended, ...f.more]).some(e => isDeprecated(e.id))).toBe(false)
    expect(lib.variantLabel(X['0058'])).toBe('Barra')
  })
  it('scopes and priority: 2J shows curated + customs; master everything; priority puts 2J first', () => {
    const custom = { id: 'cx1', n: 'mi ejercicio', bp: 'back', eq: 'custom', tg: '', custom: true }
    const all = [custom, ...EXDB]
    const two = lib.scopeList(all, '2j')
    expect(two).toContain(custom)
    expect(two.every(e => e.custom || RECOMMENDED.has(e.id))).toBe(true)
    expect(lib.scopeList(all, 'all')).toHaveLength(all.length)
    const pr = lib.prioritize(EXDB, { workouts: [], favEx: ['0001'] })
    expect(RECOMMENDED.has(pr[0].id)).toBe(true)
    expect(isDeprecated(pr.at(-1).id)).toBe(true)
  })
  it('imports: Spanish alias and translated names, deprecated filed under the preferred id, ties never guessed', async () => {
    const { matchExerciseCandidates, matchExercise } = await import('../import-csv.js')
    expect(matchExercise('Press banca')).toBe('0025')
    expect(matchExercise('peso muerto rumano')).toBe('0085')
    expect(matchExercise('sentadilla hack')).toBe('0743')
    expect(matchExercise('Hip thrust con barra')).toBe('0058')
    expect(matchExercise(esNames['0289'])).toBe('0289') // exact Spanish name, accents included
    expect(matchExercise('sled 45в° leg press')).toBe('0739') // historical (mojibake) name
    expect(matchExercise('dumbbell close grip press')).toBe('0296') // deprecated 1731 → preferred
    expect(matchExercise('barbell full squat (side pov)')).toBe('0043')
    // The dataset's old shared name of two different machines is never resolved to one of them.
    const tie = matchExerciseCandidates('lever chest press')
    expect(tie.id).toBe(null)
    expect(tie.candidates.length).toBeGreaterThan(1)
  })
  it('swap V2: similar variants first with their reasons, then muscle alternatives; works with the Bunker catalogue state', async () => {
    const { getReplacementGroups } = await import('../alternatives.js')
    const g = getReplacementGroups({ customEx: [], excludedEx: [] }, '1350') // seated machine row, Bunker's minimal S
    expect(g.recommended.length).toBeGreaterThan(0)
    expect(g.recommended.length).toBeLessThanOrEqual(8)
    expect(g.recommended[0].matchKey).toBe('variant')
    expect(g.recommended[0].reasons[0]).toBe('Mismo movimiento')
    expect(g.variants.every(v => lib.facets(v.ex).movement === 'horizontal_pull')).toBe(true)
    expect(g.all.some(a => isDeprecated(a.ex.id))).toBe(false)
  })
  it('history is never migrated: a deprecated id keeps resolving with its own name', async () => {
    const { exOr } = await import('../exercises.js')
    for (const id of Object.keys(DEPRECATED)) {
      expect(exOr(id).missing).toBeUndefined()
      expect(i18n.nameFor(exOr(id))).toBe(esNames[id])
    }
  })
  it('favourites toggle on the member state; recents come from real workouts', () => {
    const s = { favEx: [] }
    lib.toggleFav(s, '0025'); expect(s.favEx).toEqual(['0025'])
    lib.toggleFav(s, '0025'); expect(s.favEx).toEqual([])
    const S = { workouts: [{ end: 1, entries: [{ id: '0043' }] }, { end: 2, entries: [{ id: '0025' }, { id: '0043' }] }] }
    expect(lib.recentIdsOf(S)).toEqual(['0025', '0043'])
  })
})
