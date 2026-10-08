import { describe, expect, it } from 'vitest'
import { cycleStart, markProgramReviewed, markReviewed, pendingReviews, plateau, routineReviews, setCycleDates, setProgramCycleDates } from './routine-review.js'
import { followupDigest } from './followup-v3.js'
import { rankAttention } from './attention.js'

/* Routine review loop: normal review in week 5, brought forward to week 4 only by a CLEAR plateau, never by one bad session, never edits a routine,
   "Rutina revisada" restarts the cycle, and data without any of this metadata is simply not in a cycle. */
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const entry = (id, sets, tg = { sets: sets.length, reps: 8 }) => ({ id, target: tg, sets })
const workout = (d, entries, routineId = 'r1') => ({ id: 'w' + d + routineId, d, routineId, entries })
const ROUTINE = { id: 'r1', name: 'Push day', ex: [{ id: 'A' }, { id: 'B' }] }
const state = (workouts, over = {}) => ({ routines: [ROUTINE], workouts, ...over })
// `loads`: one [weightA, repsA, weightB, repsB] per session, every 2–3 days from `first`
const sessions = (first, rows, extra = () => ({})) => rows.map(([wa, ra, wb, rb], i) =>
  workout(addDays(first, i * 3), [entry('A', [set(wa, ra, extra(i, 'A')), set(wa, ra, extra(i, 'A'))]), entry('B', [set(wb, rb, extra(i, 'B')), set(wb, rb, extra(i, 'B'))])]))
const PROGRESSING = [[60, 8, 40, 8], [62.5, 8, 40, 10], [62.5, 10, 42.5, 8], [65, 8, 42.5, 10], [65, 10, 45, 8]]
const FLAT = [[60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8]]
const FIRST = '2026-09-01'

describe('cycle', () => {
  it('starts at the first logged workout; no workout and no mark means no cycle', () => {
    expect(cycleStart(state(sessions(FIRST, FLAT)), ROUTINE)).toEqual({ start: FIRST, source: 'first', exclusive: false })
    expect(cycleStart(state([]), ROUTINE)).toBeNull()
    expect(routineReviews(state([]), '2026-10-30')).toEqual([])
  })
  it('a staff replacement (routine version) restarts it; so does "reviewed" — whichever is later', () => {
    const v = Date.parse('2026-09-20T10:00:00Z')
    expect(cycleStart(state(sessions(FIRST, FLAT), { routineVersions: { r1: [{ versionedAt: v }] } }), ROUTINE)).toMatchObject({ start: '2026-09-20', source: 'version' })
    const S = state(sessions(FIRST, FLAT), { routineVersions: { r1: [{ versionedAt: v }] }, routineReviews: { r1: { reviewedAt: '2026-09-25' } } })
    expect(cycleStart(S, ROUTINE)).toMatchObject({ start: '2026-09-25', source: 'reviewed' })
  })
})

