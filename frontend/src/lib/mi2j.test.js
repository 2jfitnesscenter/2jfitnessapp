import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextRankOf, rankProgress, rankChange, rankSnapshot, personalRecords, postWorkoutEvents, heroEvent, latestAdvance, closestGoal, weekSummary, unlockedBadges } from './mi2j.js'
import { markPending, pendingCelebration, markSeen, isSeen } from './celebrations.js'
import { rankOfLift, TIERS } from './rank.js'
import { estimate1RM } from './onerm.js'

// Bench press (0025) is a curated rank lift and the only chest one logged here, so the chest
// group rank equals the bench rank: easy to reason about. Bodyweight 80 kg, male standards.
const BENCH = '0025', CURL = '0294'
const bw = [{ d: '2026-09-01', w: 80, t: 1 }]
const wk = (id, d, exId, sets, prs = []) => ({ id, d, start: 1, end: 2, name: 'W', prs,
  entries: [{ id: exId, target: { sets: sets.length, reps: 5, mode: 'reps' }, sets: sets.map(([w, r]) => ({ w, r, done: true })) }] })
const S0 = (workouts, over = {}) => ({ unit: 'kg', body: 'male', bodyweight: bw, tests: [], badges: {}, routines: [], week: {}, dayPlan: {}, workouts, ...over })
const benchRank = (w, r) => rankOfLift(BENCH, estimate1RM(w, r) / 80, 'male')

afterEach(() => { vi.useRealTimers() })

describe('ranks read the existing system', () => {
  it('knows the next division, the next family and the top', () => {
    const emeraldIII = { tier: 'Emerald', division: 'III', levelIndex: 17, continuous: 17.4 }
    expect(nextRankOf(emeraldIII)).toMatchObject({ tier: 'Diamond', division: 'I' })
    expect(nextRankOf({ tier: 'Ruby', division: 'I', levelIndex: 12, continuous: 12.2 })).toMatchObject({ tier: 'Ruby', division: 'II' })
    expect(nextRankOf({ tier: 'Symmetric', division: null, levelIndex: 24, continuous: 24 })).toBeNull()
    expect(rankProgress(emeraldIII)).toBeCloseTo(0.4)
    expect(rankChange(null, emeraldIII)).toBe('new')
    expect(rankChange({ tier: 'Emerald', division: 'II', levelIndex: 16 }, emeraldIII)).toBe('division')
    expect(rankChange(emeraldIII, { tier: 'Diamond', division: 'I', levelIndex: 18 })).toBe('tier')
    expect(rankChange(emeraldIII, emeraldIII)).toBeNull()
  })
  it('a snapshot: no bodyweight → nothing ranked; one lift → its group ranked, global locked with what is missing', () => {
    expect(rankSnapshot(S0([wk('a', '2026-09-02', BENCH, [[80, 5]])], { bodyweight: [] }))).toMatchObject({ hasBW: false, rankedCount: 0 })
    const S = S0([wk('a', '2026-09-02', BENCH, [[80, 5]])])
    const before = JSON.stringify(S)
    const snap = rankSnapshot(S)
    expect(snap.global).toMatchObject({ locked: true, rankedCount: 1, needed: 6 })
    const chest = snap.groups.find(g => g.key === 'chest')
    expect(chest.rank).toMatchObject({ tier: benchRank(80, 5).tier, division: benchRank(80, 5).division })
    expect(chest.next).toEqual(expect.objectContaining({ levelIndex: chest.rank.levelIndex + 1 }))
    expect(chest.contributing.map(l => l.id)).toEqual([BENCH])
    expect(snap.groups.find(g => g.key === 'legs').rank).toBeNull()
    expect(JSON.stringify(S)).toBe(before)                          // derivation never mutates
  })
})

