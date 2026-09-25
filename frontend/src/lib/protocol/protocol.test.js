import { describe, expect, it } from 'vitest'
import { EXIDX } from '../exercises.js'
import { validateAgainst2JProtocol as validate, prescribe, classify, CATALOG, instantiateBlock, segmentsOf, pruneBlocks,
  filterBlocks, blockTitle, compactProtocol, estimateSeconds, roundMinutes } from './index.js'

const lookup = id => EXIDX[id] || null
const V = (entries, over = {}, ctx = {}) => validate({ kind: 'block', goal: 'hypertrophy', level: 'intermediate', entries, ...over }, { lookup, ...ctx })
const reps = (id, lo, hi, extra = {}) => ({ id, sets: 3, mode: 'reps', reps: hi, targetRepsMin: lo, targetRepsMax: hi, ...extra })
const codes = v => v.issues.map(i => i.code)
// ids from the curated catalog
const LATERAL = '0334', BENCH = '0025', SQUAT = '0043', LEGEXT = '0585', CURL = '0294', PUSHDOWN = '0201', JUMP = '0514'

describe('catalog', () => {
  it('only uses real library ids — nothing invented', () => {
    for (const id of Object.keys(CATALOG)) expect(EXIDX[id], id).toBeTruthy()
  })
})

describe('hypertrophy', () => {
  it('isolation 15 reps → PASS; 25 → allowed, with a reason; 35 → FAIL', () => {
    expect(V([reps(LATERAL, 12, 15)]).result).toBe('PASS')
    const v25 = V([reps(LATERAL, 20, 25)])
    expect(v25.result).toBe('PASS_WITH_REASON')
    expect(v25.issues[0]).toMatchObject({ code: 'reps_outside_preferred', reason: expect.any(String) })
    expect(V([reps(LATERAL, 30, 35)]).result).toBe('FAIL')
  })
  it('a typed reason is kept instead of the default', () => {
    const v = V([reps(LATERAL, 20, 25, { why: 'Rango alto seleccionado para aislamiento estable.' })])
    expect(v.issues[0]).toMatchObject({ reason: 'Rango alto seleccionado para aislamiento estable.', reasonGiven: true })
  })
  it('technical compound at 30 reps → FAIL', () => {
    expect(codes(V([reps(SQUAT, 25, 30)]))).toContain('reps_outside_allowed')
  })
  it('every set at RPE 10 → FAIL; selective 10 is fine', () => {
    const all10 = V([reps(LEGEXT, 10, 15, { rpe: [10, 10, 10] }), reps(CURL, 10, 12, { rpe: [10, 10, 10] })])
    expect(all10.result).toBe('FAIL')
    expect(codes(all10)).toContain('rpe10_all')
    expect(V([reps(LEGEXT, 10, 15, { rpe: [8, 8, 10] }), reps(CURL, 10, 12, { rpe: [8, 8, 8] })]).result).toBe('PASS')
  })
  it('only the 2J scale is accepted', () => {
    expect(codes(V([reps(LEGEXT, 10, 15, { rpe: [7, 8, 9] })]))).toContain('rpe_not_2j')
  })
  it('absurd weekly volume across a program → FAIL; high → reason', () => {
    const day = Array.from({ length: 4 }, () => reps(LEGEXT, 10, 15, { sets: 4 }))
    const prog = n => validate({ kind: 'program', goal: 'hypertrophy', level: 'intermediate', days: Array.from({ length: n }, () => day) }, { lookup })
    expect(codes(prog(2))).toContain('volume_absurd')       // 32 sets of quads
    expect(prog(1).issues.find(i => i.code === 'volume_high')).toBeTruthy()  // 16 > 14
  })
  it('near-duplicate glute work (the hip-thrust case) is caught', () => {
    const v = V([reps('1409', 8, 10), reps('3013', 12, 15), reps('2286', 12, 15), reps('0228', 12, 15)])
    expect(codes(v)).toContain('redundant_pair')
  })
})

describe('strength', () => {
  const S = (entries, over = {}) => V(entries, { goal: 'strength', ...over })
  it('main lift at 3 reps → PASS; 20 reps labelled max strength → FAIL', () => {
    expect(S([reps(SQUAT, 3, 5, { rest: 180 })]).result).toBe('PASS')
    expect(S([reps(SQUAT, 15, 20)]).result).toBe('FAIL')
  })
  it('30 s rest on a heavy main lift → FAIL', () => {
    expect(codes(S([reps(SQUAT, 3, 5, { rest: 30 })]))).toContain('rest_outside_allowed')
  })
  it('main lift buried at the end → reason', () => {
    expect(codes(S([reps(LEGEXT, 8, 12), reps('0586', 8, 12), reps(SQUAT, 3, 5, { role: 'main' })]))).toContain('order_strength')
  })
})

describe('power', () => {
  it('RPE 10 → FAIL; 10 reps → FAIL', () => {
    expect(codes(V([reps(JUMP, 3, 5, { rpe: [6, 6, 10] })], { goal: 'power' }))).toContain('rpe10_power')
    expect(codes(V([reps(JUMP, 8, 10)], { goal: 'power' }))).toContain('power_reps')
  })
})

