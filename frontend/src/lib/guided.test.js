import { describe, expect, it } from 'vitest'
import { guidedBlocksOf, guidedBlockFor, entriesOf, buildSteps, firstStep, startRun, advance, pause, resume, adjustTime, catchUp, summarize, timingLine } from './guided.js'

/* Guided blocks (Constructor V2.1) — the pure executor: steps, pace, pause, skip, catch-up after
 * a locked screen, and the history summary. The session is a plain S.active. */
const timed = (id, sets, sec, blk) => ({ id, target: { id, sets, mode: 'time', sec, blk }, sets: Array.from({ length: sets }, () => ({ sec, w: 0, done: false })) })
const reps = (id, sets, r, blk) => ({ id, target: { id, sets, mode: 'reps', reps: r, blk }, sets: Array.from({ length: sets }, () => ({ w: 20, r, done: false })) })
const plain = id => ({ id, target: { id, sets: 3, reps: 10, mode: 'reps' }, sets: [1, 2, 3].map(() => ({ w: 60, r: 10, done: false })) })

const circuit = { iid: 'kc', name: 'Core', type: 'circuit', timing: { prep: 10, work: 30, rest: 15, rounds: 2, roundRest: 60 } }
const tabata = { iid: 'kt', name: null, type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 8, roundRest: 0 } }
const mobility = { iid: 'km', name: 'Flow', type: 'mobility', timing: { prep: 5, work: 40, rest: 5, rounds: 1, roundRest: 0 } }
const session = () => ({
  id: 'w1', entries: [plain('0025'), timed('2135', 2, 30, 'kc'), reps('0175', 2, 15, 'kc'), timed('2138', 8, 20, 'kt'), timed('1604', 1, 40, 'km'), timed('1365', 1, 40, 'km')],
  guidedBlocks: [circuit, tabata, mobility],
})

describe('which blocks are guided', () => {
  it('only circuit / intervals / HIIT / mobility labels are snapshotted, timing clamped', () => {
    const r = { blocks: [{ iid: 'a', type: 'strength' }, { iid: 'b', type: 'superset' }, { iid: 'c', type: 'hiit', timing: { work: 9999, rest: -3, rounds: 50 } }] }
    const g = guidedBlocksOf(r)
    expect(g.map(b => b.iid)).toEqual(['c'])
    expect(g[0].timing).toMatchObject({ work: 600, rest: 0, rounds: 10 })
    expect(guidedBlocksOf({ ex: [] })).toEqual([])
    expect(guidedBlocksOf(null)).toEqual([])
  })
  it('a legacy workout is untouched: no labels → no guided block anywhere', () => {
    const A = { entries: [plain('0025')] }
    expect(guidedBlockFor(A, 0)).toBe(null)
    const S = session()
    expect(guidedBlockFor(S, 0)).toBe(null)
    expect(guidedBlockFor(S, 1).iid).toBe('kc')
    expect(entriesOf(S, 'km')).toEqual([4, 5])
  })
})

describe('steps', () => {
  it('circuit: countdown, work → rest → next, a longer rest between rounds, nothing after the last bout', () => {
    const steps = buildSteps(session(), circuit)
    expect(steps.map(s => s.k + (s.sec ?? ''))).toEqual(['prep10', 'work30', 'rest15', 'work', 'roundRest60', 'work30', 'rest15', 'work'])
    expect(steps.filter(s => s.k === 'work').map(s => [s.e, s.s, s.round])).toEqual([[1, 0, 1], [2, 0, 1], [1, 1, 2], [2, 1, 2]])
    expect(steps[3].sec).toBe(null)   // reps bout: no clock, the member taps Done
  })
  it('Tabata: 20/10 × 8, the normal rest between rounds when roundRest is 0 → 8 bouts, 7 rests', () => {
    const steps = buildSteps(session(), tabata)
    expect(steps.filter(s => s.k === 'work')).toHaveLength(8)
    expect(steps.filter(s => s.k !== 'work' && s.k !== 'prep').every(s => s.sec === 10)).toBe(true)
    expect(steps.filter(s => s.k !== 'work' && s.k !== 'prep')).toHaveLength(7)
    expect(steps.reduce((a, s) => a + (s.sec || 0), 0)).toBe(10 + 8 * 20 + 7 * 10)
  })
  it('mobility: exercise → time → next, with the optional short rest', () => {
    expect(buildSteps(session(), mobility).map(s => s.k + s.sec)).toEqual(['prep5', 'work40', 'rest5', 'work40'])
    const noRest = { ...mobility, timing: { ...mobility.timing, rest: 0 } }
    expect(buildSteps(session(), noRest).map(s => s.k)).toEqual(['prep', 'work', 'work'])
  })
  it('a restarted block resumes at its first unfinished bout', () => {
    const S = session()
    S.entries[1].sets[0].done = true
    const steps = buildSteps(S, circuit)
    expect(steps[firstStep(S, steps)]).toMatchObject({ k: 'work', e: 2, s: 0 })
    for (const e of [1, 2]) S.entries[e].sets.forEach(x => { x.done = true })
    expect(startRun(S, circuit)).toBe(null)
  })
})

