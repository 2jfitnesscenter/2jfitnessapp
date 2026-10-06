import { describe, expect, it } from 'vitest'
import { nextPrescription, sessionsFor, withDeload, buildRoutineEntries } from './progression.js'
import { effortSignal, setEffort } from './autoreg.js'
import { fatigueState, readiness, deloadProposal, applyDeload, keepPlan, cancelDeload, activeDeload, DELOAD_VOLUME_CUT } from './fatigue.js'

/* Autoregulation over progression, readiness, accumulated fatigue and the proposed (never automatic) deload. */
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const TODAY = '2026-10-20'
const BENCH = '0025'                                            // a barbell lift → 2.5 kg step
const cfg = { id: BENCH, sets: 3, reps: 8, w: 60, prog: 'linear' }
const routine = { id: 'r1', name: 'Push', ex: [cfg], prog: 'linear' }
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const entry = (w, extra, n = 3, id = BENCH) => ({ id, target: { id, sets: n, reps: 8 }, sets: Array.from({ length: n }, () => set(w, 8, extra)) })
// one finished workout per entry list, 3 days apart ending `daysAgo` before TODAY
const wk = (i, total, entries, extra = {}) => ({ id: 'w' + i, d: addDays(TODAY, -(total - i) * 3), routineId: 'r1', entries, ...extra })
// a set is 'supported' for a load increase by the existing policy only with some positive evidence (feel good / effort ≤ 8): baseline feel 'good' unless overridden
const history = (effortList, w = 60) => effortList.map((e, i, a) => wk(i, a.length, [entry(w, { feel: 'good', ...e })]))
const S = (workouts, over = {}) => ({ unit: 'kg', routines: [routine], workouts, ...over })
const next = (w, over) => nextPrescription(S(w, over), cfg, routine)
const BASE = next(history([{}, {}, {}])).weight      // the normal next load for a 60 kg lift (a barbell steps in whole plate pairs)