describe('restrictions, equipment, ids', () => {
  it('explicit restrictions win', () => {
    const v = V([reps(SQUAT, 6, 10)], {}, { restrictions: ['no-deep-knee-flexion'] })
    expect(v.result).toBe('FAIL')
    expect(codes(v)).toContain('restriction')
  })
  it('unknown ids fail; unavailable equipment fails an official block, warns a routine', () => {
    expect(codes(V([reps('9999x', 8, 10)]))).toContain('unknown_exercise')
    expect(V([reps(BENCH, 6, 10)], {}, { unavailableEq: ['barbell'], official: true }).result).toBe('FAIL')
    expect(V([reps(BENCH, 6, 10)], {}, { unavailableEq: ['barbell'] }).result).toBe('PASS_WITH_REASON')
  })
})

describe('prescribe', () => {
  it('writes inside the preferred zone and passes its own validator', () => {
    for (const goal of ['hypertrophy', 'general', 'endurance', 'beginner', 'strength', 'power'])
      for (const level of ['beginner', 'intermediate', 'advanced']) {
        const ids = goal === 'power' ? [JUMP] : [SQUAT, '0739', CURL, PUSHDOWN]
        const entries = ids.map((id, i) => ({ id, ...prescribe(classify(id, lookup), { goal, level, position: i }) }))
        const v = V(entries, { goal, level })
        expect(v.result, `${goal}/${level}: ${codes(v)}`).not.toBe('FAIL')
        expect(entries.flatMap(e => e.rpe).every(r => [4, 6, 8, 10].includes(r))).toBe(true)
      }
  })
  it('never prescribes RPE 10 for power or beginners', () => {
    expect(prescribe(classify(JUMP, lookup), { goal: 'power', level: 'advanced' }).rpe).not.toContain(10)
    expect(prescribe(classify(CURL, lookup), { goal: 'hypertrophy', level: 'beginner' }).rpe).not.toContain(10)
  })
  it('durations are rounded estimates', () => {
    const ex = [reps(SQUAT, 6, 10, { rest: 150 }), reps(LEGEXT, 12, 15, { rest: 75 })]
    expect(roundMinutes(estimateSeconds(ex)) % 5).toBe(0)
  })
})

describe('blocks as snapshots', () => {
  const master = { id: 'off-x', focus: 'glutes', goal: 'hypertrophy', level: 'intermediate', variant: 'B', style: 'mixed', protocolVersion: '1.0',
    ex: [reps('1409', 6, 10, { sg: 'a' }), reps('0597', 12, 15, { sg: 'a' })] }
  it('an instance is a deep copy with its own ids; editing it never touches the master', () => {
    const one = instantiateBlock(master), two = instantiateBlock(master)
    one.ex[0].sets = 9
    expect(master.ex[0].sets).toBe(3)
    expect(one.meta.iid).not.toBe(two.meta.iid)
    expect(one.ex[0].sg).not.toBe(two.ex[0].sg)
    expect(one.ex.every(e => e.blk === one.meta.iid)).toBe(true)
    expect(one.meta).toMatchObject({ src: 'off-x', v: '1.0', name: 'Glutes · Hypertrophy · Intermediate B' })
  })
  it('routines keep working with and without blocks', () => {
    const inst = instantiateBlock(master)
    const r = { ex: [reps(BENCH, 6, 10), ...inst.ex], blocks: [inst.meta, { iid: 'gone' }] }
    expect(segmentsOf(r).map(s => s.blk)).toEqual([null, inst.meta.iid])
    expect(pruneBlocks(r).map(b => b.iid)).toEqual([inst.meta.iid])
    expect(segmentsOf({ ex: [reps(BENCH, 6, 10)] })).toEqual([{ blk: null, idx: [0], meta: null }])
  })
  it('search matches words, minutes and filters', () => {
    const list = [{ ...master, estimatedMinutes: 30, official: true }, { id: 'p', name: 'Mi pecho', focus: 'chest', goal: 'strength', level: 'advanced', estimatedMinutes: 20, createdBy: 'u1' }]
    expect(filterBlocks(list, { q: 'glutes intermediate' }).map(b => b.id)).toEqual(['off-x'])
    expect(filterBlocks(list, { q: '20 min' }).map(b => b.id)).toEqual(['p'])
    expect(filterBlocks(list, { source: 'mine', uid: 'u1' }).map(b => b.id)).toEqual(['p'])
    expect(blockTitle(list[1])).toBe('Mi pecho')
  })
})

it('the model gets a compact slice, not the whole protocol', () => {
  const c = compactProtocol('strength', 'advanced')
  expect(c.version).toBe('1.0')
  expect(c.rules.some(r => r.id === '2J-RULE-REPS-HYP')).toBe(false)
  expect(JSON.stringify(c).length).toBeLessThan(6000)
})
