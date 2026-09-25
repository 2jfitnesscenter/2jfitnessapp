import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EXDB } from './exercises-data.js'
import es from '../locales/es.js'
import { validateAgainst2JProtocol, blockTypesOf, routineFacts, CATEGORY_LABEL, TAG_LABEL, ROUTINE_CATEGORIES, TYPE_LABEL, FOCUS_LABEL } from './protocol/index.js'
import { filterRoutines, historyStats, recentRoutines, forYou, isNew, memberContext, restrictionIssues, routineSnapshot, partName, gearKinds, GEAR_LABEL } from './train2j.js'

/* Entrena con 2J — the official catalogue and its pure logic (no network, no model). */
const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))
const lookup = id => byId[id] || null
const t = (s, ...p) => (es[s] || s).replace(/\{(\d+)\}/g, (_, i) => p[+i] ?? '')
const here = dirname(fileURLToPath(import.meta.url))
const SEED = JSON.parse(readFileSync(join(here, '..', '..', '..', 'api', 'lib', 'guided-official.json'), 'utf8'))
const LIB = JSON.parse(readFileSync(join(here, '..', '..', '..', 'api', 'lib', 'blocks-official.json'), 'utf8'))
const R = SEED.routines
const get = id => R.find(r => r.id === id)
const GYM_EQ = new Set(['barbell', 'dumbbell', 'cable', 'leverage machine', 'smith machine', 'ez barbell', 'body weight', 'sled machine', 'trap bar', 'weighted', 'assisted', 'stationary bike', 'elliptical machine', 'stepmill machine'])

describe('the official catalogue', () => {
  it('39 routines across 7 formats, 7 collections, 3 featured — every one validated and honest', () => {
    expect(SEED.count).toBe(39)
    expect(new Set(R.map(r => r.id)).size).toBe(39)
    expect(new Set(R.map(r => r.category))).toEqual(new Set(ROUTINE_CATEGORIES))
    expect(SEED.collections).toHaveLength(7)
    expect(R.filter(r => r.featured).sort((a, b) => a.featured - b.featured).map(r => r.id)).toEqual(['r2j-tabata-fullbody', 'r2j-mobility-hips', 'r2j-hiit-lowimpact'])
    for (const r of R) {
      const v = validateAgainst2JProtocol({ kind: 'routine', goal: r.goal, level: r.level, entries: r.ex, blockTypes: blockTypesOf(r.blocks) }, { lookup, official: true })
      expect(v.result, r.id).toBe('PASS')
      expect(v.issues.some(i => i.severity === 'unverified'), r.id).toBe(false)
      for (const e of r.ex) { expect(lookup(e.id), e.id).toBeTruthy(); expect(GYM_EQ.has(lookup(e.id).eq), e.id).toBe(true) }
      expect(new Set(r.ex.map(e => e.id)).size, r.id + ' repeats an exercise').toBe(r.ex.length)
      // composed of official blocks, as versioned snapshots — never exercises of its own
      for (const b of r.blocks) expect(LIB.blocks.some(x => x.id === b.src), b.src).toBe(true)
      expect(r.ex.every(e => r.blocks.some(b => b.iid === e.blk))).toBe(true)
      // duration/equipment/tags are the shared facts, not typed by hand
      const f = routineFacts(r, lookup, r.tags.includes('low-impact') ? ['low-impact'] : [])
      expect([f.minutes, f.equipment, f.tags]).toEqual([r.estimatedMinutes, r.equipment, r.tags])
    }
  })
  it('names are unique and have Spanish; no two routines are the same workout under another name', () => {
    expect(new Set(R.map(r => r.name)).size).toBe(R.length)
    for (const r of R) for (const s of [r.name, r.subtitle, r.description].filter(Boolean)) expect(es[s], s).toBeTruthy()
    for (const c of SEED.collections) { expect(es[c.name], c.name).toBeTruthy(); expect(es[c.description], c.description).toBeTruthy() }
    for (const x of [...Object.values(CATEGORY_LABEL), ...Object.values(TAG_LABEL), ...Object.values(GEAR_LABEL), 'Warm-up', 'Cool-down']) expect(es[x], x).toBeTruthy()
    const mains = R.map(r => r.parts.filter(p => p.role === 'main').map(p => p.src).join('>'))
    expect(new Set(mains).size).toBe(R.length)
  })
  it('levels are real: beginner routines hold only beginner blocks; "low impact" never has jumps or running', () => {
    const lvOf = src => LIB.blocks.find(b => b.id === src).level
    for (const r of R.filter(x => x.level === 'beginner')) expect(r.parts.every(p => lvOf(p.src) === 'beginner'), r.id).toBe(true)
    for (const r of R.filter(x => x.tags.includes('low-impact'))) {
      expect(r.tags).toContain('no-jumps')
      expect(r.ex.some(e => ['0685', '0684'].includes(e.id)), r.id).toBe(false)
    }
    // Tabata-format routines are 20/10, named for the format
    for (const r of R.filter(x => x.category === 'tabata')) expect(r.parts.filter(p => p.role === 'main').every(p => p.timing.work === 20 && p.timing.rest === 10), r.id).toBe(true)
  })
})