describe('the run', () => {
  const T0 = 1_000_000
  it('countdown → work → rest: each timed step ends at an absolute time; a bout that ends is logged', () => {
    const S = session()
    const steps = buildSteps(S, tabata)
    let run = startRun(S, tabata, { sound: false, vibrate: true }, T0)
    expect(run).toMatchObject({ i: 0, endsAt: T0 + 10_000, sound: false, vibrate: true })
    let out = advance(run, steps, { now: T0 + 10_000 })
    expect(out.marks).toEqual([])
    run = out.run
    expect(steps[run.i].k).toBe('work')
    out = advance(run, steps, { now: T0 + 30_000 })
    expect(out.marks).toEqual([{ e: 3, s: 0, sec: 20 }])
    expect(steps[out.run.i].k).toBe('rest')
    expect(out.run.endsAt).toBe(T0 + 40_000)
  })
  it('pause / resume keeps the seconds left; ±10 s adjusts and is recorded', () => {
    let run = startRun(session(), tabata, {}, T0)
    run = pause(run, T0 + 4_200)
    expect(run).toMatchObject({ paused: true, left: 6, endsAt: null })
    run = adjustTime(run, 10)
    expect(run.left).toBe(16)
    run = resume(run, T0 + 60_000)
    expect(run).toMatchObject({ paused: false, endsAt: T0 + 76_000, adjust: 10 })
    run = adjustTime(run, -100, T0 + 60_000)
    expect(run.endsAt).toBe(T0 + 61_000)   // never below one second left
    expect(run.adjust).toBe(-90)
  })
  it('skip: a skipped bout stays unchecked and counts as skipped; the last step finishes the block', () => {
    const S = session()
    const steps = buildSteps(S, mobility)
    let run = { ...startRun(S, mobility, {}, T0), i: 1 }
    let out = advance(run, steps, { done: false, now: T0 })
    expect(out.marks).toEqual([])
    expect(out.run.skipped).toBe(1)
    out = advance({ ...out.run, i: steps.length - 1 }, steps, { now: T0 })
    expect(out.finished).toBe(true)
  })
  it('reload / locked screen: every timed step that ran out is completed in order, timed from when it really ended', () => {
    const S = session()
    const steps = buildSteps(S, tabata)
    const run = startRun(S, tabata, {}, T0)
    // 10 s prep + 20 work + 10 rest + 20 work + 3 s into the next rest
    const out = catchUp(run, steps, T0 + 63_000)
    expect(out.marks.map(m => m.s)).toEqual([0, 1])
    expect(steps[out.run.i].k).toBe('rest')
    expect(out.run.endsAt).toBe(T0 + 70_000)
    expect(out.run.bg).toBe(2)
    // far past the end: the whole block completes
    const all = catchUp(run, steps, T0 + 10 * 60_000)
    expect(all.finished).toBe(true)
    expect(all.marks).toHaveLength(8)
  })
  it('catch-up stops at a reps bout (it needs the member) and never runs while paused', () => {
    const S = session()
    const steps = buildSteps(S, circuit)
    const run = startRun(S, circuit, {}, T0)
    const out = catchUp(run, steps, T0 + 10 * 60_000)
    expect(steps[out.run.i]).toMatchObject({ k: 'work', e: 2, sec: null })
    expect(out.marks).toEqual([{ e: 1, s: 0, sec: 30 }])
    expect(catchUp(pause(run, T0), steps, T0 + 60_000).marks).toEqual([])
  })
})

describe('history summary', () => {
  it('keeps the block, its pace, rounds and bouts done and what changed — no per-second data', () => {
    const S = session()
    const steps = buildSteps(S, circuit)
    S.entries[1].sets[0].done = true
    S.entries[2].sets[0].done = true
    S.entries[1].sets[1].done = true
    const g = summarize(S, circuit, { startedAt: 0, adjust: 10, skipped: 1, bg: 2 }, steps, 185_000)
    expect(g).toMatchObject({ iid: 'kc', type: 'circuit', roundsPlanned: 2, roundsDone: 1, bouts: 3, boutsPlanned: 4, sec: 185, adjust: 10, skipped: 1, background: 2, completed: false,
      timing: { work: 30, rest: 15, rounds: 2, roundRest: 60 } })
    expect(g.exercises).toEqual([{ id: '2135', done: 2, planned: 2 }, { id: '0175', done: 1, planned: 2 }])
    expect(JSON.stringify(g).length).toBeLessThan(600)
    expect(summarize(S, tabata, null, buildSteps(S, tabata)).preset).toBe('tabata')
  })
  it('reads the timing back in words', () => {
    expect(timingLine({ work: 40, rest: 20, rounds: 3, roundRest: 90 })).toBe('40 s work · 20 s rest · 3 rounds · 90 s between rounds')
    expect(timingLine({ work: 40, rest: 0, rounds: 1, roundRest: 0 })).toBe('40 s work · no rest')
  })
})
