import { describe, expect, it } from 'vitest'
import { analyzeRoutineStructure, structuralFactsForAI } from './routine-structure.js'
import { facets, isDeprecated, preferredOf } from './library/index.js'
import { classify } from './protocol/index.js'
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
    expect(out.findings.find(f => f.id === 'balance:push-without-pull').evidence).toEqual({ pushExercises: 2, pullExercises: 0 })
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
