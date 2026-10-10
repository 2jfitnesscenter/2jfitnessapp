import { describe, expect, it } from 'vitest'
import seed from '../../../api/lib/premium-official.json'
import { activate, finish, pause, resume, skip, setTM, nextCycle, premiumState, runningView, recommendation, filterCatalog, compatibility, exercisesOf } from './premium.js'
import { planSession, originOf } from './premium-model.js'

const prog = slug => seed.programs.find(p => p.slug === slug)
const NOW = Date.parse('2026-10-11T10:00:00Z')
const TM = { squat: 100, bench: 70, deadlift: 120, press: 50 }
const doneWorkout = (S, i) => { const plan = planSession(i, S.workouts || []); return { id: 'w' + (S.workouts || []).length, d: '2026-10-12', entries: [], premium: originOf(i, plan) } }

describe('the member premium state', () => {
  it('reads like an empty state when nothing (or garbage) is saved', () => {
    expect(premiumState({})).toEqual({ v: 1, active: null, history: [] })
    expect(premiumState({ premium: { active: 'x', history: 5 } })).toEqual({ v: 1, active: null, history: [] })
  })
  it('activates, pauses, resumes and finishes keeping a history entry', () => {
    let S = { workouts: [] }
    S = { ...S, premium: activate(S, prog('531'), { tm: TM, now: NOW, id: 'a1' }) }
    expect(S.premium.active.programVersion).toBe(prog('531').version)
    S = { ...S, premium: pause(S, NOW + 1000) }; expect(S.premium.active.status).toBe('paused')
    S = { ...S, premium: resume(S, NOW + 5000) }; expect(S.premium.active.status).toBe('active'); expect(S.premium.active.pausedMs).toBe(4000)
    S = { ...S, premium: finish(S, { now: NOW + 9000 }) }
    expect(S.premium.active).toBeNull(); expect(S.premium.history).toHaveLength(1)
    expect(S.premium.history[0]).toMatchObject({ programId: 'premium-531', reason: 'finished', instanceId: 'a1' })
  })
  it('switching keeps the old one in the history and never touches the workouts', () => {
    const workouts = [{ id: 'old', d: '2026-10-01', entries: [{ id: '0025', sets: [{ w: 60, r: 5, done: true }] }] }]
    const S = { workouts }
    S.premium = activate(S, prog('531'), { tm: TM, now: NOW, id: 'a1' })
    S.workouts = [...workouts, doneWorkout(S, S.premium.active)]
    const before = JSON.stringify(S.workouts)
    S.premium = activate(S, prog('full-body-hypertrophy'), { now: NOW + 10, id: 'a2' })
    expect(S.premium.active.programId).toBe('premium-full-body-hypertrophy')
    expect(S.premium.history).toMatchObject([{ instanceId: 'a1', reason: 'switched', sessions: 1 }])
    expect(JSON.stringify(S.workouts)).toBe(before)
  })
  it('a running program survives the catalogue: its pinned snapshot is all it needs', () => {
    const S = { workouts: [], premium: activate({}, prog('531'), { tm: TM, now: NOW }) }
    const v = runningView(S, NOW)
    expect(v.plan.blocks.length).toBeGreaterThan(0); expect(v.summary.label).toMatch(/5\/3\/1 · C1 · W1\/4/)
  })
  it('skip and Training Max edits are recorded as adaptations; the next cycle waits for the end of this one', () => {
    let S = { workouts: [], premium: activate({}, prog('531'), { tm: TM, now: NOW }) }
    S = { ...S, premium: skip(S, NOW) }; expect(S.premium.active.skipped).toHaveLength(1)
    S = { ...S, premium: setTM(S, 'squat', 105, NOW) }; expect(S.premium.active.methodState.tm.squat).toBe(105)
    expect(nextCycle(S).active.cycle).toBe(1)
    expect(S.premium.active.adaptations.map(a => a.kind)).toEqual(['skip', 'tm-set'])
  })
})

describe('catalogue: recommendation and compatibility', () => {
  const S = coach => ({ coach: { profile: coach }, programs: [], routines: [] })
  const rec = (coach, slug) => recommendation(S(coach), prog(slug))
  it('recommends by goal, experience and days; a fat-loss goal never leads with an advanced strength system', () => {
    expect(rec({ goal: 'hypertrophy', experience: 'regular', daysPerWeek: 4 }, 'full-body-hypertrophy').recommended).toBe(true)
    const fat = { goal: 'fatloss', experience: 'regular', daysPerWeek: 4 }
    for (const slug of ['531', 'texas-method', 'juggernaut-method', 'gzcl']) expect(rec(fat, slug).recommended, slug).toBe(false)
  })
  it('a beginner is warned off advanced programs and a 3-day member off 5-day ones', () => {
    const r = rec({ goal: 'hypertrophy', experience: 'new', daysPerWeek: 3 }, 'phat')
    expect(r.recommended).toBe(false); expect(r.caution).toBe(true); expect(r.reasons).toContain('more-days')
  })
  it('without a profile nothing is recommended and nothing breaks', () => {
    expect(seed.programs.every(p => recommendation({}, p).recommended === false)).toBe(true)
  })
  it('filters by goal tag, level and days, featured first', () => {
    const rows = filterCatalog({}, seed.programs, { goal: 'hypertrophy' })
    expect(rows.length).toBeGreaterThan(0); expect(rows.every(r => r.p.goalTags.includes('hypertrophy'))).toBe(true)
    expect(rows[0].p.featured).toBe(true)
    expect(filterCatalog({}, seed.programs, { days: 3 }).every(r => r.p.daysPerWeek === 3)).toBe(true)
    expect(filterCatalog(S({ goal: 'hypertrophy', experience: 'regular', daysPerWeek: 5 }), seed.programs, { goal: 'recommended' }).every(r => r.rec.recommended)).toBe(true)
  })
  it('reads the exercises of a definition for the equipment check', () => {
    expect(exercisesOf(prog('531').programDefinition)).toEqual(expect.arrayContaining(['0043', '0025', '0032', '1456']))
    expect(compatibility({}, { programDefinition: prog('531').programDefinition }).total).toBeGreaterThan(3)
  })
})

describe('official program updated while a member follows the old version', () => {
  it('the member keeps v1 (plan, label, history) and a new activation gets v2', () => {
    const v1 = prog('531'), v2 = { ...JSON.parse(JSON.stringify(v1)), version: 2, name: '5/3/1 (revised)' }
    v2.programDefinition.weeks[0].sessions[0].blocks[0].sets[0].pct = 0.7
    let S = { workouts: [], unit: 'kg' }
    S = { ...S, premium: activate(S, v1, { tm: TM, now: NOW, id: 'old' }) }
    const before = JSON.stringify(planSession(S.premium.active, []))
    expect(S.premium.active.programVersion).toBe(1); expect(runningView(S, NOW).summary.version).toBe(1)
    expect(JSON.stringify(planSession(S.premium.active, []))).toBe(before)          // the catalogue moved on; this run did not
    S = { ...S, premium: finish(S, { now: NOW + 1 }) }
    S = { ...S, premium: activate(S, v2, { tm: TM, now: NOW + 2, id: 'new' }) }
    expect(S.premium.active.programVersion).toBe(2); expect(S.premium.history[0]).toMatchObject({ instanceId: 'old', programVersion: 1 })
    expect(planSession(S.premium.active, []).blocks[0].sets[0].w).not.toBe(planSession({ ...S.premium.active, snapshot: { ...S.premium.active.snapshot, definition: v1.programDefinition } }, []).blocks[0].sets[0].w)
  })
})