describe('RPE / RIR in progression', () => {
  it('RPE is read as harder when higher, RIR as harder when lower (one scale)', () => {
    expect(setEffort({ rpe: 9 })).toBe(9); expect(setEffort({ rir: 1 })).toBe(9); expect(setEffort({ rir: 4 })).toBe(6); expect(setEffort({ w: 1 })).toBeNull()
  })
  it('repeated clearly-easy completed sessions (RIR ≥ 3) → a bigger step than the normal one, with a reason', () => {
    const plain = next(history([{}, {}, {}], 100))
    const easy = next(history([{ rir: 4 }, { rir: 3 }, { rir: 4 }], 100))
    expect(plain.kind).toBe('up'); expect(plain.auto).toBeUndefined()
    expect(easy.kind).toBe('up'); expect(easy.auto).toBe('faster'); expect(easy.weight).toBeGreaterThan(plain.weight); expect(easy.weight).toBeLessThanOrEqual(115)
    // a light load: one more real step would be a jump of more than 15 % — it stays on the planned step
    expect(next(history([{ rir: 4 }, { rir: 4 }, { rir: 4 }], 40)).auto).toBeUndefined()
    expect(easy.why[0]).toMatch(/clearly easy/)
  })
  it('completed twice but at RIR 0–1 / RPE ≥ 9 → hold the load instead of adding', () => {
    for (const grind of [{ rir: 0 }, { rir: 1 }, { rpe: 9.5 }, { rpe: 10 }]) {
      const p = next(history([{}, grind, grind]))
      expect(p.kind).toBe('hold'); expect(p.weight).toBe(60); expect(p.auto).toBe('slower'); expect(p.why[0]).toMatch(/RPE/)
    }
  })
  it('never decided by one session or one set', () => {
    expect(next(history([{}, {}, { rir: 0 }])).auto).toBeUndefined()                                         // one grind session: autoregulation stays out (the base safety rule is unchanged)
    expect(next(history([{}, {}, { rir: 5 }]))).toMatchObject({ kind: 'up', weight: BASE })                    // one easy session: normal progression
    expect(next(history([{}, {}, { rir: 5 }])).auto).toBeUndefined()
    expect(next(history([{ rir: 4 }, { rir: 0 }, { rir: 4 }])).auto).toBeUndefined()                           // mixed: nothing
    const oneSet = [{}, {}, { }].map((_, i, a) => wk(i, a.length, [{ id: BENCH, target: { id: BENCH, sets: 3, reps: 8 }, sets: [set(60, 8, { rir: 5, feel: 'good' }), set(60, 8, { feel: 'good' }), set(60, 8, { feel: 'good' })] }]))
    expect(next(oneSet)).toMatchObject({ kind: 'up', weight: BASE })                                            // one rated set per session is not enough
  })
  it('RPE and RIR logged in different sessions are normalised before comparing', () => {
    expect(next(history([{ rir: 3 }, { rpe: 7 }, { rir: 4 }], 100)).auto).toBe('faster')     // RIR 3 = RPE 7
    expect(next(history([{}, { rpe: 9 }, { rir: 1 }])).auto).toBe('slower')             // RPE 9 = RIR 1
    expect(next(history([{ rir: 2 }, { rpe: 8 }, { rir: 2 }])).auto).toBeUndefined()    // RPE 8 = RIR 2: neither easy nor grinding
  })
  it('incomplete sessions never count as easy; old history without any effort is untouched; it can be switched off', () => {
    const missed = history([{ rir: 4 }, { rir: 4 }, { rir: 4 }]).map(w => ({ ...w, entries: [{ ...w.entries[0], sets: w.entries[0].sets.map((s, i) => (i === 2 ? { ...s, r: 5 } : s)) }] }))
    expect(next(missed).auto).toBeUndefined()
    expect(next(history([{}, {}, {}]))).toMatchObject({ kind: 'up', weight: BASE })
    const easy100 = history([{ rir: 4 }, { rir: 4 }, { rir: 4 }], 100)
    expect(next(easy100).auto).toBe('faster')
    const off = next(easy100, { autoreg: false }); expect(off.auto).toBeUndefined(); expect(off.weight).toBeLessThan(next(easy100).weight)
    expect(effortSignal([])).toEqual({ kind: null, effort: null })
  })
  it('only linear / double that were going up are touched: off, time, bodyweight and the base policy stay as they were', () => {
    const w = history([{ rir: 4 }, { rir: 4 }, { rir: 4 }])
    expect(nextPrescription(S(w), { ...cfg, prog: 'off' }, { ...routine, prog: 'off' }).kind).toBe('off')
    expect(nextPrescription(S(history([{ rir: 4 }, { rir: 4 }, { rir: 4 }], 0)), { ...cfg, w: 0 }, routine).auto).toBeUndefined()
  })
})