describe('records', () => {
  it('the heaviest real set, the one it replaced, and a separate estimated 1RM', () => {
    const S = S0([
      wk('a', '2026-09-02', BENCH, [[80, 5], [80, 5]]),
      wk('b', '2026-09-05', BENCH, [[85, 3]]),
      wk('c', '2026-09-08', BENCH, [[82.5, 8]]),                    // lighter, more reps: best e1RM, not a record
      wk('d', '2026-09-09', CURL, [[20, 10]]),
    ])
    const [curl, bench] = personalRecords(S)
    expect(curl.id).toBe(CURL)                                       // most recent record first
    expect(bench.best).toMatchObject({ w: 85, r: 3, d: '2026-09-05' })
    expect(bench.previous).toMatchObject({ w: 80, r: 5 })
    expect(bench.e1rm).toMatchObject({ w: 82.5, r: 8 })
    expect(bench.e1rm.est).toBeCloseTo(estimate1RM(82.5, 8))
  })
  it('cardio and timed work are not weight records', () => {
    const S = S0([{ id: 'x', d: '2026-09-02', entries: [{ id: '0685', target: { mode: 'cardio' }, sets: [{ min: 20, speed: 9, done: true }] }] }])
    expect(personalRecords(S)).toEqual([])
  })
})

describe('post-workout events', () => {
  it('none: a first-ever log of a non-rank exercise with no bodyweight', () => {
    const S = S0([wk('a', '2026-09-02', CURL, [[20, 10]], [CURL])], { bodyweight: [] })
    expect(postWorkoutEvents(S, 'a')).toEqual([])
    expect(postWorkoutEvents(S, 'missing')).toEqual([])
  })
  it('a first-ever log is a baseline, never a false PR (even though w.prs lists it)', () => {
    const S = S0([wk('a', '2026-09-02', BENCH, [[80, 5]], [BENCH])])
    const ev = postWorkoutEvents(S, 'a')
    expect(ev.some(e => e.type === 'pr')).toBe(false)
    expect(ev.find(e => e.type === 'rank')).toMatchObject({ data: { group: 'chest', change: 'new' }, major: false })
  })
  it('a real PR with its previous best, plus a division step (not a hero moment)', () => {
    const S = S0([wk('a', '2026-09-02', BENCH, [[80, 5]]), wk('b', '2026-09-05', BENCH, [[85, 5]], [BENCH])])
    expect(rankChange(benchRank(80, 5), benchRank(85, 5))).toBe('division')
    const ev = postWorkoutEvents(S, 'b')
    expect(ev[0]).toMatchObject({ id: 'b:pr:' + BENCH, type: 'pr', data: { now: { w: 85, r: 5 }, prev: { w: 80, r: 5 } } })
    expect(ev.find(e => e.type === 'rank')).toMatchObject({ data: { change: 'division' }, major: false })
    expect(ev.some(e => e.type === 'lift')).toBe(false)             // the chest group already tells it
    expect(heroEvent(ev)).toBeNull()
  })
  it('a new rank family is the hero moment', () => {
    const S = S0([wk('a', '2026-09-02', BENCH, [[80, 5]]), wk('b', '2026-09-05', BENCH, [[90, 5]], [BENCH])])
    expect(rankChange(benchRank(80, 5), benchRank(90, 5))).toBe('tier')
    const hero = heroEvent(postWorkoutEvents(S, 'b'))
    expect(hero).toMatchObject({ type: 'rank', major: true, data: { group: 'chest', change: 'tier' } })
    expect(TIERS.indexOf(hero.data.next.tier)).toBe(TIERS.indexOf(hero.data.prev.tier) + 1)
  })
  it('more reps at the same weight is an e1RM record, labelled as an estimate — not a PR', () => {
    const S = S0([wk('a', '2026-09-02', BENCH, [[80, 5]]), wk('b', '2026-09-05', BENCH, [[80, 8]])])
    const ev = postWorkoutEvents(S, 'b')
    expect(ev.some(e => e.type === 'pr')).toBe(false)
    expect(ev.find(e => e.type === 'e1rm')).toMatchObject({ data: { w: 80, r: 8 } })
  })
  it('unlocking the overall rank (6th lift ranked) is a hero moment', () => {
    const lifts = ['0025', '0043', '0032', '1457', '0027']
    const before = lifts.map((id, i) => wk('p' + i, '2026-09-0' + (i + 1), id, [[60, 5]]))
    const S = S0([...before, wk('last', '2026-09-08', '0085', [[80, 5]])])
    const ev = postWorkoutEvents(S, 'last')
    expect(ev.find(e => e.type === 'global')).toMatchObject({ major: true, data: { change: 'new' } })
  })
  it('badges come only from the ids that unlocked with the finish and are unlocked in S', () => {
    const S = S0([wk('a', '2026-09-02', CURL, [[20, 10]])], { bodyweight: [], badges: { workouts_1: { badgeId: 'workouts_1', unlockedAt: '2026-09-02T10:00:00Z', progress: 1 } } })
    expect(unlockedBadges(S).map(x => x.badge.id)).toEqual(['workouts_1'])
    // workouts_10 was named but isn't unlocked in S → no event for it
    expect(postWorkoutEvents(S, 'a', ['workouts_1', 'workouts_10'])).toEqual([
      expect.objectContaining({ id: 'a:badge:workouts_1', type: 'badge', data: expect.objectContaining({ unlockedAt: '2026-09-02T10:00:00Z' }) }),
    ])
  })
  it('several events come ordered PR → rank → badge → streak, deterministically', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00'))
    const S = S0([wk('a', '2026-09-02', BENCH, [[80, 5]]), wk('b', '2026-09-09', BENCH, [[85, 5]], [BENCH])],
      { badges: { workouts_1: { badgeId: 'workouts_1', unlockedAt: '2026-09-09T10:00:00Z', progress: 1 } } })
    const ev = postWorkoutEvents(S, 'b', ['workouts_1'])
    const types = ev.map(e => e.type)
    const order = ['pr', 'e1rm', 'global', 'rank', 'lift', 'badge', 'streak']
    expect([...types].sort((x, y) => order.indexOf(x) - order.indexOf(y))).toEqual(types)
    expect(types[0]).toBe('pr')
    expect(types).toContain('streak')
    expect(postWorkoutEvents(S, 'b', ['workouts_1'])).toEqual(ev)
  })
})

