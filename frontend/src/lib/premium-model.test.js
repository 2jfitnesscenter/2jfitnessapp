import { describe, expect, it } from 'vitest'
import seed from '../../../api/lib/premium-official.json'
import library from '../../../api/coach/library.json'
import {
  validateProgram, validateDefinition, newInstance, positionOf, planSession, proposalFor, advanceCycle, setTrainingMax, skipSession, pauseInstance, resumeInstance,
  historyEntry, originOf, progressOf, adherenceOf, summarize, missingTrainingMax, sessionsOf, STATUSES, GOAL_TAGS,
} from './premium-model.js'

const byId = new Map(library.exercises.map(e => [e.id, e]))
const ctx = { exerciseExists: id => byId.has(id), preferred: id => byId.get(id)?.pref || id }
const program = slug => seed.programs.find(p => p.slug === slug)
const clone = x => JSON.parse(JSON.stringify(x))
const TM = { squat: 100, bench: 70, deadlift: 120, press: 50 }
const NOW = Date.parse('2026-10-11T10:00:00Z')

// A finished workout for the session the cursor is on: what Workout.jsx would save (sets as logged, the origin on w.premium).
function finishCurrent(inst, workouts, { reps } = {}) {
  const plan = planSession(inst, workouts)
  const entries = plan.blocks.filter(b => b.kind === 'fixed').map(b => ({ id: b.exercise, sets: b.sets.map(s => ({ w: s.w, r: s.amrap && reps ? reps : s.r, done: true, ...(s.amrap ? { amrap: true } : {}) })) }))
  return [...workouts, { id: 'w' + workouts.length, d: '2026-10-11', entries, premium: originOf(inst, plan) }]
}

describe('the official seed', () => {
  it('has 12 programs with stable unique ids and slugs, all valid against the real library', () => {
    expect(seed.programs).toHaveLength(12)
    expect(new Set(seed.programs.map(p => p.id)).size).toBe(12)
    expect(new Set(seed.programs.map(p => p.slug)).size).toBe(12)
    for (const p of seed.programs) expect(validateProgram(p, ctx), p.id).toEqual([])
  })
  it('covers hypertrophy, strength, strength + muscle, recomposition and conditioning, and every third-party method asks for legal review', () => {
    const tags = new Set(seed.programs.flatMap(p => p.goalTags))
    for (const t of ['hypertrophy', 'strength', 'strength-muscle', 'recomposition', 'conditioning', 'health']) expect(tags.has(t), t).toBe(true)
    for (const p of seed.programs.filter(x => x.sourceType === 'established')) expect(p.legal.status, p.id).toBe('review')
    for (const p of seed.programs) { expect(GOAL_TAGS).toEqual(expect.arrayContaining(p.goalTags)); expect(STATUSES).toContain(p.status) }
  })
  it('never claims superiority and always says what the evidence is and is not', () => {
    for (const p of seed.programs) {
      expect(p.evidenceSummary.length, p.id).toBeGreaterThan(80)
      for (const text of [p.shortDescription, p.longDescription, p.evidenceSummary, p.locales.es.evidenceSummary]) expect(text, p.id).not.toMatch(/scientifically (superior|proven)|científicamente (superior|probado)|best program|el mejor programa/i)
    }
  })
})