describe('program-level review', () => {
  const programState = () => {
    const programs = [{ id: 'p1', source: 'guided-v2', status: 'active', name: 'Strength 4 days', startedAt: Date.parse(FIRST + 'T12:00:00Z'), weeks: [{ sessions: [1, 2, 3, 4].map((_, i) => ({ day: i, routineId: 'r' + (i + 1) })) }] }]
    const routines = [1, 2, 3, 4].map(i => ({ id: 'r' + i, name: 'Day ' + i, ex: [] }))
    const workouts = [1, 2, 3, 4].map((_, i) => ({ id: 'pwork' + i, d: addDays(FIRST, 3 + i), routineId: 'r' + (i + 1), src2j: { program: { programId: 'p1', sessionId: `1:${i}:${i}` } }, entries: [] }))
    return { programs, activeProgramId: 'p1', routines, workouts, week: {}, routineReviews: Object.fromEntries(routines.map(r => [r.id, { reviewedAt: FIRST }])) }
  }
  it('a four-day active program produces one review cycle, not one per routine', () => {
    const S = programState()
    const cycles = routineReviews(S, addDays(FIRST, 28))
    expect(cycles).toHaveLength(1)
    expect(cycles[0]).toMatchObject({ kind: 'program', programId: 'p1', routineIds: ['r1', 'r2', 'r3', 'r4'], status: 'due', start: FIRST, adherence: { total: 4, completed: 4, percent: 100 } })
    expect(pendingReviews(S, addDays(FIRST, 28))).toHaveLength(1)
  })
  it('program adherence compares completed sessions only with weeks that have elapsed', () => {
    const S = programState()
    const sessionsPerWeek = [0, 1, 2, 3].map(i => ({ day: i, routineId: `r${i + 1}` }))
    S.programs[0].weeks = Array.from({ length: 8 }, () => ({ sessions: sessionsPerWeek }))
    S.workouts = Array.from({ length: 8 }, (_, i) => {
      const week = Math.floor(i / 2), day = i % 2
      return { id: `elapsed-${i}`, d: addDays(FIRST, week * 7 + day * 3), routineId: `r${day + 1}`, src2j: { program: { programId: 'p1', sessionId: `${week + 1}:${day}:${day}` } }, entries: [] }
    })
    const [review] = routineReviews(S, addDays(FIRST, 28))
    expect(review.adherence).toEqual({ completed: 8, total: 16, percent: 50 })
  })
  it('overdue status is explicit and starts 14 days after the due date', () => {
    const S = programState()
    expect(routineReviews(S, addDays(FIRST, 41))[0].status).toBe('due')
    expect(routineReviews(S, addDays(FIRST, 42))[0]).toMatchObject({ status: 'overdue', late: true })
  })
  it('marking reviewed records nextReviewAt, clears the pending notice, and returns only at that date', () => {
    const S = programState(), today = addDays(FIRST, 28)
    const before = JSON.stringify(S.routines)
    expect(markProgramReviewed(S, 'p1', today, 'trainer1')).toBe(true)
    expect(S.programReviews.p1).toMatchObject({ lastReviewAt: today, nextReviewAt: addDays(today, 28), by: 'trainer1', n: 1 })
    expect(pendingReviews(S, today)).toEqual([])
    expect(pendingReviews(S, addDays(today, 27))).toEqual([])
    expect(pendingReviews(S, addDays(today, 28))).toHaveLength(1)
    expect(JSON.stringify(S.routines)).toBe(before)
    expect(routineReviews(S, today)[0].dueManual).toBe(false)
  })
  it('does not reopen a reviewed program early from the same plateau before nextReviewAt', () => {
    const S = programState(), today = addDays(FIRST, 28)
    S.workouts = sessions(FIRST, FLAT).map((w, i) => ({ ...w, src2j: { program: { programId: 'p1', sessionId: `1:${i}:0` } } }))
    expect(routineReviews(S, today)[0].plateau.clear).toBe(true)
    expect(pendingReviews(S, today)).toHaveLength(1)
    expect(markProgramReviewed(S, 'p1', today, 'trainer1')).toBe(true)
    expect(pendingReviews(S, addDays(today, 1))).toEqual([])
    expect(routineReviews(S, addDays(today, 1))[0]).toMatchObject({ status: 'upcoming', nextReviewAt: addDays(today, 28) })
    expect(pendingReviews(S, addDays(today, 28))).toHaveLength(1)
  })
  it('a staff date override is explicit and is cleared when that program review is completed', () => {
    const S = programState()
    const due = addDays(FIRST, 45)
    expect(setProgramCycleDates(S, 'p1', { due }, 'trainer1')).toBe(true)
    expect(routineReviews(S, addDays(FIRST, 28))[0]).toMatchObject({ status: 'upcoming', dueManual: true, dueDate: due })
    expect(markProgramReviewed(S, 'p1', addDays(FIRST, 28), 'trainer1')).toBe(true)
    expect(S.programReviews.p1.nextReviewOverride).toBeUndefined()
    expect(routineReviews(S, addDays(FIRST, 28))[0]).toMatchObject({ dueManual: false, nextReviewAt: addDays(FIRST, 56) })
  })
  it('small routine edits do not reset the active program cycle; independent routines retain routine review', () => {
    const S = programState()
    S.routines.push({ id: 'loose', name: 'Independent' })
    S.workouts.push(...sessions(FIRST, FLAT).map(w => ({ ...w, id: 'loose-' + w.id, routineId: 'loose' })))
    S.routineVersions = { r1: [{ versionedAt: Date.parse('2026-10-01T12:00:00Z') }], loose: [{ versionedAt: Date.parse('2026-09-10T12:00:00Z') }] }
    const cycles = routineReviews(S, '2026-10-06')
    expect(cycles.find(c => c.kind === 'program')).toMatchObject({ start: FIRST })
    expect(cycles.find(c => c.routineId === 'loose')).toBeTruthy()
    expect(cycles.some(c => c.routineId && ['r1', 'r2', 'r3', 'r4'].includes(c.routineId))).toBe(false)
  })
})

