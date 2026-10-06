import { describe, expect, it } from 'vitest'
import { previewExpressSession, shortenExpressWarmups, weekReorderSuggestion, applyWeekReorder, movedFromForDate, sessionHistoryMetadata, clearRescheduleAtDate } from './session-adaptation.js'
import { isMovedDayPlan } from './day-plan.js'
import { effectiveRoutineId } from './history.js'
import { todayISO } from './format.js'

const S = { restSec: 90, warmupEnabled: false, priorityMuscles: [] }
const routine = (id, ex) => ({ id, name: id, ex })
const cfg = (id, values = {}) => ({ id, sets: 4, reps: 10, weight: 20, ...values })
const base = routine('upper', [cfg('1254'), cfg('2330'), cfg('0968'), cfg('0977')])

describe('Express session adaptation', () => {
  it.each([15, 25, 40])('creates a session-only preview for %i minutes', minutes => {
    const original = structuredClone(base)
    const preview = previewExpressSession(base, minutes, S)
    expect(preview.info.kind).toBe('express')
    expect(preview.info.minutes).toBe(minutes)
    expect(preview.routine).not.toBe(base)
    expect(base).toEqual(original)
  })

  it('preserves the first basic, explicit anchors, priority muscles and restricted exercises', () => {
    const plan = routine('anchors', [cfg('1254'), cfg('2330'), cfg('0968', { restriction: 'shoulder' }), cfg('0977')])
    const preview = previewExpressSession(plan, 15, { ...S, priorityMuscles: ['back'] })
    for (const id of ['1254', '2330', '0968']) expect(preview.routine.ex.some(x => x.id === id)).toBe(true)
    expect(preview.info.anchorIds).toEqual(expect.arrayContaining(['1254', '2330', '0968']))
  })

  it('preserves an exercise affected by today’s declared discomfort', () => {
    const plan = routine('pain', [cfg('1254'), cfg('0968'), cfg('2330')])
    const preview = previewExpressSession(plan, 15, { ...S, checkins: [{ d: todayISO(), pain: true, zones: ['arm'] }] })
    expect(preview.info.anchorIds).toContain('0968')
    expect(preview.routine.ex.some(x => x.id === '0968')).toBe(true)
  })

  it('trims accessory sets before removing accessories and preserves anchors', () => {
    const plan = routine('sets', [cfg('1254', { anchor: true }), cfg('2330', { sets: 3 }), cfg('0968', { sets: 3 }), cfg('0977', { sets: 3 })])
    const preview = previewExpressSession(plan, 25, S)
    const firstRemovedAt = preview.info.removed.length ? preview.info.removed[0].id : null
    const reduction = preview.info.reducedSets.find(x => x.id !== '1254')
    expect(reduction).toBeTruthy()
    if (firstRemovedAt) expect(reduction).toBeTruthy()
    expect(preview.routine.ex.some(x => x.id === '1254')).toBe(true)
  })

  it('does not reduce or remove exercises when the original fits the selected duration', () => {
    const short = routine('short', [cfg('1254', { sets: 1, anchor: true })])
    const preview = previewExpressSession(short, 40, S)
    expect(preview.info.reducedSets).toEqual([])
    expect(preview.info.removed).toEqual([])
  })

  it('pairs only non-anchor exercises with disjoint muscle groups', () => {
    const plan = routine('pair', [cfg('1254', { anchor: true }), cfg('0968', { sets: 2 }), cfg('0977', { sets: 2 }), cfg('2330', { sets: 2 })])
    const preview = previewExpressSession(plan, 40, S)
    expect(preview.info.supersets.length).toBeGreaterThan(0)
    expect(preview.info.supersets.flat()).not.toContain('1254')
    expect(new Set(preview.info.supersets.flat()).size).toBe(preview.info.supersets.flat().length)
  })

  it('does not create supersets across overlapping muscles or different equipment', () => {
    const plan = routine('unsafe-pairs', [
      cfg('1254', { anchor: true }),
      cfg('0968', { sets: 2 }),
      cfg('0986', { sets: 2 }),
      cfg('0178', { sets: 2 })
    ])
    const preview = previewExpressSession(plan, 40, S)
    expect(preview.info.supersets).not.toContainEqual(['0968', '0986'])
    expect(preview.info.supersets).toEqual([])
  })

  it('cleans an existing superset if Express removes only one of its accessories', () => {
    const plan = routine('broken-pair', [
      cfg('1254', { anchor: true, sets: 5 }),
      cfg('0968', { sets: 1, sg: 'original' }),
      cfg('0986', { sets: 1, sg: 'original' })
    ])
    const preview = previewExpressSession(plan, 15, S)
    const members = ['0968', '0986'].filter(id => preview.routine.ex.some(x => x.id === id))
    expect(members).toHaveLength(1)
    expect(preview.info.removed.map(x => x.id)).toHaveLength(1)
    expect(preview.routine.ex.find(x => x.id === members[0]).sg).toBeUndefined()
  })

  it('keeps prescribed work and shortens only non-anchor warm-up ramps', () => {
    const entries = [
      { id: '1254', sets: [{ type: 'warmup' }, { type: 'warmup' }, { done: false }] },
      { id: '0968', sets: [{ type: 'warmup' }, { type: 'warmup' }, { done: false }] }
    ]
    const result = shortenExpressWarmups(entries, { anchorIds: ['1254'] })
    expect(result.entries[0].sets.filter(x => x.type === 'warmup')).toHaveLength(2)
    expect(result.entries[1].sets.filter(x => x.type === 'warmup')).toHaveLength(1)
    expect(result.entries[1].sets.at(0)).toBe(entries[1].sets[1])
    expect(entries[1].sets).toHaveLength(3)
  })

  it('records the actual Express/reorder metadata beside performed workout entries', () => {
    expect(sessionHistoryMetadata({ sessionPlan: { kind: 'express', minutes: 15, removed: [{ id: '0968' }] }, rescheduledFrom: '2026-10-06' }))
      .toEqual({ sessionPlan: { kind: 'express', minutes: 15, removed: [{ id: '0968' }] }, rescheduledFrom: '2026-10-06' })
    expect(sessionHistoryMetadata({})).toEqual({})
  })

  it('rejects invalid durations and signals when protected work cannot fit', () => {
    expect(previewExpressSession(base, 20, S)).toBeNull()
    const huge = routine('fixed', [cfg('1254', { anchor: true, sets: 1, mode: 'cardio', min: 30 })])
    const preview = previewExpressSession(huge, 15, S)
    expect(preview.info.overBudget).toBe(true)
  })

  it('keeps every cardio prescription as protected work instead of changing cardio progression targets', () => {
    const cardio = routine('cardio', [cfg('2330', { mode: 'cardio', min: 35, speed: 8, sets: 1 })])
    const preview = previewExpressSession(cardio, 15, S)
    expect(preview.routine.ex).toEqual(cardio.ex)
    expect(preview.info.overBudget).toBe(true)
    expect(cardio.ex[0]).toMatchObject({ min: 35, speed: 8 })
  })
})