describe('definition validation', () => {
  const base = () => clone(program('531'))
  it('accepts the seed and names what is wrong in a broken one', () => {
    expect(validateProgram(base(), ctx)).toEqual([])
    const p = base(); p.programDefinition.weeks.pop()
    expect(validateProgram(p, ctx)).toContain('definition.weeks-count')
    const q = base(); q.programDefinition.weeks[0].sessions[0].blocks[0].sets[0].pct = 3
    expect(validateProgram(q, ctx)).toContain('definition.set-spec:1.0.0')
    const r = base(); r.programDefinition.weeks[0].sessions[0].blocks[0].lift = 'nope'
    expect(validateProgram(r, ctx).some(i => i.startsWith('definition.block-lift'))).toBe(true)
    const s = base(); s.programDefinition.weeks[0].sessions[1].key = s.programDefinition.weeks[0].sessions[0].key
    expect(validateProgram(s, ctx).some(i => i.startsWith('definition.session-key'))).toBe(true)
    const t = base(); t.daysPerWeek = 3
    expect(validateProgram(t, ctx)).toContain('days-mismatch')
  })
  it('refuses an unknown or deprecated exercise and a block with two ways to prescribe', () => {
    const p = base(); p.programDefinition.lifts[0].exercise = '9999'
    expect(validateDefinition(p.programDefinition, ctx).some(i => i.startsWith('lift-exercise'))).toBe(true)
    const dep = { exerciseExists: () => true, preferred: id => (id === '0043' ? '0042' : id) }
    expect(validateDefinition(base().programDefinition, dep).some(i => i.startsWith('lift-deprecated'))).toBe(true)
    const q = base(); q.programDefinition.weeks[0].sessions[0].blocks[0].scheme = { sets: 3, reps: 5 }
    expect(validateDefinition(q.programDefinition, ctx).some(i => i.startsWith('block-mode'))).toBe(true)
  })
})