describe('when a review is due', () => {
  it('week 5 → normal review', () => {
    const S = state(sessions(FIRST, PROGRESSING))
    const r = routineReviews(S, addDays(FIRST, 28))[0]
    expect(r).toMatchObject({ week: 5, status: 'due', early: false, sessions: 5 })
    expect(r.reasons[0]).toEqual({ code: 'week', week: 5 })
    expect(pendingReviews(S, addDays(FIRST, 28))).toHaveLength(1)
    expect(routineReviews(S, addDays(FIRST, 27))[0].status).not.toBe('due')   // still week 4
  })
  it('week 4 + a clear plateau → brought forward', () => {
    const S = state(sessions(FIRST, FLAT))
    const r = routineReviews(S, addDays(FIRST, 21))[0]
    expect(r).toMatchObject({ week: 4, status: 'early', early: true })
    expect(r.reasons).toContainEqual({ code: 'stalled', n: 2, of: 2 })
  })
  it('week 4 with normal progress → not brought forward', () => {
    const S = state(sessions(FIRST, PROGRESSING))
    expect(routineReviews(S, addDays(FIRST, 21))[0]).toMatchObject({ week: 4, status: 'soon', early: false })
    expect(pendingReviews(S, addDays(FIRST, 21))).toEqual([])
  })
  it('never before week 4, and never with fewer than 3 sessions', () => {
    expect(routineReviews(state(sessions(FIRST, FLAT)), addDays(FIRST, 20))[0].status).toBe('ok')
    expect(routineReviews(state(sessions(FIRST, FLAT.slice(0, 2))), addDays(FIRST, 40))[0].status).toBe('idle')
    expect(pendingReviews(state(sessions(FIRST, FLAT.slice(0, 2))), addDays(FIRST, 40))).toEqual([])
  })
  it('a routine left for 2+ weeks past its review date is marked late', () => {
    const S = state(sessions(FIRST, PROGRESSING))
    expect(routineReviews(S, addDays(FIRST, 28 + 13))[0].late).toBe(false)
    expect(routineReviews(S, addDays(FIRST, 28 + 14))[0].late).toBe(true)
  })
})