describe('accumulated fatigue is a trend, not a bad day', () => {
  const ex = [{ id: 'A' }, { id: 'B' }]
  const sess = (rows, extra = () => ({})) => rows.map((row, i) => ({ id: 'f' + i, d: addDays(TODAY, -(rows.length - i) * 3), routineId: 'r1', entries: ex.map(e => ({ id: e.id, target: { id: e.id, sets: 2, reps: 8 },
    sets: [set(row, 8, extra(i, e.id)), set(row, 8, extra(i, e.id))] })) }))
  const flat = n => Array.from({ length: n }, () => 60)
  const rising = (i, n = 6) => ({ rpe: 7 + (i / (n - 1)) * 2.5 })                         // 7 → 9.5 at the same load
  const SF = (workouts, over = {}) => ({ workouts, ...over })

  it('one very bad session is not elevated, let alone high', () => {
    const rows = flat(6)
    const w = sess(rows, i => (i === 5 ? { rpe: 10, feel: 'fail' } : { rpe: 7, feel: 'good' }))
    const f = fatigueState(SF(w), TODAY)
    expect(f.level).toBe('normal')
    expect(readiness(SF(w), TODAY).state).not.toBe('recover')
  })
  it('a combination of signals is high: effort rising + hard sessions + repeated misses', () => {
    const w = sess(flat(6), (i, id) => ({ ...rising(i), feel: i >= 3 ? 'hard' : 'good', ...(i >= 4 && id === 'A' ? { feel: 'fail' } : {}) }))
    const f = fatigueState(SF(w), TODAY)
    expect(f.level).toBe('high'); expect(f.families.length).toBeGreaterThanOrEqual(2)
    expect(f.signals.map(s => s.code)).toEqual(expect.arrayContaining(['effort_up', 'hard']))
  })
  it('a single family of signals is elevated at most; weak signals stay normal', () => {
    const onlyEffort = sess(flat(6), i => rising(i))
    expect(fatigueState(SF(onlyEffort), TODAY).level).toBe('elevated')
    expect(fatigueState(SF(sess(flat(6), () => ({ rpe: 8 }))), TODAY).level).toBe('normal')
  })
  it('sleep (when it exists) raises the signal; without a wearable the log alone still works', () => {
    const w = sess(flat(6), i => rising(i))
    const nights = h => Array.from({ length: 5 }, (_, i) => ({ d: addDays(TODAY, -i), v: h * 60 }))
    const hardW = sess(flat(6), i => ({ ...rising(i), feel: i >= 3 ? 'hard' : 'good' }))
    const base = fatigueState(SF(hardW), TODAY)
    const slept = fatigueState(SF(hardW, { sleep: nights(5.5) }), TODAY)
    expect(base.level).toBe('elevated'); expect(slept.level).toBe('high'); expect(slept.signals.some(s => s.code === 'sleep')).toBe(true)
    expect(fatigueState(SF(hardW, { sleep: nights(8) }), TODAY).signals.some(s => s.code === 'sleep')).toBe(false)
    expect(fatigueState(SF(hardW, { sleep: nights(5.5).slice(0, 2) }), TODAY).signals.some(s => s.code === 'sleep')).toBe(false)   // fewer than 3 nights: not a trend
    expect(readiness(SF(w), TODAY)).not.toBeNull()
  })
  it('check-ins, muscle recovery and volume only count when they are supplied/allowed', () => {
    const w = sess(flat(6), i => rising(i))
    const ci = Array.from({ length: 3 }, (_, i) => ({ d: addDays(TODAY, -i), fatigue: 5 }))
    expect(fatigueState(SF(w, { checkins: ci }), TODAY).signals.some(s => s.code === 'checkins')).toBe(true)
    expect(fatigueState(SF(w, { checkins: ci }), TODAY, { checkins: false }).signals.some(s => s.code === 'checkins')).toBe(false)
    expect(fatigueState(SF(w), TODAY, { recovery: 30, volume: { over: 1, high: 0 } }).level).toBe('high')
    expect(fatigueState(SF(w), TODAY).level).toBe('elevated')
  })
  it('old data without effort, entries or dates never breaks anything', () => {
    for (const st of [{}, { workouts: [] }, { workouts: [{}, null, { d: TODAY }, { d: TODAY, entries: [null, {}, { id: 'A' }, { id: 'A', sets: [null] }] }] }, { sleep: [null, { d: 'x' }] }]) {
      expect(() => fatigueState(st, TODAY)).not.toThrow(); expect(() => readiness(st, TODAY)).not.toThrow(); expect(() => deloadProposal(st, TODAY)).not.toThrow()
      expect(fatigueState(st, TODAY).level).toBe('normal'); expect(readiness(st, TODAY)).toBeNull(); expect(deloadProposal(st, TODAY)).toBeNull()
    }
  })
})