describe('5/3/1 inside the generic engine', () => {
  const inst = (o = {}) => newInstance(program('531'), { id: 'i1', now: NOW, tm: TM, unit: 'kg', ...o })
  const mainOf = (plan, key) => plan.blocks.find(b => b.role === 'main' && b.lift === key)

  it('keeps the Training Max apart from any 1RM / e1RM: it is its own value inside methodState', () => {
    const i = inst()
    expect(i.methodState.tm).toEqual(TM)
    expect(Object.keys(i.methodState)).toEqual(['unit', 'tm'])
    expect(JSON.stringify(i)).not.toMatch(/e1rm|oneRM|1rm/i)
  })

  it('week 1: 65 % × 5, 75 % × 5, 85 % × 5+ of the TM, rounded to loadable plates', () => {
    const plan = planSession(inst(), [])                                  // press day, TM 50
    expect(plan).toMatchObject({ week: 1, cycle: 1, sessionKey: 'press', title: 'Press day' })
    const m = mainOf(plan, 'press')
    expect(m.sets.map(s => [s.w, s.r, !!s.amrap])).toEqual([[32.5, 5, false], [37.5, 5, false], [42.5, 5, true]])
    expect(m.why[0]).toContain('Training Max')
  })

  it('weeks 2, 3 and 4 use their own percentages, reps and AMRAP markers', () => {
    let i = inst(), w = []
    const lastOf = (week) => { while (positionOf(i, w).week < week) w = finishCurrent(i, w); return mainOf(planSession(i, w), 'press') }
    expect(lastOf(2).sets.map(s => [s.w, s.r, !!s.amrap])).toEqual([[35, 3, false], [40, 3, false], [45, 3, true]])
    expect(lastOf(3).sets.map(s => [s.w, s.r, !!s.amrap])).toEqual([[37.5, 5, false], [42.5, 3, false], [47.5, 1, true]])
    const d = lastOf(4)
    expect(d.sets.map(s => [s.w, s.r, !!s.amrap])).toEqual([[20, 5, false], [25, 5, false], [30, 5, false]])
    expect(planSession(i, w).phase).toBe('Week 4 · Deload')
  })

  it('rounds 65 % of 120 to the nearest 2.5 kg (or 5 lb) and honours the unit', () => {
    let i = inst(), w = []
    while (planSession(i, w).sessionKey !== 'deadlift') w = finishCurrent(i, w)
    expect(mainOf(planSession(i, w), 'deadlift').sets.map(s => s.w)).toEqual([77.5, 90, 102.5])
    const lb = newInstance(program('531'), { id: 'l1', now: NOW, tm: { squat: 225, bench: 155, deadlift: 275, press: 105 }, unit: 'lb' })
    const p = mainOf(planSession(lb, []), 'press')
    expect(p.sets.map(s => s.w)).toEqual([70, 80, 90]); expect(p.sets.every(s => s.w % 5 === 0)).toBe(true)
  })

  it('a missing TM blocks that lift (no invented load) and is reported', () => {
    const i = inst({ tm: { squat: 100, bench: 70, deadlift: 120 } })
    expect(missingTrainingMax(i)).toEqual(['press'])
    const plan = planSession(i, [])
    expect(plan.blocked).toEqual(['press']); expect(plan.blocks.find(b => b.lift === 'press').kind).toBe('blocked')
  })

  it('walks 16 sessions through the cycle, derives the position from workouts, then proposes the new TMs (never applies them)', () => {
    let i = inst(), w = []
    expect(positionOf(i, w)).toMatchObject({ cycle: 1, week: 1, completedInCycle: 0, totalInCycle: 16, cycleComplete: false })
    for (let n = 0; n < 16; n++) w = finishCurrent(i, w, { reps: 8 })
    const pos = positionOf(i, w)
    expect(pos).toMatchObject({ cycleComplete: true, completedInCycle: 16, session: null })
    const prop = proposalFor(i, w)
    expect(prop.proposals).toEqual({ squat: { from: 100, to: 105, inc: 5 }, bench: { from: 70, to: 72.5, inc: 2.5 }, deadlift: { from: 120, to: 125, inc: 5 }, press: { from: 50, to: 52.5, inc: 2.5 } })
    expect(i.methodState.tm).toEqual(TM)                                   // untouched until confirmed
    expect(planSession(i, w)).toBeNull()                                   // the next cycle waits for the member
  })

  it('confirming starts cycle 2 with the new TMs; declining keeps them; finished workouts never change', () => {
    let i = inst(), w = []
    for (let n = 0; n < 16; n++) w = finishCurrent(i, w, { reps: 7 })
    const before = JSON.stringify(w)
    const up = advanceCycle(i, w, { accept: true, now: NOW })
    expect(up.cycle).toBe(2); expect(up.methodState.tm).toEqual({ squat: 105, bench: 72.5, deadlift: 125, press: 52.5 })
    expect(up.adaptations.at(-1)).toMatchObject({ kind: 'cycle-advance', accepted: true })
    expect(positionOf(up, w)).toMatchObject({ cycle: 2, week: 1, completedInCycle: 0 })     // cycle-1 workouts do not count
    const same = advanceCycle(i, w, { accept: false })
    expect(same.methodState.tm).toEqual(TM); expect(same.cycle).toBe(2)
    const custom = advanceCycle(i, w, { overrides: { squat: 102.5 } })
    expect(custom.methodState.tm.squat).toBe(102.5)
    expect(JSON.stringify(w)).toBe(before)                                // history is immutable
    expect(i.cycle).toBe(1)                                               // and the instance passed in is not mutated either
  })

  it('lb increments are 5 / 10', () => {
    const lb = newInstance(program('531'), { id: 'l1', now: NOW, tm: { squat: 225, bench: 155, deadlift: 275, press: 105 }, unit: 'lb' })
    let w = []
    for (let n = 0; n < 16; n++) w = finishCurrent(lb, w)
    expect(proposalFor(lb, w).proposals).toMatchObject({ squat: { to: 235 }, press: { to: 110 } })
  })

  it('records AMRAP outcomes for the staff and keeps the label compact', () => {
    let i = inst(), w = []
    for (let n = 0; n < 5; n++) w = finishCurrent(i, w, { reps: 9 })
    const s = summarize(i, w, NOW)
    expect(s.label).toBe('5/3/1 · C1 · W2/4')
    expect(s.lastAmrap.length).toBeGreaterThan(0); expect(s.lastAmrap[0]).toMatchObject({ reps: 9 })
    expect(s.methodState.trainingMax).toEqual(TM)
    expect(JSON.stringify(s)).not.toMatch(/name":"Ana|email|avatar/)
  })
})