describe('plateau rules are explainable and one bad session never triggers', () => {
  it('a single bad session after real progress is not a plateau', () => {
    const rows = [...PROGRESSING, [55, 5, 35, 5]]
    const bad = sessions(FIRST, rows, (i) => (i === 5 ? { feel: 'fail', rpe: 10 } : {}))
    const p = plateau(bad)
    expect(p.clear).toBe(false)
    expect(routineReviews(state(bad), addDays(FIRST, 21))[0].early).toBe(false)
  })
  it('one stalled exercise alone is not clear; with a supporting signal it is', () => {
    // A flat, B progressing
    const rows = [[60, 8, 40, 8], [60, 8, 42.5, 8], [60, 8, 45, 8], [60, 8, 47.5, 8], [60, 8, 50, 8]]
    expect(plateau(sessions(FIRST, rows)).clear).toBe(false)
    expect(plateau(sessions(FIRST, rows)).stalled).toEqual(['A'])
    // …and the last 2 of 3 sessions had failures on A
    const misses = plateau(sessions(FIRST, rows, (i, id) => (id === 'A' && i >= 3 ? { feel: 'fail' } : {})))
    expect(misses.clear).toBe(true)
    expect(misses.reasons.map(r => r.code)).toEqual(expect.arrayContaining(['stalled', 'misses']))
  })
  it('real effort getting worse at the same load is a signal (RPE up ≥ 1)', () => {
    const rows = [[60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8]]
    const p = plateau(sessions(FIRST, rows, (i) => ({ rpe: [7, 7.5, 8.5, 9, 9][i] })))
    expect(p.reasons.some(r => r.code === 'effort_up')).toBe(true)
    // RIR is read through the same scale; better effort is not a signal
    expect(plateau(sessions(FIRST, rows, (i) => ({ rir: [1, 1, 2, 3, 3][i] }))).reasons.some(r => r.code === 'effort_up')).toBe(false)
  })
  it('repeatedly "hard" sessions and cut-short sessions count only when it repeats (≥ 2 of the last 3)', () => {
    const hard = plateau(sessions(FIRST, FLAT, (i) => (i >= 4 ? { feel: 'hard' } : { feel: 'good' })))
    expect(hard.reasons.some(r => r.code === 'hard')).toBe(false)           // only the last session was hard: 1 of 3
    const hard2 = plateau(sessions(FIRST, FLAT, (i) => (i >= 2 ? { feel: 'hard' } : { feel: 'good' })))
    expect(hard2.reasons).toContainEqual({ code: 'hard', n: 3 })
    const cut = FLAT.map((r, i) => workout(addDays(FIRST, i * 3), [entry('A', [set(60, 8)], { sets: 4, reps: 8 }), entry('B', [set(40, 8)], { sets: 4, reps: 8 })]))
    expect(plateau(cut).reasons).toContainEqual({ code: 'incomplete', n: 3 })
    expect(plateau(sessions(FIRST, FLAT)).reasons.some(r => r.code === 'incomplete')).toBe(false)
  })
  it('warm-up and undone sets never count; unloaded exercises use reps', () => {
    const w = [workout('2026-09-01', [entry('A', [{ w: 100, r: 1, done: true, type: 'warmup' }, { w: 60, r: 8, done: false }, set(60, 8)])])]
    expect(plateau(w).evaluable).toBe(0)
    const bw = [5, 5, 5, 5, 5].map((r, i) => workout(addDays(FIRST, i * 3), [entry('P', [set(0, r)])]))
    expect(plateau(bw).stalled).toEqual(['P'])
    const bw2 = [5, 6, 7, 8, 9].map((r, i) => workout(addDays(FIRST, i * 3), [entry('P', [set(0, r)])]))
    expect(plateau(bw2).stalled).toEqual([])
  })
})

describe('"Rutina revisada"', () => {
  it('closes the notice and restarts the cycle from that day; the routine is untouched', () => {
    const S = state(sessions(FIRST, PROGRESSING))
    const today = addDays(FIRST, 28)
    const before = JSON.stringify(S.routines)
    expect(pendingReviews(S, today)).toHaveLength(1)
    expect(markReviewed(S, 'r1', today, 'staff1')).toBe(true)
    expect(S.routineReviews.r1).toEqual({ reviewedAt: today, by: 'staff1', n: 1 })
    expect(JSON.stringify(S.routines)).toBe(before)
    expect(pendingReviews(S, today)).toEqual([])
    expect(routineReviews(S, today)[0]).toMatchObject({ status: 'idle', week: 1, source: 'reviewed' })
    // new sessions after the mark count for the new cycle, and it comes back at week 5 of THAT cycle
    S.workouts.push(...sessions(addDays(today, 1), PROGRESSING))
    expect(pendingReviews(S, addDays(today, 27))).toEqual([])
    expect(pendingReviews(S, addDays(today, 28))).toHaveLength(1)
    expect(markReviewed(S, 'r1', addDays(today, 28), 'staff1')).toBe(true)
    expect(S.routineReviews.r1.by).toBe('staff1')
    expect(S.routineReviews.r1.n).toBe(2)
  })
  it('refuses an unknown routine or a bad date', () => {
    const S = state([])
    expect(markReviewed(S, 'nope', '2026-10-01', 'x')).toBe(false)
    expect(markReviewed(S, 'r1', 'yesterday', 'x')).toBe(false)
    expect(S.routineReviews).toBeUndefined()
  })
})

describe('old or odd data never breaks it', () => {
  it('missing everything', () => {
    for (const S of [undefined, null, {}, { routines: [{ id: 'r1' }] }, { routines: [ROUTINE], workouts: [{}, null, { routineId: 'r1' }, { routineId: 'r1', d: 'bad' }] },
      { routines: [ROUTINE], workouts: [{ routineId: 'r1', d: FIRST }, { routineId: 'r1', d: addDays(FIRST, 2), entries: [null, {}, { id: 'A' }, { id: 'A', sets: [null] }] }, { routineId: 'r1', d: addDays(FIRST, 4) }] }]) {
      expect(() => routineReviews(S, '2026-11-30')).not.toThrow()
      expect(() => pendingReviews(S, '2026-11-30')).not.toThrow()
      expect(Array.isArray(pendingReviews(S, '2026-11-30'))).toBe(true)   // three logged sessions with no detail are still three sessions in week 5+
    }
  })
})

