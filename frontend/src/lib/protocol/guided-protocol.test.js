import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EXDB } from '../exercises-data.js'
import { validateAgainst2JProtocol, sanitizeTiming, defaultTiming, applyTiming, guidedSeconds, instantiateBlock, isGuided, BLOCK_TYPES_READY,
  classify, redundancyKey, TIMING_PRESETS, blockTypesOf, deriveBlockMeta, CATALOG } from './index.js'
import { matchExercise } from '../import-csv.js'

/* Constructor V2.1 on the protocol side: guided timing, rounds (2J-HEU-INTERVAL-ROUNDS), the
 * curated hip thrust and mobility, and the official library that ships them. */
const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))
const lookup = id => byId[id] || null
const v = (target, ctx = {}) => validateAgainst2JProtocol(target, { lookup, ...ctx })
const here = dirname(fileURLToPath(import.meta.url))
const seed = JSON.parse(readFileSync(join(here, '..', '..', '..', '..', 'api', 'lib', 'blocks-official.json'), 'utf8'))

describe('guided timing', () => {
  it('is only for the timed types, clamped, with sensible defaults', () => {
    expect(sanitizeTiming({ work: 30 }, 'strength')).toBe(null)
    expect(sanitizeTiming(null, 'hiit')).toEqual(defaultTiming('hiit'))
    expect(sanitizeTiming({ prep: -5, work: 2, rest: 9999, rounds: 0, roundRest: 'x' }, 'circuit')).toEqual({ prep: 0, work: 5, rest: 300, rounds: 1, roundRest: 60 })
    expect(sanitizeTiming({ ...TIMING_PRESETS.tabata, preset: 'tabata' }, 'hiit')).toMatchObject({ work: 20, rest: 10, rounds: 8, preset: 'tabata' })
    expect(sanitizeTiming({ preset: 'emom' }, 'hiit').preset).toBeUndefined()
    for (const t of ['circuit', 'interval', 'hiit', 'mobility']) { expect(isGuided(t)).toBe(true); expect(BLOCK_TYPES_READY).toContain(t) }
    expect(isGuided('superset')).toBe(false)
  })
  it('shapes entries: rounds = sets, timed bouts; a circuit keeps reps entries; per-entry rest dropped', () => {
    const ex = [{ id: '0175', sets: 3, mode: 'reps', reps: 15, rpe: [6, 8, 8], rest: 60 }, { id: '2135', sets: 2, mode: 'time', sec: 45 }]
    const c = applyTiming(ex, 'circuit', { work: 30, rounds: 4 })
    expect(c[0]).toMatchObject({ mode: 'reps', reps: 15, sets: 4, rpe: [6, 8, 8, 8] })
    expect(c[0].rest).toBeUndefined()
    expect(c[1]).toMatchObject({ mode: 'time', sec: 30, sets: 4 })
    const h = applyTiming(ex, 'hiit', { ...TIMING_PRESETS.tabata })
    expect(h.every(e => e.mode === 'time' && e.sec === 20 && e.sets === 8 && e.rpe === undefined && e.reps === undefined)).toBe(true)
    expect(ex[0].sets).toBe(3)   // input untouched
    expect(applyTiming(ex, 'strength', null)).toEqual(ex)
  })
  it('duration counts every bout and rest: Tabata 20/10 × 8 with a 10 s countdown is 240 s', () => {
    const tm = { prep: 10, ...TIMING_PRESETS.tabata }
    expect(guidedSeconds(applyTiming([{ id: '2138', sets: 1, mode: 'time', sec: 20 }], 'hiit', tm), tm, 'hiit')).toBe(10 + 160 + 70)
    const c = { prep: 10, work: 40, rest: 20, rounds: 3, roundRest: 90 }
    const two = applyTiming([{ id: '0739', sets: 3, mode: 'time', sec: 40 }, { id: '0577', sets: 3, mode: 'time', sec: 40 }], 'circuit', c)
    expect(guidedSeconds(two, c, 'circuit')).toBe(10 + 3 * (80 + 20) + 2 * 90)
  })
  it('a copied block carries its timing; block metadata uses the guided duration', () => {
    const b = { id: 'x', type: 'hiit', timing: { work: 20, rest: 10, rounds: 8 }, ex: [{ id: '2138', sets: 8, mode: 'time', sec: 20 }] }
    expect(instantiateBlock(b).meta.timing).toMatchObject({ work: 20, rest: 10, rounds: 8 })
    expect(instantiateBlock({ ...b, type: 'strength' }).meta.timing).toBeUndefined()
    expect(deriveBlockMeta(b, lookup).estimatedMinutes).toBe(5)
    expect(blockTypesOf([{ iid: 'k1', type: 'hiit' }, { iid: 'k2' }])).toEqual({ k1: 'hiit', k2: 'strength' })
  })
})