describe('the instance lifecycle', () => {
  const mk = () => newInstance(program('531'), { id: 'i1', now: NOW, tm: TM })
  it('pins a snapshot: editing the catalogue later cannot change a program under way', () => {
    const p = clone(program('531'))
    const i = newInstance(p, { id: 'i1', now: NOW, tm: TM })
    p.programDefinition.weeks[0].sessions[0].blocks[0].sets[0].pct = 0.5; p.version = 2
    expect(planSession(i, [])).toMatchObject({ blocks: expect.any(Array) })
    expect(planSession(i, []).blocks[0].sets[0].w).toBe(32.5)
    expect(i.programVersion).toBe(1)
  })
  it('pauses, resumes (the pause does not count towards adherence), skips and ends with a small history record', () => {
    let i = mk()
    const later = NOW + 14 * 86400000
    expect(adherenceOf(i, [], later)).toMatchObject({ expected: 8, done: 0, pct: 0 })
    i = pauseInstance(i, NOW + 7 * 86400000)
    expect(i.status).toBe('paused')
    i = resumeInstance(i, NOW + 14 * 86400000)
    expect(i.status).toBe('active'); expect(i.pausedMs).toBe(7 * 86400000)
    expect(adherenceOf(i, [], NOW + 21 * 86400000).expected).toBe(8)
    const skipped = skipSession(i, [], NOW)
    expect(skipped.skipped).toEqual(['1:1:0']); expect(positionOf(skipped, [])).toMatchObject({ index: 1, skippedInCycle: 1 })
    const h = historyEntry(i, [], { reason: 'finished', now: later })
    expect(h).toMatchObject({ programId: 'premium-531', programVersion: 1, reason: 'finished', cycles: 1 }); expect(h.snapshot).toBeUndefined()
  })
  it('lets the member change a Training Max and keeps a record of it', () => {
    const i = setTrainingMax(mk(), 'squat', 110, { now: NOW })
    expect(i.methodState.tm.squat).toBe(110); expect(i.adaptations.at(-1)).toMatchObject({ kind: 'tm-set', from: 100, to: 110 })
    expect(setTrainingMax(i, 'nope', 5)).toBe(i); expect(setTrainingMax(i, 'squat', -3)).toBe(i)
  })
  it('progress is a percentage of the cycle', () => {
    let i = mk(), w = []
    for (let n = 0; n < 4; n++) w = finishCurrent(i, w)
    expect(progressOf(i, w)).toMatchObject({ percent: 25, week: 2, weeks: 4, completedInCycle: 4, totalInCycle: 16 })
  })
})

describe('programs that use the app’s own progression instead of a TM', () => {
  it('turns scheme blocks into progression-engine configs and cardio into conditioning blocks', () => {
    const i = newInstance(program('2j-recomposition'), { id: 'r1', now: NOW })
    const plan = planSession(i, [])
    expect(plan.blocks.every(b => b.kind === 'cfg')).toBe(true)
    expect(plan.blocks[0].cfg).toMatchObject({ mode: 'reps', prog: 'double', targetRepsMin: 6, targetRepsMax: 8 })
    let w = [], j = i
    for (let n = 0; n < 1; n++) { const p = planSession(j, w); w = [...w, { id: 'x' + n, entries: [], premium: originOf(j, p) }] }
    expect(planSession(j, w).blocks.at(-1)).toMatchObject({ kind: 'conditioning', conditioning: { min: 15, speed: 8 } })
  })
  it('a method with no end-of-cycle rule simply starts the next cycle', () => {
    const i = newInstance(program('full-body-hypertrophy'), { id: 'f1', now: NOW })
    let w = []
    for (const s of sessionsOf(i.snapshot.definition)) { const p = planSession(i, w); w = [...w, { id: 'x' + w.length, entries: [], premium: originOf(i, p) }] }
    expect(positionOf(i, w).cycleComplete).toBe(true)
    expect(proposalFor(i, w)).toMatchObject({ proposals: {}, hasRule: false })
    expect(advanceCycle(i, w).cycle).toBe(2)
  })
})