describe('home and goals', () => {
  it('week summary, latest step forward and a goal only when it is genuinely close', () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-09T12:00:00'))
    const S = S0([wk('a', '2026-09-02', BENCH, [[80, 5]]), wk('b', '2026-09-09', BENCH, [[85, 5]], [BENCH])], { week: { 1: 'r', 3: 'r', 5: 'r' } })
    expect(weekSummary(S, '2026-09-09')).toMatchObject({ done: 1, planned: 3 })
    expect(latestAdvance(S, { iso: '2026-09-09' })).toMatchObject({ type: 'pr', d: '2026-09-09' })
    expect(latestAdvance(S, { iso: '2026-10-30' })).toBeNull()                 // old news
    const goal = closestGoal(S)
    if (goal) expect(goal.type === 'rank' ? goal.group.progress : goal.progress).toBeGreaterThanOrEqual(0.5)
    expect(latestAdvance(S0([]))).toBeNull()
  })
})

describe('unseen celebrations (device-local)', () => {
  const mem = () => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), m } }
  it('pending until seen, then never again for that workout', () => {
    const st = mem()
    expect(pendingCelebration(st, 'u1')).toBeNull()
    markPending(st, 'u1', 'w1', ['b1'])
    expect(pendingCelebration(st, 'u1')).toEqual({ workoutId: 'w1', badgeIds: ['b1'] })
    expect(pendingCelebration(st, 'u2')).toBeNull()                          // per account
    markSeen(st, 'u1', 'w1')
    expect(pendingCelebration(st, 'u1')).toBeNull()
    markPending(st, 'u1', 'w1', ['b1'])                                     // a replayed write can't resurrect it
    expect(pendingCelebration(st, 'u1')).toBeNull()
    expect(isSeen(st, 'u1', 'w1')).toBe(true)
  })
  it('keeps a bounded seen list and survives corrupt or blocked storage', () => {
    const st = mem()
    for (let i = 0; i < 70; i++) markSeen(st, 'u1', 'w' + i)
    expect(isSeen(st, 'u1', 'w0')).toBe(false)
    expect(isSeen(st, 'u1', 'w69')).toBe(true)
    st.setItem('gym_mi2j_pending:u1', '{bad json')
    expect(pendingCelebration(st, 'u1')).toBeNull()
    const blocked = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') }, removeItem: () => {} }
    expect(() => markPending(blocked, 'u1', 'w1')).not.toThrow()
    expect(pendingCelebration(blocked, 'u1')).toBeNull()
  })
})