describe('search and filters', () => {
  const ids = (f, extra) => filterRoutines(R, f, { t, lookup, ...extra }).map(r => r.id)
  it('type, duration, level and equipment chips', () => {
    expect(ids({ category: 'mobility' })).toHaveLength(8)
    expect(ids({ duration: 'lt15' }).every(id => get(id).estimatedMinutes < 15)).toBe(true)
    expect(ids({ level: 'beginner' }).every(id => get(id).level === 'beginner')).toBe(true)
    expect(ids({ gear: 'none' }).every(id => get(id).tags.includes('no-equipment'))).toBe(true)
    expect(ids({ category: 'hiit', duration: '15-30', level: 'intermediate' })).toEqual(['r2j-hiit-fullbody', 'r2j-hiit-express', 'r2j-hiit-lower'])
  })
  it('editorial search in Spanish finds real metadata', () => {
    expect(ids({ q: 'movilidad cadera' })).toContain('r2j-mobility-hips')
    expect(ids({ q: 'sin saltos' }).length).toBeGreaterThan(5)
    expect(ids({ q: 'sin saltos' })).toEqual(expect.arrayContaining(R.filter(r => r.tags.includes('no-jumps')).map(r => r.id)))
    expect(ids({ q: 'bicicleta' })).toEqual(expect.arrayContaining(['r2j-tabata-bike', 'r2j-intervals-bike-start']))
    expect(ids({ q: 'tabata' }).filter(id => get(id).category === 'tabata')).toHaveLength(8)
    expect(ids({ q: '20 minutos' }).every(id => Math.abs(get(id).estimatedMinutes - 20) <= 5)).toBe(true)
    expect(ids({ q: 'iniciado sin material' }).every(id => get(id).level === 'beginner')).toBe(true)
    expect(ids({ q: 'zzzz' })).toEqual([])
  })
  it('inactive routines never reach members', () => {
    const list = [{ ...R[0], active: false }, R[1]]
    expect(filterRoutines(list, {}, { t, lookup }).map(r => r.id)).toEqual([R[1].id])
  })
})

describe('history, "Again?" and completed — read from real workouts only', () => {
  const ws = [
    { id: 'a', d: '2026-09-20', end: 3, src2j: { id: 'r2j-tabata-start' } },
    { id: 'b', d: '2026-09-22', end: 5, src2j: { id: 'r2j-tabata-start' } },
    { id: 'c', d: '2026-09-21', end: 4, src2j: { id: 'r2j-mobility-hips' } },
    { id: 'd', d: '2026-09-23', end: 6 },
  ]
  it('counts and last date per routine; recent newest first, once each', () => {
    expect(historyStats(ws)).toEqual({ 'r2j-tabata-start': { count: 2, last: '2026-09-22' }, 'r2j-mobility-hips': { count: 1, last: '2026-09-21' } })
    const byId = Object.fromEntries(R.map(r => [r.id, r]))
    expect(recentRoutines(ws, byId).map(x => x.routine.id)).toEqual(['r2j-tabata-start', 'r2j-mobility-hips'])
  })
})