describe('readiness (4 states, real reasons only)', () => {
  const ex = [{ id: 'A' }]
  const sess = extra => [0, 1, 2].map(i => ({ id: 'r' + i, d: addDays(TODAY, -(3 - i) * 2), entries: ex.map(e => ({ id: e.id, target: { id: e.id, sets: 2, reps: 8 }, sets: [set(60, 8, extra), set(60, 8, extra)] })) }))
  const nights = h => Array.from({ length: 5 }, (_, i) => ({ d: addDays(TODAY, -i), v: h * 60 }))
  it('push with good sleep, good recovery and repeated easy sessions; reasons are the real ones', () => {
    const r = readiness({ workouts: sess({ rir: 4 }), sleep: nights(8) }, TODAY, { recovery: 90 })
    expect(r.state).toBe('push'); expect(r.score).toBeGreaterThanOrEqual(80)
    expect(r.reasons.map(x => x.code)).toEqual(expect.arrayContaining(['sleep_good', 'recovery_good', 'headroom']))
    expect(r.reasons.length).toBeLessThanOrEqual(3)
  })
  it('maintain on an ordinary day; adjust on poor sleep + low recovery; recover on high fatigue', () => {
    expect(readiness({ workouts: sess({ rpe: 8 }) }, TODAY).state).toBe('maintain')
    expect(readiness({ workouts: sess({ rpe: 8 }), sleep: nights(5.5) }, TODAY, { recovery: 45 }).state).toBe('adjust')
    const rows = [60, 60, 60, 60, 60, 60].map((w, i) => ({ id: 'h' + i, d: addDays(TODAY, -(6 - i) * 3), entries: ['A', 'B'].map(id => ({ id, target: { id, sets: 2, reps: 8 }, sets: [set(w, 8, { rpe: 7 + i / 2, feel: i >= 4 ? 'fail' : i >= 3 ? 'hard' : 'good' }), set(w, 8, { rpe: 7 + i / 2, feel: i >= 4 ? 'fail' : i >= 3 ? 'hard' : 'good' })] })) }))
    const r = readiness({ workouts: rows }, TODAY)
    expect(r.state).toBe('recover'); expect(r.level).toBe('high')
    expect(r.reasons[0].code).toBe('signal')
  })
  it('nothing real to say → null (no invented card); works without a wearable', () => {
    expect(readiness({ workouts: [] }, TODAY)).toBeNull()
    expect(readiness({ workouts: sess({}) }, TODAY)).toBeNull()                      // sessions without any logged effort and no other source
    expect(readiness({ workouts: sess({ rpe: 8 }) }, TODAY)).not.toBeNull()
    expect(readiness({ workouts: [], sleep: nights(7) }, TODAY)).not.toBeNull()      // sleep alone is enough to say something
  })
})

