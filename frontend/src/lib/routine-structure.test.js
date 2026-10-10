import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { analyzeRoutineStructure, structuralFactsForAI } from './routine-structure.js'
import { facets, isDeprecated, preferredOf } from './library/index.js'
import { classify, WEEKLY_SETS } from './protocol/index.js'
import { findingTexts } from './routine-structure-text.js'
import { EXDB } from './exercises-data.js'
import { EXIDX } from './exercises.js'

const e = (id, sets = 3, extra = {}) => ({ id, sets, mode: 'reps', ...extra })

describe('deterministic routine structure analysis', () => {
  it('uses the canonical library and protocol taxonomy for push, pull, knee and hip patterns', () => {
    const ids = { push: '0025', pull: '1429', knee: '0043', hip: '0032' }
    expect(facets(EXIDX[ids.push]).movement).toBe('horizontal_push')
    const out = analyzeRoutineStructure({ days: [{ id: 'a', name: 'A', ex: Object.values(ids).map(id => e(id)) }] }, { goal: 'strength' })
    expect(out.buckets).toMatchObject({ push: 1, pull: 1, knee: 1, hip: 1 })
    expect(out.movementSummary).toMatchObject({ horizontal_push: 1, vertical_pull: 1, knee_dominant: 1, hip_dominant: 1 })
    expect(out.programmedResistanceSets).toBe(12)
  })

  it('surfaces an obvious push-only week without presenting a universal target ratio', () => {
    const out = analyzeRoutineStructure({ ex: [e('0025', 4), e('0047', 4)] }, { goal: 'hypertrophy' })
    expect(out.findings).toContainEqual(expect.objectContaining({ id: 'balance:push-without-pull', severity: 'importante' }))
    expect(out.findings.find(f => f.id === 'balance:push-without-pull').evidence).toEqual({ pushExercises: 2, pullExercises: 0, pushSets: 8, pullSets: 0 })
  })

  it('reports hip-dominant absence only for applicable goals and when knee work is present', () => {
    const input = { ex: [e('0043'), e('0739'), e('0585')] }
    expect(analyzeRoutineStructure(input, { goal: 'general' }).findings.map(f => f.id)).toContain('balance:knee-without-hip')
    expect(analyzeRoutineStructure(input, { goal: 'power' }).findings.map(f => f.id)).not.toContain('balance:knee-without-hip')
  })

  it('does not treat explicit push specialization or lower-only training as a generic defect', () => {
    const push = { meta: { focus: 'chest' }, ex: [e('0025'), e('0047'), e('0033')] }
    expect(analyzeRoutineStructure(push).findings.map(f => f.id)).not.toContain('balance:push-without-pull')
    const lower = { ex: [e('0043'), e('0739'), e('0032')] }
    expect(analyzeRoutineStructure(lower, { goal: 'power' }).findings.map(f => f.id)).not.toContain('balance:push-without-pull')
  })

  it('keeps day and week movement distribution, and flags consecutive repeated movement context', () => {
    const out = analyzeRoutineStructure({ days: [
      { id: 'a', name: 'Upper A', ex: [e('0025'), e('1429')] },
      { id: 'b', name: 'Upper B', ex: [e('0025'), e('1429')] },
    ], scheduledDays: [{ day: 1, routineKey: 'a' }, { day: 2, routineKey: 'b' }] })
    expect(out.days[0].movements.horizontal_push).toBe(1)
    expect(out.scheduledDayFindings[0].movements).toContain('horizontal_push')
    expect(out.findings.some(f => f.category === 'distribution')).toBe(true)
  })

  it('detects same-stimulus clutter, but preserves explicitly anchored entries', () => {
    const out = analyzeRoutineStructure({ id: 'r', ex: [e('0025'), e('0025'), e('0025', 3, { anchor: true })] })
    expect(out.findings.some(f => f.category === 'redundancy')).toBe(false)
    const allUnanchored = analyzeRoutineStructure({ id: 'r', ex: [e('0025'), e('0025'), e('0025')] })
    expect(allUnanchored.findings).toContainEqual(expect.objectContaining({ category: 'redundancy' }))
  })

  it('separates direct and secondary muscle exposure and excludes cardio, mobility, circuits and time blocks from resistance sets', () => {
    const out = analyzeRoutineStructure({ days: [{ id: 'a', blocks: [{ iid: 'circ', type: 'circuit' }], ex: [
      e('0025', 4), e('1511', 2), e('3637', 5), e('0025', 6, { blk: 'circ' }), e('0025', 7, { mode: 'time' }),
    ] }] })
    expect(out.programmedResistanceSets).toBe(4)
    expect(out.muscleSets.chest.direct).toBe(4)
    expect(out.muscleSets.triceps.secondary).toBeGreaterThan(0)
  })

  it('checks the active gym equipment using category IDs and uses existing similar variants', () => {
    const out = analyzeRoutineStructure({ ex: [e('0025')] }, { availableEquipment: ['bodyweight'] })
    const warning = out.findings.find(f => f.category === 'equipment')
    expect(warning.evidence.required).toBe('barbell')
    expect(warning.alternatives.length).toBeLessThanOrEqual(3)
    expect(warning.alternatives.every(a => facets(EXIDX[a.id]).equipment === 'bodyweight')).toBe(true)
  })

  it('does not suggest variants that violate an explicit protocol restriction', () => {
    const out = analyzeRoutineStructure({ ex: [e('0025')] }, { availableEquipment: ['bodyweight'], restrictions: ['no-floor'] })
    const warning = out.findings.find(f => f.category === 'equipment')
    expect(warning.alternatives.every(a => !classify(a.id, id => EXIDX[id]).flags.includes('floor'))).toBe(true)
  })

  it('surfaces deprecated entries with the existing preferred ID and keeps alternatives live', () => {
    const deprecated = EXDB.find(x => isDeprecated(x.id) && preferredOf(x.id) !== x.id)
    expect(deprecated).toBeTruthy()
    const out = analyzeRoutineStructure({ ex: [e(deprecated.id)] })
    expect(out.findings).toContainEqual(expect.objectContaining({ evidence: expect.objectContaining({ preferredId: preferredOf(deprecated.id) }) }))
  })

  it('does not guess patterns for legacy or unknown exercises', () => {
    const out = analyzeRoutineStructure({ ex: [{ id: 'legacy-custom-unknown', sets: 3 }] })
    expect(out.days[0].movements).toEqual({})
    expect(out.findings).toContainEqual(expect.objectContaining({ id: 'catalog:unclassified-exercises', evidence: { count: 1 } }))
  })

  it('uses only progression-eligible recent workouts for omission context', () => {
    const input = { routine: { id: 'r', ex: [e('0025'), e('1429')] }, days: [{ id: 'r', ex: [e('0025'), e('1429')] }] }
    const excluded = { routineId: 'r', excludeFromProgression: true, entries: [{ id: '0025', sets: [{ done: true }] }] }
    expect(analyzeRoutineStructure(input, { workouts: [excluded] }).findings.some(f => f.category === 'history')).toBe(false)
    const performed = id => ({ id, sets: [{ done: true, type: 'work' }] })
    const included = [
      { routineId: 'r', entries: [performed('0025')] },
      { routineId: 'r', entries: [performed('0025')] },
      { routineId: 'r', entries: [performed('0025'), performed('1429')] },
    ]
    expect(analyzeRoutineStructure(input, { workouts: [excluded, ...included] }).findings.some(f => f.category === 'history')).toBe(true)
    expect(analyzeRoutineStructure(input, { workouts: included.slice(1) }).findings.some(f => f.category === 'history')).toBe(false)
  })

  it('does not mutate input, is deterministic and emits compact facts without history or identity', () => {
    const routine = { id: 'r', name: 'Test', ex: [e('0025'), e('1429')] }
    const before = JSON.stringify(routine)
    const first = analyzeRoutineStructure(routine, { goal: 'strength' })
    const second = analyzeRoutineStructure(routine, { goal: 'strength' })
    expect(first).toEqual(second)
    expect(JSON.stringify(routine)).toBe(before)
    const facts = structuralFactsForAI(first)
    expect(facts.source).toBe('deterministic-2j-analysis')
    expect(JSON.stringify(facts)).not.toMatch(/workouts|memberId|uid|health|community/i)
  })
})