const chest = routine('chest', [cfg('1254')])
const back = routine('back', [cfg('2330')])
const makeWeekState = () => ({
  active: null, routines: [chest, back], workouts: [], programs: [], activeProgramId: null,
  week: {}, dayPlan: { '2026-10-06': 'chest' }
})

describe('week reorder derived from dayPlan and history', () => {
  it('moves the missed session to the earliest empty, recovery-safe day', () => {
    const state = makeWeekState()
    const proposal = weekReorderSuggestion(state, '2026-10-07')
    expect(proposal).toMatchObject({ date: '2026-10-06', target: '2026-10-07', routineId: 'chest' })
    const dayPlan = applyWeekReorder(state.dayPlan, proposal)
    expect(dayPlan['2026-10-06']).toBe('moved:2026-10-07:chest')
    expect(effectiveRoutineId({ ...state, dayPlan }, '2026-10-06')).toBeNull()
    expect(effectiveRoutineId({ ...state, dayPlan }, '2026-10-07')).toBe('chest')
    expect(movedFromForDate({ dayPlan }, '2026-10-07', 'chest')).toBe('2026-10-06')
    expect(isMovedDayPlan(dayPlan['2026-10-06'])).toBe(true)
    const afterReload = JSON.parse(JSON.stringify({ ...state, dayPlan }))
    expect(effectiveRoutineId(afterReload, '2026-10-06')).toBeNull()
    expect(effectiveRoutineId(afterReload, '2026-10-07')).toBe('chest')
  })

  it('skips a day after a completed session for the same large muscle group', () => {
    const state = makeWeekState()
    state.dayPlan['2026-10-05'] = 'chest'
    state.workouts.push({ id: 'done', d: '2026-10-06', routineId: 'chest' })
    const proposal = weekReorderSuggestion(state, '2026-10-07')
    expect(proposal.target).toBe('2026-10-08')
  })

  it('does not propose completed, active, or unassigned sessions as missed work', () => {
    const complete = makeWeekState()
    complete.workouts.push({ id: 'done', d: '2026-10-06', routineId: 'chest' })
    expect(weekReorderSuggestion(complete, '2026-10-07')).toBeNull()
    const active = makeWeekState()
    active.active = { id: 'live', d: '2026-10-07' }
    expect(weekReorderSuggestion(active, '2026-10-07')).toBeNull()
    expect(weekReorderSuggestion({ ...makeWeekState(), dayPlan: {} }, '2026-10-07')).toBeNull()
  })

  it('can move across the week boundary and offers Express if every slot is occupied', () => {
    const state = makeWeekState()
    for (const date of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13', '2026-10-14']) state.dayPlan[date] = 'rest'
    const express = weekReorderSuggestion(state, '2026-10-07')
    expect(express.expressAvailable).toBe(true)
    expect(express.target).toBe('2026-10-07')
    expect(applyWeekReorder(state.dayPlan, express)).toBeNull()
  })

  it('uses the active program week and can place the session in the following week', () => {
    const state = makeWeekState()
    state.dayPlan = {}
    state.programs = [{ id: 'p', status: 'active', week: { 1: 'chest' } }]
    state.activeProgramId = 'p'
    for (const date of ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13']) state.dayPlan[date] = 'rest'
    const proposal = weekReorderSuggestion(state, '2026-10-07')
    expect(proposal.date).toBe('2026-10-05')
    expect(proposal.target).toBe('2026-10-14')
  })

  it('still finds a missed session when the member returns at the start of the next week', () => {
    const state = makeWeekState()
    state.dayPlan = {}
    state.week = { 5: 'chest' } // Friday of the prior week
    const proposal = weekReorderSuggestion(state, '2026-10-05')
    expect(proposal.date).toBe('2026-10-02')
    expect(proposal.target).toBe('2026-10-05')
  })

  it('does not overwrite a slot when a stale proposal is applied', () => {
    const state = makeWeekState()
    const proposal = weekReorderSuggestion(state, '2026-10-07')
    expect(applyWeekReorder({ ...state.dayPlan, [proposal.target]: 'rest' }, proposal)).toBeNull()
  })

  it('cancels linked source/target overrides when the user manually edits either day', () => {
    const linked = { '2026-10-06': 'moved:2026-10-07:chest', '2026-10-07': 'chest' }
    expect(clearRescheduleAtDate(linked, '2026-10-06')).toEqual({})
    expect(clearRescheduleAtDate(linked, '2026-10-07')).toEqual({ '2026-10-07': 'chest' })
  })
})
