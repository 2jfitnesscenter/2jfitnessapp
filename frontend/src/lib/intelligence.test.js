import { describe, expect, it } from 'vitest'
import { intelligenceContext, intelligenceSignals, intelligenceRecommendations } from './intelligence.js'

const NOW = Date.parse('2026-09-28T12:00:00Z')
const set = (w, r, feel = 'good', rpe = 7) => ({ w, r, feel, rpe, done: true })
const workout = (day, exerciseId = '0025', sets = [set(80, 10)], target = { targetRepsMin: 8, targetRepsMax: 10, sets: 1 }) =>
  ({ d: day, entries: [{ id: exerciseId, sets, target }] })
const state = (workouts = [], extra = {}) => ({ workouts, programs: [], routines: [], unit: 'kg', customIncrements: { barbell: 2.5 }, ...extra })
const types = S => intelligenceSignals(S, { now: NOW }).map(x => x.type)

describe('Intelligence 2J deterministic signals', () => {
  it('uses two positive exposures, real increments, RPE and Series Feedback before suggesting progression', () => {
    const S = state([workout('2026-09-20'), workout('2026-09-27')])
    expect(types(S)).toContain('PROGRESSION_READY')
    const rec = intelligenceRecommendations(S, { now: NOW }).find(r => r.type === 'PROGRESSION_READY')
    expect(rec).toMatchObject({ relatedExerciseId: '0025', confidence: 'high', source: 'training-history' })
    expect(rec.expiresAt).toBeGreaterThan(NOW)
    expect(rec.reason).toContain('two sessions')
    expect(rec.action.route).toBe('/plan')
    expect(S.workouts[1].entries[0].sets[0].w).toBe(80) // selector never applies a load
    expect(types(state([workout('2026-09-27')]))).not.toContain('PROGRESSION_READY')
    expect(types(state([workout('2026-09-01'), workout('2026-09-08')]))).not.toContain('PROGRESSION_READY')
    expect(types(state([workout('2026-09-20'), workout('2026-09-27')], { enableProgressiveOverloadCoach: false }))).not.toContain('PROGRESSION_READY')
    expect(types(state([workout('2026-09-20'), workout('2026-09-27', '0025', [set(80, 10, 'hard', 9)])]))).not.toContain('PROGRESSION_READY')
  })
  it('needs repeated hard or failed exposures before load review', () => {
    expect(types(state([workout('2026-09-20', '0025', [set(80, 6, 'fail', 10)]), workout('2026-09-27', '0025', [set(80, 7, 'fail', 10)])]))).toContain('LOAD_TOO_HIGH')
    expect(types(state([workout('2026-09-27', '0025', [set(80, 7, 'fail', 10)])]))).not.toContain('LOAD_TOO_HIGH')
  })
  it('requires three unchanged exposures for plateau, and does not call one session a plateau', () => {
    const S = state(['2026-09-14', '2026-09-21', '2026-09-27'].map(day => workout(day, '0025', [set(80, 8)])))
    expect(types(S)).toContain('PLATEAU')
    expect(types(state(S.workouts.slice(1)))).not.toContain('PLATEAU')
  })
  it('uses the existing program session receipts and keeps the next logical session', () => {
    const program = { id: 'p1', source: 'guided-v2', status: 'active', catalogId: 'g2j-test', sessionsPerWeek: 3,
      weeks: [{ sessions: [{ day: 0, routineId: 'r1' }, { day: 2, routineId: 'r2' }] }], routineSnapshots: { r1: { name: 'First' }, r2: { name: 'Second' } } }
    const S = state([{ ...workout('2026-09-20'), src2j: { program: { programId: 'p1', sessionId: '1:0:0' } } }], { programs: [program], activeProgramId: 'p1' })
    expect(intelligenceContext(S, { now: NOW }).progress.next.sessionId).toBe('1:2:1')
    expect(types(S)).toContain('PROGRAM_NEXT_SESSION')
    expect(types(S)).toContain('MISSED_SESSION')
    expect(intelligenceRecommendations(S, { now: NOW })[0].action.route).toBe('/train2j/program/g2j-test')
  })
  it('uses the existing classic plan for today and never schedules a second session after completion', () => {
    const S = state([], { dayPlan: { '2026-09-28': 'r1' }, routines: [{ id: 'r1', name: 'Upper', ex: [{ id: '0025' }] }] })
    expect(types(S)).toContain('NEXT_SESSION')
    expect(types({ ...S, workouts: [workout('2026-09-28')] })).not.toContain('NEXT_SESSION')
  })
  it('detects equipment conflict using Gym Profiles, but never swaps on its own', () => {
    const routine = { id: 'r1', ex: [{ id: '0025' }] }
    const S = state([], { routines: [routine], active: { routineId: 'r1' }, gymProfiles: { activeId: 'home' } })
    expect(types(S)).toContain('EQUIPMENT_CONFLICT')
    expect(S.routines[0].ex[0].id).toBe('0025')
  })
  it('recognizes return after a gap and suppresses stale progression cards', () => {
    const S = state([workout('2026-08-01'), workout('2026-08-08')])
    expect(types(S)).toContain('RETURN_AFTER_GAP')
    expect(intelligenceRecommendations(S, { now: NOW }).map(r => r.type)).not.toContain('PROGRESSION_READY')
  })
  it('ranks active program before optional official content and deduplicates one exercise', () => {
    const S = state([workout('2026-09-20'), workout('2026-09-27')])
    const cards = intelligenceRecommendations(S, { now: NOW })
    expect(cards.filter(r => r.relatedExerciseId === '0025')).toHaveLength(1)
    expect(cards[0].priority).toBe('high')
    expect(cards[0].id).toMatch(/^i2j:/)
  })
  it('does not offer load progression when the active training place lacks the exercise equipment', () => {
    const S = state([workout('2026-09-20'), workout('2026-09-27')], { gymProfiles: { activeId: 'home' } })
    expect(types(S)).not.toContain('PROGRESSION_READY')
  })
  it('reuses declared member context and lets explicit restrictions override load advice', () => {
    const S = state([workout('2026-09-20'), workout('2026-09-27')], {
      coach: { profile: { goal: 'strength', experience: 'returning' } },
      routines: [{ id: 'other', meta: { restrictions: ['no-spinal-loading'] } }],
    })
    expect(intelligenceContext(S, { now: NOW }).user).toMatchObject({ goal: 'strength', level: 'beginner', restrictions: ['no-spinal-loading'] })
    expect(types(S)).not.toContain('PROGRESSION_READY')
  })
  it('prefers compatible official content only when there is no active program', () => {
    const official = [{ id: 'r2j-test', name: 'Mobility', official: true, active: true, category: 'mobility', level: 'beginner', goal: 'general', focus: 'upper', estimatedMinutes: 10, ex: [{ id: '0025' }] }]
    const S = state([], { routines: [{ id: 'my-routine', meta: { level: 'beginner', goal: 'general' } }] })
    expect(intelligenceRecommendations(S, { now: NOW, officialRoutines: official }).map(r => r.type)).toContain('CONTENT_SUGGESTION')
    expect(intelligenceRecommendations({ ...S, gymProfiles: { activeId: 'home' } }, { now: NOW, officialRoutines: official }).map(r => r.type)).not.toContain('CONTENT_SUGGESTION')
  })
  it('detects a recent estimated PR but does not present it as an automatic load increase', () => {
    const S = state([workout('2026-09-20', '0025', [set(80, 5)]), workout('2026-09-27', '0025', [set(90, 5)])])
    expect(types(S)).toContain('PR_RECENT')
    expect(intelligenceRecommendations(S, { now: NOW }).find(r => r.type === 'PR_RECENT')?.reason).toContain('does not mean')
    const oldBest = state([workout('2026-05-01', '0025', [set(110, 5)]), ...S.workouts])
    expect(types(oldBest)).not.toContain('PR_RECENT')
  })
  it('does not read Health, Community or private notes into provider context and is deterministic offline', () => {
    const logged = { ...workout('2026-09-27'), privateNote: 'private', entries: [{ ...workout('2026-09-27').entries[0], note: 'private' }] }
    const S = state([logged], { health: { diagnosis: 'private' }, chat: { private: true }, notes: 'private' })
    const context = intelligenceContext(S, { now: NOW })
    expect(JSON.stringify(context)).not.toMatch(/diagnosis|private|chat/)
    expect(intelligenceRecommendations(S, { now: NOW })).toEqual(intelligenceRecommendations(S, { now: NOW }))
  })
})