describe('Training Quality V2: sets, frequency, muscles and references', () => {
  const week = (...days) => ({ days: days.map((ex, i) => ({ id: 'd' + i, name: 'Day ' + (i + 1), ex })) })
  const stats = (out, k) => out.patternStats[k]

  it('judges balance on planned sets, not on how many exercises are listed', () => {
    // 2 pressing exercises and 1 row by count, but 10 pressing sets against 2 rowing sets
    const out = analyzeRoutineStructure({ ex: [e('0025', 5), e('0047', 5), e('0861', 2)] }, { goal: 'hypertrophy' })
    expect(out.movementSummary.horizontal_push + out.movementSummary.vertical_push).toBe(2)
    expect(out.movementSets.horizontal_push + out.movementSets.vertical_push).toBe(10)
    const f = out.findings.find(x => x.id === 'balance:push-heavy')
    expect(f).toMatchObject({ code: 'push_heavy', severity: 'info', evidenceType: 'heuristic', params: { pushSets: 10, pullSets: 2 } })
    // the same two-and-one exercises with matching sets say nothing
    const even = analyzeRoutineStructure({ ex: [e('0025', 3), e('0047', 3), e('0861', 3), e('0198', 3)] }, { goal: 'hypertrophy' })
    expect(even.findings.map(x => x.id)).not.toContain('balance:push-heavy')
  })

  it('counts exercises, sets and days separately for each pattern', () => {
    const out = analyzeRoutineStructure(week([e('0861', 3), e('0025', 4)], [e('0861', 3), e('0198', 3)], [e('0043', 3)]))
    expect(stats(out, 'horizontal_pull')).toEqual({ exercises: 2, sets: 6, days: 2 })
    expect(stats(out, 'vertical_pull')).toEqual({ exercises: 1, sets: 3, days: 1 })
    expect(stats(out, 'knee_dominant').days).toBe(1)
    expect(out.movementSets.horizontal_pull).toBe(6)
    expect(out.movementSummary.horizontal_pull).toBe(2)
  })

  it('reports direct and secondary sets and the days each muscle is reached', () => {
    const out = analyzeRoutineStructure(week([e('0025', 4)], [e('0025', 3)]))
    expect(out.muscleSets.chest).toMatchObject({ direct: 7, days: 2 })
    expect(out.muscleSets.triceps.secondarySets).toBe(7)
    expect(out.muscleSets.triceps.direct).toBe(0)
    expect(out.muscleSets.triceps.secondary).toBeGreaterThan(0)       // the weighted estimate stays available, labelled as such by the UI
  })

  it('every finding carries a code, params, evidence and how sure it is — and no prose', () => {
    const out = analyzeRoutineStructure({ ex: [e('0025', 4), e('0047', 4)] }, { goal: 'hypertrophy', availableEquipment: ['bodyweight'] })
    expect(out.findings.length).toBeGreaterThan(1)
    for (const f of out.findings) {
      expect(f.code).toBeTruthy(); expect(f.params).toBeTruthy(); expect(f.evidence).toBeTruthy()
      expect(['fact', 'heuristic', 'inference']).toContain(f.evidenceType)
      expect(f).not.toHaveProperty('message'); expect(f).not.toHaveProperty('suggestion')
    }
    expect(out.findings.find(f => f.category === 'equipment').evidenceType).toBe('fact')
    expect(out.findings.find(f => f.id === 'balance:push-without-pull')).toMatchObject({ code: 'push_without_pull', evidenceType: 'heuristic' })
    const consecutive = analyzeRoutineStructure({ days: [{ id: 'a', ex: [e('0025')] }, { id: 'b', ex: [e('0025')] }], scheduledDays: [{ day: 1, routineKey: 'a' }, { day: 2, routineKey: 'b' }] })
    expect(consecutive.findings.find(f => f.code === 'consecutive_days').evidenceType).toBe('inference')
  })

  it('a declared focus or specialization keeps the soft balance readings quiet', () => {
    const input = { ex: [e('0025', 5), e('0047', 5), e('0861', 2)] }
    expect(analyzeRoutineStructure(input).findings.map(f => f.code)).toContain('push_heavy')
    expect(analyzeRoutineStructure(input, { focus: 'chest' }).findings.map(f => f.code)).not.toContain('push_heavy')
    expect(analyzeRoutineStructure(input, { specialization: 'powerlifting' }).findings.map(f => f.code)).not.toContain('push_heavy')
    expect(analyzeRoutineStructure(input, { focus: 'fullbody' }).findings.map(f => f.code)).toContain('push_heavy')   // "full body" is not a specialization
    expect(analyzeRoutineStructure(input, { specialization: true }).context.declared).toBe(true)
  })

  it('compares weekly direct sets with the protocol envelope only for a hypertrophy week with a known level', () => {
    const heavy = week([e('0025', 8)], [e('0025', 8)])
    const out = analyzeRoutineStructure(heavy, { goal: 'hypertrophy', level: 'intermediate' })
    expect(out.reference).toMatchObject({ applicable: true, source: '2j-protocol-weekly-sets', evidenceType: 'heuristic', range: WEEKLY_SETS.intermediate })
    expect(out.reference.groups.chest).toMatchObject({ sets: 16, days: 2, status: 'above' })
    expect(out.findings.find(f => f.code === 'volume_above_reference')).toMatchObject({ category: 'distribution', evidenceType: 'heuristic' })
    const low = analyzeRoutineStructure(week([e('0025', 2)], [e('0861', 2)]), { goal: 'hypertrophy', level: 'advanced' })
    expect(low.reference.groups.chest.status).toBe('below')
    expect(low.findings.find(f => f.code === 'volume_below_reference').severity).toBe('info')
    const inside = analyzeRoutineStructure(week([e('0025', 5)], [e('0025', 5)]), { goal: 'hypertrophy', level: 'intermediate' })
    expect(inside.reference.groups.chest.status).toBe('within')
    expect(inside.findings.some(f => f.code.startsWith('volume_'))).toBe(false)
  })

  it('without enough context there is no reference range — and no invented level', () => {
    const two = week([e('0025', 8)], [e('0025', 8)])
    expect(analyzeRoutineStructure(two, { goal: 'hypertrophy' }).reference).toEqual({ applicable: false, reason: 'level' })
    expect(analyzeRoutineStructure(two, { goal: 'hypertrophy', level: 'expert' }).reference.reason).toBe('level')
    expect(analyzeRoutineStructure(two, { goal: 'strength', level: 'advanced' }).reference.reason).toBe('goal')
    expect(analyzeRoutineStructure({ ex: [e('0025', 20)] }, { goal: 'hypertrophy', level: 'advanced' }).reference.reason).toBe('single-day')
    expect(analyzeRoutineStructure({ ex: [e('0025', 20)] }, { goal: 'hypertrophy', level: 'advanced' }).findings.some(f => f.code.startsWith('volume_'))).toBe(false)
  })

  it('timed circuits, intervals and mobility add no sets to any pattern or muscle', () => {
    const out = analyzeRoutineStructure({ days: [{ id: 'a', blocks: [{ iid: 'hiit', type: 'hiit' }], ex: [e('0025', 9, { blk: 'hiit' }), e('1511', 5), e('0861', 3)] }] })
    expect(out.programmedResistanceSets).toBe(3)
    expect(stats(out, 'horizontal_push').sets).toBe(0)
    expect(stats(out, 'horizontal_pull').sets).toBe(3)
    expect(out.muscleSets.chest).toBeUndefined()
  })

  it('a single day is not called concentrated; a lopsided week is', () => {
    expect(analyzeRoutineStructure({ ex: [e('0025', 14)] }).findings.map(f => f.code)).not.toContain('pattern_concentration')
    const out = analyzeRoutineStructure(week([e('0025', 6), e('0861', 2)], [e('0025', 6), e('0198', 2)]))
    expect(out.findings.find(f => f.code === 'pattern_concentration')).toMatchObject({ evidenceType: 'heuristic', params: { pattern: 'horizontal_push', sets: 12 } })
  })
})

