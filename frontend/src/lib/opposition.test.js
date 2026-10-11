import { describe, expect, it } from 'vitest'
import seed from '../../../api/lib/opposition-official.json'
import * as o from './opposition.js'
import { premiumState } from './premium.js'
import { originOf, planSession, positionOf, skipSession } from './premium-model.js'

const profile = slug => JSON.parse(JSON.stringify(seed.profiles.find(p => p.slug === slug)))
const NOW = Date.parse('2026-10-11T10:00:00Z')
const WEEK = 7 * 86400000
const INTAKE = { sex: 'm', age: 29, days: 4, minutes: 60, organism: 'CEGC', convocatoria: '37 plazas', testVersion: '2025' }
const MARKS = { 'natacion-50': 58, dominadas: 5, 'press-banca': 11, 'velocidad-200': 41, 'resistencia-1500': 440 }
const start = (S = { workouts: [] }, extra = {}) => o.startPlan(S, { profile: profile('bomberos-cegc'), intake: INTAKE, marks: MARKS, months: 12, now: NOW, id: 'opp-t', instanceId: 'pr-1', ...extra })
const withPlan = () => { const r = start(); return { workouts: [], opposition: r.opposition, premium: r.premium } }

// Finish every session of the running block the way the app does (a workout carrying its Premium origin).
function completeBlock(S) {
  let inst = premiumState(S).active
  const workouts = [...S.workouts]
  for (let i = 0; i < 40; i++) {
    const pos = positionOf(inst, workouts)
    if (!pos.session) break
    const plan = planSession(inst, workouts)
    workouts.push({ id: 'w' + i, d: '2026-10-12', entries: [], premium: originOf(inst, plan) })
  }
  return { ...S, workouts }
}

describe('starting a plan', () => {
  it('creates the plan and the first block on the Premium engine, with the pinned profile and the chosen horizon', () => {
    const r = start()
    expect(r.error).toBeUndefined()
    const plan = r.opposition.plan, inst = r.premium.active
    expect(plan).toMatchObject({ id: 'opp-t', profileId: 'opp-bomberos-cegc', profileVersion: 1, months: 12, blockIndex: 0, status: 'active' })
    expect(inst.programId).toBe('opposition-opp-t-b1'); expect(inst.snapshot.definition.cycleWeeks).toBe(5); expect(inst.snapshot.coverImage).toBe(o.COVER.image)
    expect(o.runsPlan({ opposition: r.opposition, premium: r.premium })).toBe(true)
  })
  it('asks for what is missing instead of guessing', () => {
    expect(start({ workouts: [] }, { intake: { ...INTAKE, sex: null } })).toMatchObject({ error: 'missing', missing: ['sex'] })
    expect(start({ workouts: [] }, { months: null })).toMatchObject({ error: 'missing', missing: ['horizon'] })
  })
  it('starting over closes the previous plan into the history and the running Premium program into its own history; workouts are untouched', () => {
    const S = withPlan(); S.workouts = [{ id: 'keep', d: '2026-10-01', entries: [] }]
    const r = start(S, { id: 'opp-2', instanceId: 'pr-2' })
    expect(r.opposition.history.map(h => [h.id, h.reason])).toEqual([['opp-t', 'replaced']])
    expect(r.premium.history.map(h => h.reason)).toEqual(['switched']); expect(S.workouts).toHaveLength(1)
  })
  it('a malformed or missing state reads as "no plan"', () => {
    expect(o.oppositionState({}).plan).toBeNull(); expect(o.oppositionState({ opposition: { plan: { junk: 1 } } }).plan).toBeNull(); expect(o.oppositionState({ opposition: 'x' }).history).toEqual([])
    expect(o.planView({})).toBeNull(); expect(o.runsPlan({})).toBe(false); expect(o.planAdherenceOf({})).toBeNull()
  })
})

