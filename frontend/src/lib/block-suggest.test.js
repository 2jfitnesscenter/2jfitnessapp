import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { EXDB } from './exercises-data.js'
import { validateAgainst2JProtocol, instantiateBlock } from './protocol/index.js'
import { suggestBlocks } from './block-suggest.js'

/* Sugerencias 2J — deterministic, direct sets only, suggestions only. */
const byId = Object.fromEntries(EXDB.map(e => [e.id, e]))
const lookup = id => byId[id] || null
const here = dirname(fileURLToPath(import.meta.url))
const library = JSON.parse(readFileSync(join(here, '..', '..', '..', 'api', 'lib', 'blocks-official.json'), 'utf8')).blocks
const program = days => validateAgainst2JProtocol({ kind: 'program', goal: 'hypertrophy', level: 'intermediate', days }, { lookup })
const ex = (id, sets = 3) => ({ id, sets, mode: 'reps', reps: 10, targetRepsMin: 8, targetRepsMax: 12 })
// Chest, back and quads — no direct hamstrings, glutes or core work.
const days = [[ex('0025', 4), ex('0047', 4), ex('0289', 3)], [ex('0017', 4), ex('0861', 4), ex('0292', 3)], [ex('0043', 4), ex('0739', 4), ex('0585', 3)]]
const base = { goal: 'hypertrophy', level: 'intermediate', blocks: library, days: 3 }

describe('suggestions for a program', () => {
  it('points at what has no direct work, with compatible blocks — posterior chain and core here', () => {
    const v = program(days)
    const s = suggestBlocks({ ...base, weeklySets: v.stats.weeklySets })
    expect(s.map(x => x.key)).toEqual(expect.arrayContaining(['posterior']))
    const post = s.find(x => x.key === 'posterior')
    expect(post.status).toBe('none')
    expect(post.sets).toEqual({ glutes: 0, hamstrings: 0 })
    expect(post.envelope).toEqual([8, 14])
    expect(post.blocks.length).toBeGreaterThan(0)
    for (const b of post.blocks) {
      expect(b.goal).toBe('hypertrophy')
      expect(['intermediate']).toContain(b.level)
      expect(['posterior', 'glutes', 'hamstrings']).toContain(b.focus)
    }
    expect(s.length).toBeLessThanOrEqual(3)
  })
  it('never counts indirect volume: squats and leg presses are not glute sets', () => {
    const v = program(days)
    expect(v.stats.weeklySets.glutes || 0).toBe(0)
    expect(v.stats.weeklySets.quads).toBe(11)
  })
  it('an area inside the envelope is not suggested; below it is "little direct presence", not "missing"', () => {
    const full = { chest: 12, back: 12, quads: 12, glutes: 10, hamstrings: 10, shoulders: 10, biceps: 9, triceps: 9, calves: 8, abs: 8 }
    expect(suggestBlocks({ ...base, weeklySets: full })).toEqual([])
    const s = suggestBlocks({ ...base, weeklySets: { ...full, abs: 4 } })
    expect(s.map(x => [x.key, x.status])).toEqual([['core', 'low']])
  })
  it('suggests only; the program and the library are not changed', () => {
    const before = JSON.stringify(days), libBefore = JSON.stringify(library)
    suggestBlocks({ ...base, weeklySets: program(days).stats.weeklySets })
    expect(JSON.stringify(days)).toBe(before)
    expect(JSON.stringify(library)).toBe(libBefore)
  })
  it('respects goal, level, restrictions, equipment and what is already in the plan', () => {
    const w = program(days).stats.weeklySets
    // strength looks only at the big areas, and only at what has no direct work at all
    expect(suggestBlocks({ ...base, goal: 'strength', weeklySets: { ...w, biceps: 0 } }).every(s => ['posterior', 'quads', 'chest', 'back'].includes(s.key))).toBe(true)
    // a block that FAILs the member's restrictions is never offered
    const noSpine = b => validateAgainst2JProtocol({ kind: 'block', goal: b.goal, level: b.level, type: b.type, entries: b.ex }, { lookup, restrictions: ['no-spinal-loading'] })
    const s = suggestBlocks({ ...base, weeklySets: w, validate: noSpine })
    for (const a of s) for (const b of a.blocks) expect(noSpine(b).result).not.toBe('FAIL')
    // blocks already copied into the plan are not suggested again
    const first = suggestBlocks({ ...base, weeklySets: w }).find(x => x.key === 'posterior').blocks[0]
    const again = suggestBlocks({ ...base, weeklySets: w, exclude: new Set([first.id]) }).find(x => x.key === 'posterior')
    expect(again.blocks.map(b => b.id)).not.toContain(first.id)
    // equipment the gym does not have right now
    const noMachines = suggestBlocks({ ...base, weeklySets: w, unavailableEq: ['leverage machine', 'barbell', 'cable', 'dumbbell', 'body weight', 'smith machine', 'sled machine'] })
    expect(noMachines).toEqual([])
    expect(suggestBlocks({ ...base, weeklySets: w, days: 0 })).toEqual([])
  })
  it('adding a suggested block is the normal insert: a snapshot copy the day can edit', () => {
    const b = suggestBlocks({ ...base, weeklySets: program(days).stats.weeklySets })[0].blocks[0]
    const inst = instantiateBlock(b)
    expect(inst.ex.length).toBe(b.ex.length)
    expect(inst.ex.every(e => e.blk === inst.meta.iid)).toBe(true)
    expect(inst.meta.src).toBe(b.id)
  })
})