describe('finding texts', () => {
  it('every finding code has a fact, in the member language, and the AI facts carry codes only', () => {
    const out = analyzeRoutineStructure({ days: [{ id: 'a', name: 'A', ex: [e('0025', 8), e('0047', 8), e('0861', 2)] }, { id: 'b', name: 'B', ex: [e('0025', 8), e('0025', 8), e('0025', 8)] }] },
      { goal: 'hypertrophy', level: 'intermediate', availableEquipment: ['bodyweight'] })
    expect(out.findings.length).toBeGreaterThan(3)
    for (const f of out.findings) { const text = findingTexts(f); expect(text.fact, f.code).toBeTruthy(); expect(text.fact).not.toMatch(/undefined|NaN|\{\d\}/) }
    const facts = structuralFactsForAI(out)
    expect(facts.findings[0]).toHaveProperty('code'); expect(JSON.stringify(facts)).not.toMatch(/"message"|"suggestion"/)
    expect(facts.movementSets).toEqual(out.movementSets)
  })

  it('every translatable string of the engine texts and the panel exists in Spanish', () => {
    const es = readFileSync(new URL('../locales/es.js', import.meta.url), 'utf8')
    const files = ['./routine-structure-text.js', '../components/TrainingQualityPanel.jsx']
    const keys = files.flatMap(f => [...readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")))
    expect(keys.length).toBeGreaterThan(30)
    const missing = [...new Set(keys)].filter(k => !es.includes("'" + k.replace(/'/g, "\\'") + "':"))
    expect(missing).toEqual([])
  })
})