describe('the plan view and the control', () => {
  it('shows week, phase, time left and the level; the control is offered only in the control week or after the block', () => {
    const S = withPlan()
    const v = o.planView(S, NOW + 2 * WEEK)
    expect(v.phase).toBe('base'); expect(v.calendarWeek).toBe(3); expect(v.weeksLeft).toBe(50); expect(v.canEvaluate).toBe(false); expect(v.controlWeek).toBe(false)
    expect(v.summary.officialThresholds.dominadas.minimum).toBe(8)
    const done = completeBlock(S)
    const v2 = o.planView(done, NOW + 5 * WEEK)
    expect(v2.blockDone).toBe(true); expect(v2.canEvaluate).toBe(true)
  })
  it('a control records the marks, the statuses and a proposal, and changes nothing else (no block, no workout)', () => {
    const S = completeBlock(withPlan())
    const r = o.submitEvaluation(S, { 'natacion-50': 53, dominadas: 6, 'press-banca': 16, 'velocidad-200': 38, 'resistencia-1500': 410 }, { now: NOW + 5 * WEEK })
    expect(r.error).toBeUndefined()
    const plan = r.opposition.plan
    expect(plan.evaluations).toHaveLength(1); expect(plan.marks.dominadas).toBe(6); expect(plan.marks['natacion-50']).toBe(53); expect(plan.blockIndex).toBe(0)
    expect(plan.proposal).toMatchObject({ confirmed: false }); expect(plan.proposal.changes.length).toBeGreaterThan(0)
    expect(plan.evaluations[0].atBlock).toBe(0)
    expect(premiumState(S).active.programId).toBe('opposition-opp-t-b1')
    expect(o.planView({ ...S, opposition: r.opposition }, NOW + 5 * WEEK).evaluated).toBe(true)
    expect(o.submitEvaluation(S, {}, { now: NOW }).error).toBe('no-marks')
    expect(o.submitEvaluation({}, { dominadas: 3 }).error).toBe('no-plan')
  })
  it('confirming the proposal finishes the block (kept in the plan and the Premium history) and starts the next one; dismissing keeps everything', () => {
    let S = completeBlock(withPlan())
    const ev = o.submitEvaluation(S, { 'natacion-50': 53, dominadas: 6, 'press-banca': 16, 'velocidad-200': 38, 'resistencia-1500': 410 }, { now: NOW + 5 * WEEK })
    S = { ...S, opposition: ev.opposition }
    const dismissed = o.dismissProposal(S)
    expect(dismissed.plan.proposal).toBeNull(); expect(dismissed.plan.evaluations).toHaveLength(1); expect(dismissed.plan.blockIndex).toBe(0)
    const c = o.confirmProposal(S, { now: NOW + 5 * WEEK, instanceId: 'pr-2' })
    expect(c.error).toBeUndefined()
    expect(c.opposition.plan.blockIndex).toBe(1); expect(c.opposition.plan.proposal).toBeNull()
    expect(c.opposition.plan.blocks).toEqual([expect.objectContaining({ index: 0, planned: 20, completed: 20 })])
    expect(c.premium.active.programId).toBe('opposition-opp-t-b2'); expect(c.premium.history.map(h => h.reason)).toEqual(['finished'])
    expect(c.premium.history[0].sessions).toBe(S.workouts.length)
    expect(o.confirmProposal({ ...S, opposition: dismissed }, {}).error).toBe('no-proposal')
  })
  it('plan-level adherence adds the finished blocks to the one under way', () => {
    let S = completeBlock(withPlan())
    expect(o.planAdherenceOf(S, NOW + 5 * WEEK)).toBe(100)
    const ev = o.submitEvaluation(S, { dominadas: 6 }, { now: NOW + 5 * WEEK })
    S = { ...S, opposition: ev.opposition }
    const c = o.confirmProposal(S, { now: NOW + 5 * WEEK, instanceId: 'pr-2' })
    S = { ...S, opposition: c.opposition, premium: c.premium }
    expect(o.planAdherenceOf(S, NOW + 6 * WEEK)).toBeLessThanOrEqual(100); expect(o.planAdherenceOf(S, NOW + 6 * WEEK)).toBeGreaterThan(50)
    const skipped = { ...S, premium: { ...S.premium, active: skipSession(S.premium.active, S.workouts, NOW) } }
    expect(o.planAdherenceOf(skipped, NOW + 6 * WEEK)).toBeGreaterThan(0)
  })
})

describe('a new convocatoria and ending the plan', () => {
  it('a newer version is only offered; the plan keeps its pinned one until the member moves, and the old snapshot stays in its history', () => {
    const S = withPlan()
    const newer = profile('bomberos-cegc'); newer.version = 2; newer.tests[1].marks.m = [{ p: 5, v: 10 }, { p: 10, v: 20 }]
    expect(o.newerVersion(S.opposition.plan, [newer])).toBe(newer); expect(o.newerVersion(S.opposition.plan, [profile('bomberos-cegc')])).toBeFalsy(); expect(o.newerVersion(S.opposition.plan, [])).toBeFalsy()
    expect(S.opposition.plan.profileVersion).toBe(1)
    const moved = o.moveToVersion(S, newer, { now: NOW })
    expect(moved.plan.profileVersion).toBe(2); expect(moved.plan.profileHistory[0].snapshot.tests[1].marks.m[0].v).toBe(8)
    expect(o.moveToVersion(S, { ...newer, id: 'otro' }).plan.profileVersion).toBe(1); expect(o.moveToVersion(S, { ...newer, version: 1 }).plan.profileVersion).toBe(1)
  })
  it('ending the plan closes the block into the Premium history and the plan into its own; workouts stay', () => {
    const S = withPlan(); S.workouts = [{ id: 'w', d: '2026-10-12', entries: [] }]
    const r = o.endPlan(S, { now: NOW + WEEK })
    expect(r.opposition.plan).toBeNull(); expect(r.opposition.history.map(h => [h.id, h.reason])).toEqual([['opp-t', 'ended']]); expect(r.premium.active).toBeNull(); expect(r.premium.history.map(h => h.reason)).toEqual(['finished'])
    expect(S.workouts).toHaveLength(1)
  })
})

describe('a plan whose block was closed', () => {
  it('can restart its current block from where the plan is (marks, levels and workouts untouched); nothing happens while a block is running', () => {
    const S = withPlan()
    expect(o.resumeBlock(S, { now: NOW }).error).toBe('running')
    const closedPremium = premiumState({ ...S, premium: S.premium })
    const S2 = { ...S, premium: { v: 1, active: null, history: closedPremium.history } }
    expect(o.planView(S2, NOW + 2 * WEEK).noBlock).toBe(true)
    const r = o.resumeBlock(S2, { now: NOW + 2 * WEEK, instanceId: 'pr-9' })
    expect(r.error).toBeUndefined()
    expect(r.premium.active.programId).toBe('opposition-opp-t-b1'); expect(r.premium.active.id).toBe('pr-9')
    expect(r.opposition.plan.marks).toEqual(S.opposition.plan.marks)
    expect(o.planView({ ...S2, premium: r.premium }, NOW + 2 * WEEK).noBlock).toBe(false)
  })
})