describe('proposed deload: never applied by itself, reversible, base plan preserved', () => {
  const highState = () => {   // (exWeights etc. are what the session builder reads)
    const rows = [60, 60, 60, 60, 60, 60].map((w, i) => ({ id: 'h' + i, d: addDays(TODAY, -(6 - i) * 3), routineId: 'r1', entries: [BENCH, '0032'].map(id => ({ id, target: { id, sets: 3, reps: 8 },
      sets: [0, 1, 2].map(() => set(w, 8, { rpe: 7 + i / 2, feel: i >= 3 ? (i >= 4 ? 'fail' : 'hard') : 'good' })) })) }))
    return { unit: 'kg', routines: [{ id: 'r1', name: 'Push', prog: 'linear', ex: [{ id: BENCH, sets: 4, reps: 8, w: 60 }, { id: '0032', sets: 3, reps: 8, w: 60 }] }], workouts: rows, exWeights: {}, customEx: [], week: {} }
  }
  it('a proposal appears only when fatigue is high, and creating it changes nothing', () => {
    const st = highState(); const before = JSON.stringify(st)
    const p = deloadProposal(st, TODAY)
    expect(p).toMatchObject({ days: 7, volumeCut: DELOAD_VOLUME_CUT, loadCut: 0.075, rir: 3, from: TODAY, until: addDays(TODAY, 7) })
    expect(JSON.stringify(st)).toBe(before); expect(st.deload).toBeUndefined()
    expect(deloadProposal({ workouts: [] }, TODAY)).toBeNull()
  })
  it('accepting stores a one-week adjustment and leaves routines and history untouched', () => {
    const st = highState(); const routinesBefore = JSON.stringify(st.routines); const workoutsBefore = JSON.stringify(st.workouts)
    expect(applyDeload(st, TODAY, deloadProposal(st, TODAY))).toBe(true)
    expect(st.deload).toMatchObject({ from: TODAY, until: addDays(TODAY, 7), volumeCut: 0.35, rir: 3, by: 'member' })
    expect(JSON.stringify(st.routines)).toBe(routinesBefore); expect(JSON.stringify(st.workouts)).toBe(workoutsBefore)
    expect(activeDeload(st, TODAY)).not.toBeNull(); expect(activeDeload(st, addDays(TODAY, 6))).not.toBeNull(); expect(activeDeload(st, addDays(TODAY, 7))).toBeNull()
    expect(deloadProposal(st, addDays(TODAY, 3))).toBeNull()                           // nothing new while one runs
    expect(deloadProposal(st, addDays(TODAY, 8))).toBeNull()                           // nor right after it ended
  })
  it('the session builder applies it on top: ~35 % fewer sets, lighter, RIR 3 target, flagged — the base routine is unchanged and it ends by itself', () => {
    const st = highState(); applyDeload(st, TODAY, deloadProposal(st, TODAY))
    const base = buildRoutineEntries({ ...st, deload: undefined }, st.routines[0])
    const during = base.map(e => withDeload(st, e, TODAY))
    const work = e => e.sets.filter(s => s.type !== 'warmup' && s.type !== 'drop')
    expect(work(during[0]).length).toBe(Math.round(work(base[0]).length * (1 - 0.35)))      // 4 → 3
    expect(work(during[1]).length).toBe(Math.round(work(base[1]).length * (1 - 0.35)))      // 3 → 2
    for (let i = 0; i < during.length; i++) {
      work(during[i]).forEach((s, j) => expect(s.w).toBeLessThan(work(base[i])[j].w))
      expect(during[i].target.deload).toBeTruthy(); expect(during[i].target.targetRIR).toBe(3); expect(during[i].plan.deload).toBe(true)
    }
    expect(JSON.stringify(st.routines[0].ex)).toBe(JSON.stringify(highState().routines[0].ex))
    expect(withDeload(st, base[0], addDays(TODAY, 7))).toBe(base[0])                       // after the week: the normal plan, untouched
    expect(withDeload({ ...st, deload: undefined }, base[0], TODAY)).toBe(base[0])
  })
  it('deload-week sessions never feed progression (the plan resumes from the last normal session)', () => {
    const st = highState(); const normal = sessionsFor(st, BENCH, cfg).length
    st.workouts.push({ id: 'dl', d: addDays(TODAY, 1), entries: [{ id: BENCH, target: { id: BENCH, sets: 3, reps: 8, deload: { rir: 3 } }, sets: [set(55, 8)] }] })
    expect(sessionsFor(st, BENCH, cfg).length).toBe(normal)
    expect(fatigueState(st, addDays(TODAY, 2)).sessions).toBe(fatigueState({ ...st, workouts: st.workouts.slice(0, -1) }, addDays(TODAY, 2)).sessions)
  })
  it('"Keep my plan" and "back to normal" are reversible choices that quiet new proposals for two weeks', () => {
    const a = highState(); expect(keepPlan(a, TODAY)).toBe(true)
    expect(deloadProposal(a, addDays(TODAY, 5))).toBeNull(); expect(deloadProposal(a, addDays(TODAY, 14))).not.toBeNull()
    const b = highState(); applyDeload(b, TODAY, deloadProposal(b, TODAY)); expect(cancelDeload(b, addDays(TODAY, 2))).toBe(true)
    expect(b.deload).toBeUndefined(); expect(activeDeload(b, addDays(TODAY, 3))).toBeNull(); expect(deloadProposal(b, addDays(TODAY, 3))).toBeNull()
  })
})
