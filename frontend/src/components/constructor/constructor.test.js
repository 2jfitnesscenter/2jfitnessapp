import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

vi.mock('../../sheets.jsx', () => ({ exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseNotesSheet: vi.fn() }))
vi.mock('../../store/useUI.js', () => ({ useUI: () => vi.fn() }))
vi.mock('../../store/useStore.js', () => ({ useStore: () => ({}) }))
const { insertInstance, moveEntry, moveSegment, removeSegment, ungroupSegment, toggleLink, withEx, prescribedEntry, dayMinutes } = await import('./DayCanvas.jsx')
const { instantiateBlock, segmentsOf, validateAgainst2JProtocol, filterBlocks, FOCUS_LABEL } = await import('../../lib/protocol/index.js')
const { EXIDX } = await import('../../lib/exercises.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const LIB = JSON.parse(readFileSync(join(root, 'api', 'lib', 'blocks-official.json'), 'utf8'))
const byId = id => LIB.blocks.find(b => b.id === id)
const lookup = id => EXIDX[id] || null

// An old routine: loose entries, one superset — exactly what members have today.
const legacy = () => ({ name: 'Old', ex: [{ id: '0025', sets: 3, reps: 10 }, { id: '0294', sets: 3, reps: 12, sg: 's1' }, { id: '0201', sets: 3, reps: 12, sg: 's1' }] })

describe('day operations (Program → Day → Blocks → Exercises)', () => {
  it('an old routine is one loose segment and keeps its superset', () => {
    const d = legacy()
    expect(segmentsOf(d)).toEqual([{ blk: null, idx: [0, 1, 2], meta: null }])
    expect(withEx(d, d.ex.map(e => ({ ...e }))).ex[2].sg).toBe('s1')
  })
  it('inserting a block copies it; editing the day never touches the master', () => {
    const master = byId('off-glutes-hypertrophy-intermediate-b')
    const before = JSON.stringify(master)
    const d = insertInstance(legacy(), instantiateBlock(master))
    expect(d.ex).toHaveLength(3 + master.ex.length)
    expect(d.blocks).toHaveLength(1)
    const edited = withEx(d, d.ex.map((e, i) => i === 3 ? { ...e, sets: 5, rpe: [8, 8, 8, 8, 10] } : { ...e }))
    expect(edited.ex[3].sets).toBe(5)
    expect(JSON.stringify(master)).toBe(before)
  })
  it('remove, replace, add manual, reorder — the success path of the brief', () => {
    let d = insertInstance({ name: 'D1', ex: [] }, instantiateBlock(byId('off-glutes-hypertrophy-intermediate-a')))
    const iid = d.blocks[0].iid
    d = withEx(d, d.ex.filter((_, i) => i !== 1).map(e => ({ ...e })))                        // delete one
    d = withEx(d, d.ex.map((e, i) => i === 0 ? { ...e, id: '0739' } : { ...e }))               // replace another
    d = withEx(d, d.ex.map((e, i) => i === 1 ? { ...e, targetRepsMin: 10, targetRepsMax: 12, reps: 12, rpe: [8, 8, 10] } : { ...e }))
    d = withEx(d, [...d.ex, prescribedEntry(EXIDX['0605'], { goal: 'hypertrophy', level: 'intermediate' })])   // manual exercise
    expect(d.ex.map(e => e.id)).toEqual(['0739', '0410', '0228', '0597', '0605'])
    expect(d.ex.slice(0, 4).every(e => e.blk === iid)).toBe(true)
    expect(d.ex[4].blk).toBeUndefined()
    expect(segmentsOf(d).map(s => s.blk)).toEqual([iid, null])
    d = moveEntry(d, 4, 0, iid)                                                                 // drag the manual one into the block
    expect(d.ex[0].id).toBe('0605')
    expect(segmentsOf(d)).toHaveLength(1)
    const v = validateAgainst2JProtocol({ kind: 'routine', goal: 'hypertrophy', level: 'intermediate', entries: d.ex }, { lookup })
    expect(v.result).not.toBe('FAIL')
    expect(dayMinutes(d.ex, 'hypertrophy') % 5).toBe(0)
  })
  it('blocks move as units; removing or ungrouping one never breaks the rest', () => {
    let d = insertInstance(legacy(), instantiateBlock(byId('off-arms-hypertrophy-intermediate-x-ss')))
    const segs = segmentsOf(d)
    d = moveSegment(d, 1, 0)
    expect(segmentsOf(d)[0].blk).toBe(segs[1].blk)
    const pairs = d.ex.filter(e => e.sg)
    expect(new Set(pairs.map(e => e.sg)).size).toBe(3)            // the block's 2 pairs + the legacy pair, never merged
    expect(ungroupSegment(d, segmentsOf(d)[0]).blocks).toEqual([])
    expect(removeSegment(d, segmentsOf(d)[0]).ex.map(e => e.id)).toEqual(['0025', '0294', '0201'])
  })
  it('supersets link only inside one block', () => {
    let d = insertInstance(legacy(), instantiateBlock(byId('off-calves-hypertrophy-beginner-x')))
    const before = JSON.stringify(d)
    expect(JSON.stringify(toggleLink(d, 3))).toBe(before)        // first entry of the block ↔ last legacy entry: refused
    d = toggleLink(d, 4)
    expect(d.ex[3].sg && d.ex[3].sg === d.ex[4].sg).toBe(true)
  })
})

describe('official library — coverage and quality', () => {
  const blocks = LIB.blocks
  it('every block uses real ids, validates, and the version is recorded', () => {
    expect(blocks.length).toBeGreaterThanOrEqual(100)
    for (const b of blocks) {
      for (const e of b.ex) expect(EXIDX[e.id], `${b.id} ${e.id}`).toBeTruthy()
      expect(b.protocolVersion).toBe('1.0')
      const v = validateAgainst2JProtocol({ kind: 'block', goal: b.goal, level: b.level, type: b.type, focus: b.focus, entries: b.ex }, { lookup, official: true })
      expect(v.result, `${b.id}: ${v.issues.map(i => i.code)}`).not.toBe('FAIL')
    }
  })
  it('glutes hypertrophy exists at every level with real A/B/C variants', () => {
    for (const level of ['beginner', 'intermediate', 'advanced']) {
      const fam = blocks.filter(b => b.focus === 'glutes' && b.goal === 'hypertrophy' && b.level === level && b.type === 'strength')
      expect(fam.map(b => b.variant).sort()).toEqual(['A', 'B', 'C'])
      expect(new Set(fam.map(b => b.style)).size).toBe(3)
      for (const b of fam) expect(b.ex.length >= 4 && b.ex.length <= 7).toBe(true)
    }
  })
  it('covers the families the gym asked for', () => {
    for (const f of ['chest', 'back', 'shoulders', 'arms', 'quads', 'hamstrings', 'posterior', 'abs', 'push', 'pull', 'lower', 'fullbody'])
      expect(blocks.some(b => b.focus === f), f).toBe(true)
    for (const g of ['hypertrophy', 'strength', 'general', 'endurance', 'beginner']) expect(blocks.some(b => b.goal === g), g).toBe(true)
    expect(blocks.filter(b => b.goal === 'power').length).toBeLessThan(5)           // not generated for every muscle
    expect(blocks.some(b => b.focus === 'fatloss' || b.goal === 'fatloss')).toBe(false)
  })
  it('search finds what trainers type', () => {
    const t = s => s
    const ids = q => filterBlocks(blocks, { q }, t).map(b => b.id)
    expect(ids('glutes advanced').some(id => id.startsWith('off-glutes-hypertrophy-advanced'))).toBe(true)
    expect(ids('chest strength')).toContain('off-chest-strength-intermediate-x')
    expect(ids('posterior chain').length).toBeGreaterThan(0)
    expect(ids('20 min').every(id => Math.abs(byId(id).estimatedMinutes - 20) <= 7)).toBe(true)
    expect(FOCUS_LABEL.back).toBe('Back muscles')
  })
})

describe('what Workout and the Bunker receive', () => {
  it('a day built from blocks becomes the same executable entries as before — supersets included', async () => {
    const { buildRoutineEntries } = await import('../../lib/progression.js')
    const d = insertInstance({ id: 'r1', name: 'D', ex: [] }, instantiateBlock(byId('off-arms-hypertrophy-intermediate-x-ss')))
    const S = { unit: 'kg', workouts: [], exWeights: {}, tests: [], customEx: [], warmupEnabled: false, routines: [d] }
    const entries = buildRoutineEntries(S, d)
    expect(entries.map(e => e.id)).toEqual(d.ex.map(e => e.id))
    expect(entries[0].sg).toBe(d.ex[0].sg)
    expect(entries[0].sg).toBe(entries[1].sg)
    expect(entries[1].target).toMatchObject({ rest: d.ex[1].rest, rpe: d.ex[1].rpe, targetRepsMax: d.ex[1].targetRepsMax })
    expect(entries[0].sets.filter(s => s.type !== 'warmup')).toHaveLength(d.ex[0].sets)
  })
})