describe('what the member and the staff get', () => {
  const S = state(sessions(FIRST, FLAT))
  const today = addDays(FIRST, 21)
  it('the member digest carries the same review (Seguimiento / Home)', () => {
    const d = followupDigest(S, null, today)
    expect(d.reviews).toHaveLength(1)
    expect(d.reviews[0]).toMatchObject({ routineId: 'r1', name: 'Push day', status: 'early' })
    expect(d.empty).toBe(false)
    expect(followupDigest(state(sessions(FIRST, PROGRESSING)), null, today).reviews).toEqual([])
  })
  it('the staff list ranks a pending review under "coming up", and a late one as urgent', () => {
    const row = (late) => ({ user: { id: 'u1', name: 'Ana' }, summary: {}, alerts: [{ code: 'routine_review', routineId: 'r1', name: 'Push day', week: 5, early: false, late, reasons: [] }] })
    expect(rankAttention([row(false)], '2026-10-06').soon).toHaveLength(1)
    expect(rankAttention([row(true)], '2026-10-06').urgent).toHaveLength(1)
    expect(rankAttention([{ user: { id: 'u2' }, summary: {}, alerts: [] }], '2026-10-06').onTrack).toHaveLength(1)
  })
})

describe('RPE / RIR are read on one scale before the trend is compared', () => {
  const flatRows = [[60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8], [60, 8, 40, 8]]
  const effort = fn => plateau(sessions(FIRST, flatRows, fn)).reasons.some(r => r.code === 'effort_up')
  it('higher RPE is harder; LOWER RIR is harder (RPE = 10 − RIR)', () => {
    expect(effort(i => ({ rpe: [7, 7.5, 8.5, 9, 9][i] }))).toBe(true)         // RPE up → harder
    expect(effort(i => ({ rir: [3, 3, 2, 1, 1][i] }))).toBe(true)             // RIR down → harder
    expect(effort(i => ({ rpe: [9, 9, 8.5, 7.5, 7][i] }))).toBe(false)       // RPE down → easier
    expect(effort(i => ({ rir: [1, 1, 2, 3, 3][i] }))).toBe(false)            // RIR up → easier
  })
  it('sets logged with RIR in some sessions and RPE in others are compared on the same scale', () => {
    expect(effort(i => (i < 2 ? { rir: 3 } : { rpe: 9 }))).toBe(true)          // RIR 3 = RPE 7 → RPE 9
    expect(effort(i => (i < 2 ? { rir: 1 } : { rpe: 7 }))).toBe(false)         // RIR 1 = RPE 9 → RPE 7
    expect(effort(i => (i < 2 ? { rpe: 8 } : { rir: 2 }))).toBe(false)         // RPE 8 = RIR 2: same effort
  })
})