describe('2J-HEU-INTERVAL-ROUNDS', () => {
  const tabataEntries = [{ id: '0514', sets: 8, mode: 'time', sec: 20, blk: 'k1' }]
  it('timed bouts of an interval/HIIT block are rounds (1-10), not strength sets', () => {
    expect(v({ kind: 'block', goal: 'general', level: 'intermediate', type: 'hiit', entries: tabataEntries }).result).not.toBe('FAIL')
    const asStrength = v({ kind: 'block', goal: 'general', level: 'intermediate', type: 'strength', entries: tabataEntries })
    expect(asStrength.issues.map(i => i.code)).toContain('sets_outside_allowed')
    const tooMany = v({ kind: 'block', goal: 'general', level: 'intermediate', type: 'hiit', entries: [{ ...tabataEntries[0], sets: 12 }] })
    expect(tooMany.issues.find(i => i.code === 'rounds_outside_allowed').severity).toBe('fail')
  })
  it('inside a day, the block type comes from routine.blocks — and the rounds are never direct weekly sets', () => {
    const day = [...tabataEntries, { id: '0043', sets: 3, mode: 'reps', reps: 8, blk: 'k2' }]
    const judged = v({ kind: 'routine', goal: 'hypertrophy', level: 'intermediate', entries: day, blockTypes: { k1: 'hiit', k2: 'strength' } })
    expect(judged.issues.map(i => i.code)).not.toContain('sets_outside_allowed')
    expect(judged.stats.weeklySets.quads).toBe(3)       // the squats only, not 8 jump-squat bouts
    const blind = v({ kind: 'routine', goal: 'hypertrophy', level: 'intermediate', entries: day })
    expect(blind.result).toBe('FAIL')                   // without the type, 8 sets is 8 strength sets
  })
  it('mobility never counts as volume; circuits do', () => {
    const flow = [{ id: '1604', sets: 1, mode: 'time', sec: 40, blk: 'm' }, { id: '1511', sets: 1, mode: 'time', sec: 40, blk: 'm' }]
    expect(v({ kind: 'routine', goal: 'general', level: 'beginner', entries: flow, blockTypes: { m: 'mobility' } }).stats.weeklySets).toEqual({})
    const circ = [{ id: '0739', sets: 3, mode: 'time', sec: 40, blk: 'c' }]
    expect(v({ kind: 'routine', goal: 'general', level: 'beginner', entries: circ, blockTypes: { c: 'circuit' } }).stats.weeklySets.quads).toBe(3)
  })
  it('restrictions still apply inside guided blocks', () => {
    const r = v({ kind: 'block', goal: 'general', level: 'beginner', type: 'mobility', entries: [{ id: '1511', sets: 1, mode: 'time', sec: 40 }] }, { restrictions: ['no-floor'] })
    expect(r.issues.find(i => i.code === 'restriction')).toBeTruthy()
  })
})

describe('barbell hip thrust (0058)', () => {
  it('is the existing record, renamed — not a new one — and curated apart from the floor glute bridge', () => {
    expect(byId['0058'].n).toBe('barbell hip thrust')
    expect(byId['0058'].img).toBe('0058-SNFfUff.jpg')
    expect(EXDB.filter(e => /hip thrust/.test(e.n) && e.eq === 'barbell').map(e => e.id)).toEqual(['0058'])
    const ht = classify('0058', lookup), gb = classify('1409', lookup)
    expect(ht).toMatchObject({ curated: true, pattern: 'bridge', group: 'glutes', cls: 'compound_free' })
    expect(redundancyKey(ht)).not.toBe(redundancyKey(gb))
  })
  it('imports resolve "hip thrust" to it and "glute bridge" to 1409', () => {
    expect(matchExercise('Hip Thrust')).toBe('0058')
    expect(matchExercise('barbell hip thrust')).toBe('0058')
    expect(matchExercise('Glute Bridge')).toBe('1409')
  })
})

describe('the official library after V2.1', () => {
  it('155 blocks (118 + 37 guided for Entrena con 2J), every one PASS, unique ids; only the two hip-thrust blocks were revised', () => {
    expect(seed.count).toBe(155)
    expect(new Set(seed.blocks.map(b => b.id)).size).toBe(155)
    expect(seed.blocks.every(b => b.validation.result === 'PASS')).toBe(true)
    const revised = seed.blocks.filter(b => b.seedVersion > 1).map(b => b.id).sort()
    expect(revised).toEqual(['off-glutes-hypertrophy-advanced-a', 'off-glutes-hypertrophy-intermediate-a'])
    for (const id of revised) expect(seed.blocks.find(b => b.id === id).ex.map(e => e.id)).toContain('0058')
    expect(seed.seedVersion).toBe(2)
  })
  it('43 guided blocks with timing, curated or cardio-machine exercises, revalidated here', () => {
    const guided = seed.blocks.filter(b => isGuided(b.type))
    const n = {}; for (const b of guided) n[b.type] = (n[b.type] || 0) + 1
    expect(n).toEqual({ circuit: 10, hiit: 16, interval: 6, mobility: 11 })
    for (const b of guided) {
      expect(sanitizeTiming(b.timing, b.type)).toEqual(b.timing)
      for (const e of b.ex) expect(CATALOG[e.id] || byId[e.id].bp === 'cardio').toBeTruthy()
      const r = v({ kind: 'block', goal: b.goal, level: b.level, type: b.type, focus: b.focus, entries: b.ex }, { official: true })
      expect(r.result, b.id).toBe('PASS')
      expect(b.ex.every(e => e.sets === b.timing.rounds), b.id).toBe(true)
    }
    expect(guided.find(b => b.type === 'hiit').timing).toMatchObject({ preset: 'tabata', work: 20, rest: 10, rounds: 8 })
  })
})