describe('"For you" — deterministic and explainable', () => {
  const now = new Date('2026-09-26T12:00:00').getTime()
  it('without declared context or history there is no "For you" at all', () => {
    expect(forYou(R, { workouts: [], routines: [], programs: [] }, { lookup, now })).toEqual([])
  })
  it('a beginner only gets beginner routines, each with its real reasons', () => {
    const S = { routines: [{ id: 'x', meta: { goal: 'general', level: 'beginner', restrictions: [] } }], programs: [], workouts: [] }
    const out = forYou(R, S, { lookup, now })
    expect(out.length).toBeGreaterThan(0)
    for (const x of out) {
      expect(x.routine.level).toBe('beginner')
      expect(x.reasons[0]).toEqual(['For your {0} level', 'Novice'])
      expect(x.reasons.at(-1)).toEqual(['{0} min', x.routine.estimatedMinutes])
    }
    expect(new Set(out.slice(0, 4).map(x => x.routine.category)).size).toBe(4)   // varied row
  })
  it('a declared no-jumps restriction removes every routine the validator fails for it', () => {
    const S = { routines: [{ id: 'x', meta: { goal: 'general', level: 'advanced', restrictions: ['no-jumps'] } }], programs: [], workouts: [] }
    const out = forYou(R, S, { lookup, now, max: 40 })
    expect(out.length).toBeGreaterThan(0)
    for (const x of out) expect(restrictionIssues(x.routine, ['no-jumps'], lookup)).toEqual([])
    expect(out.some(x => x.routine.id === 'r2j-tabata-advanced')).toBe(false)
    expect(out.some(x => x.reasons.some(r => r[0] === 'No jumps'))).toBe(true)
  })
  it('after a lower-body day it does not push another hard lower-body session; recent ones rest', () => {
    const legDay = { id: 'w', d: '2026-09-26', end: now - 3600e3, entries: [{ id: '0043', sets: [{ done: true }, { done: true }, { done: true }] }] }
    const S = { routines: [{ id: 'x', meta: { goal: 'general', level: 'intermediate', restrictions: [] } }], programs: [], workouts: [legDay, { id: 'y', d: '2026-09-25', end: now - 86400e3, src2j: { id: 'r2j-hiit-fullbody' } }] }
    const out = forYou(R, S, { lookup, now, max: 40 })
    expect(out.some(x => x.routine.focus === 'lower' && ['tabata', 'hiit', 'circuit'].includes(x.routine.category))).toBe(false)
    expect(out.some(x => x.routine.id === 'r2j-hiit-fullbody')).toBe(false)
  })
  it('context is only what was declared: plan meta, then the Coach intake — never health data', () => {
    expect(memberContext({ programs: [{ id: 'p', meta: { goal: 'endurance', level: 'advanced', restrictions: ['no-floor'] } }], activeProgramId: 'p', routines: [] }))
      .toEqual({ level: 'advanced', goal: 'endurance', restrictions: ['no-floor'] })
    expect(memberContext({ coach: { profile: { goal: 'fatloss', experience: 'new' } }, routines: [], programs: [], measurements: [{ bodyFat: 30 }], checkins: [{ pain: true }] }))
      .toEqual({ level: 'beginner', goal: 'general', restrictions: [] })
  })
})

describe('snapshot and labels', () => {
  it('a started or assigned routine is an independent copy, named in the viewer language', () => {
    const r = get('r2j-tabata-fullbody')
    const snap = routineSnapshot(r, t)
    expect(snap.name).toBe('Tabata · Full Body')
    expect(snap.blocks.map(b => b.name)).toEqual(['Calentamiento', 'Tabata · Cuerpo completo', 'Tabata · Tren inferior', 'Tabata · Core'])
    expect(snap.meta).toEqual({ goal: 'general', level: 'intermediate', restrictions: [], v: '1.0' })
    snap.ex[0].sets = 99
    expect(r.ex[0].sets).not.toBe(99)
    expect(snap.id).toBe(null)
  })
  it('part names, gear kinds and "new" only after launch', () => {
    expect(partName({ role: 'warmup' }, t)).toBe('Calentamiento')
    expect(partName({ role: 'main', type: 'interval', focus: 'cardio' }, t)).toBe(t(TYPE_LABEL.interval) + ' · ' + t(FOCUS_LABEL.cardio))
    expect(gearKinds(get('r2j-circuit-machines-start'), lookup)).toContain('machines')
    expect(gearKinds(get('r2j-tabata-start'), lookup)).toEqual(['none'])
    expect(gearKinds(get('r2j-intervals-bike-start'), lookup)).toContain('cardio')
    // the library files treadmill running under "body weight": never sold as "no equipment"
    for (const id of ['r2j-intervals-treadmill', 'r2j-intervals-incline-walk']) {
      expect(gearKinds(get(id), lookup)).toEqual(['cardio'])
      expect(get(id).tags).not.toContain('no-equipment')
      expect(get(id).equipment).toContain('treadmill')
    }
    expect(R.some(r => isNew(r, R, new Date('2026-09-27').getTime()))).toBe(false)
    const later = { ...R[0], id: 'late', publishedAt: '2026-10-10' }
    expect(isNew(later, [...R, later], new Date('2026-10-12').getTime())).toBe(true)
    expect(isNew(later, [...R, later], new Date('2026-12-12').getTime())).toBe(false)
  })
})