describe('manual cycle dates (staff)', () => {
  const S0 = () => state(sessions(FIRST, PROGRESSING))
  it('without manual values the automatic rules are unchanged', () => {
    const r = routineReviews(S0(), addDays(FIRST, 28))[0]
    expect(r).toMatchObject({ start: FIRST, startManual: false, dueManual: false, dueDate: addDays(FIRST, 28), status: 'due' })
  })
  it('a manual start date prevails over the first workout (and its weeks follow it)', () => {
    const S = S0()
    expect(setCycleDates(S, 'r1', { start: '2026-09-10' }, 'staff1')).toBe(true)
    expect(cycleStart(S, ROUTINE)).toMatchObject({ start: '2026-09-10', source: 'manual' })
    const r = routineReviews(S, '2026-09-30')[0]
    expect(r).toMatchObject({ startManual: true, start: '2026-09-10', week: 3 })
    expect(r.status).not.toBe('due')
    expect(routineReviews(S, '2026-10-08')[0]).toMatchObject({ week: 5 })
    expect(S.routineReviews.r1.manualBy).toBe('staff1')
  })
  it('a manual review date prevails over week 5 and over the plateau rule, in both directions', () => {
    const S = S0()
    expect(setCycleDates(S, 'r1', { due: addDays(FIRST, 60) }, 's')).toBe(true)
    expect(routineReviews(S, addDays(FIRST, 35))[0]).toMatchObject({ status: 'ok', dueManual: true, dueDate: addDays(FIRST, 60), early: false })   // week 6 but not due yet
    expect(pendingReviews(S, addDays(FIRST, 35))).toEqual([])
    expect(routineReviews(S, addDays(FIRST, 55))[0].status).toBe('soon')
    const due = routineReviews(S, addDays(FIRST, 60))[0]
    expect(due).toMatchObject({ status: 'due', dueManual: true })
    expect(due.reasons[0]).toEqual({ code: 'date', due: addDays(FIRST, 60) })
    // a plateau cannot bring a manual date forward; an earlier manual date makes it due before week 5
    const S2 = state(sessions(FIRST, FLAT)); setCycleDates(S2, 'r1', { due: addDays(FIRST, 40) }, 's')
    expect(routineReviews(S2, addDays(FIRST, 21))[0]).toMatchObject({ status: 'ok', early: false })
    const S3 = S0(); setCycleDates(S3, 'r1', { due: addDays(FIRST, 10) }, 's')
    expect(routineReviews(S3, addDays(FIRST, 10))[0].status).toBe('due')
  })
  it('clearing a manual value returns to the automatic calculation', () => {
    const S = S0()
    setCycleDates(S, 'r1', { start: '2026-09-10', due: '2026-10-30' }, 's')
    expect(setCycleDates(S, 'r1', { start: null }, 's')).toBe(true)
    expect(cycleStart(S, ROUTINE)).toMatchObject({ start: FIRST, source: 'first' })
    expect(routineReviews(S, addDays(FIRST, 50))[0].dueManual).toBe(true)
    expect(setCycleDates(S, 'r1', { due: '' }, 's')).toBe(true)
    expect(S.routineReviews).toBeUndefined()                                   // nothing left over: back to a clean automatic state
    expect(routineReviews(S, addDays(FIRST, 28))[0]).toMatchObject({ status: 'due', dueManual: false, startManual: false })
  })
  it('"Routine reviewed" restarts coherently: it clears the manual dates of the closed cycle', () => {
    const S = S0()
    setCycleDates(S, 'r1', { start: '2026-09-02', due: '2026-10-01' }, 's')
    expect(pendingReviews(S, '2026-10-01')).toHaveLength(1)
    markReviewed(S, 'r1', '2026-10-01', 'staff1')
    expect(S.routineReviews.r1).toEqual({ reviewedAt: '2026-10-01', by: 'staff1', n: 1 })
    expect(pendingReviews(S, '2026-10-01')).toEqual([])
    expect(routineReviews(S, '2026-10-01')[0]).toMatchObject({ source: 'reviewed', startManual: false, dueManual: false, week: 1 })
    // staff may then set a new manual date for the new cycle, and the review mark is kept
    expect(setCycleDates(S, 'r1', { due: '2026-11-15' }, 's')).toBe(true)
    expect(S.routineReviews.r1).toMatchObject({ reviewedAt: '2026-10-01', dueOverride: '2026-11-15' })
  })
  it('rejects invalid input and never touches the routine', () => {
    const S = S0(); const before = JSON.stringify(S.routines)
    for (const bad of [{ start: 'nope' }, { due: '2026-02-31' }, { start: '1999-01-01' }, { due: 20261001 }]) expect(setCycleDates(S, 'r1', bad, 's')).toBe(false)
    expect(setCycleDates(S, 'zzz', { start: '2026-09-10' }, 's')).toBe(false)
    expect(setCycleDates(S, 'r1', { start: '2026-09-20', due: '2026-09-10' }, 's')).toBe(false)   // review before start
    expect(S.routineReviews).toBeUndefined()
    expect(JSON.stringify(S.routines)).toBe(before)
  })
  it('a stored manual date that makes no sense (review before start) is ignored; entries without the new fields behave as before', () => {
    const S = S0(); S.routineReviews = { r1: { reviewedAt: '2026-09-20', by: 'x', n: 1, dueOverride: '2026-09-01' } }
    expect(routineReviews(S, '2026-10-01')[0]).toMatchObject({ dueManual: false, start: '2026-09-20' })
  })
})
