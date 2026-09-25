import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

/* Constructor V2.1 — guided timing on a day's segments, and the library's grid/list view. */
vi.mock('../../sheets.jsx', () => ({ exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseNotesSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../../store/useUI.js', () => ({ useUI: sel => (sel ? sel({ openSheet: vi.fn(), toast: vi.fn() }) : {}) }))
vi.mock('../../store/useStore.js', () => ({ useStore: () => ({}) }))
vi.mock('../../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))) }))

const memory = new Map()
vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) })

const { setSegmentTiming, clearSegmentTiming, dayMinutes, insertInstance } = await import('./DayCanvas.jsx')
const { default: Library, readLibView, writeLibView } = await import('./Library.jsx')
const { useBlocks } = await import('../../lib/blocks-api.js')
const { segmentsOf, instantiateBlock, validateAgainst2JProtocol, blockTypesOf, TIMING_PRESETS } = await import('../../lib/protocol/index.js')
const { EXIDX } = await import('../../lib/exercises.js')

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..')
const LIB = JSON.parse(readFileSync(join(root, 'api', 'lib', 'blocks-official.json'), 'utf8'))
const lookup = id => EXIDX[id] || null
afterEach(() => memory.clear())

describe('guided segments in a day', () => {
  const loose = () => ({ name: 'D', blocks: [], ex: [{ id: '0514', sets: 3, mode: 'reps', reps: 8 }, { id: '0175', sets: 3, mode: 'reps', reps: 15, sg: 's1' }, { id: '0276', sets: 3, mode: 'reps', reps: 12, sg: 's1' }] })
  it('loose exercises become a Tabata block of their own: rounds = sets, timed bouts, no superset links', () => {
    const d = loose()
    const seg = segmentsOf(d)[0]
    const out = setSegmentTiming(d, seg, 'hiit', { prep: 10, ...TIMING_PRESETS.tabata, preset: 'tabata' }, 'Tabata')
    expect(out.blocks).toHaveLength(1)
    const b = out.blocks[0]
    expect(b).toMatchObject({ type: 'hiit', name: 'Tabata', timing: { work: 20, rest: 10, rounds: 8, preset: 'tabata' } })
    expect(out.ex.every(e => e.blk === b.iid && e.sets === 8 && e.mode === 'time' && e.sec === 20 && !e.sg)).toBe(true)
    // judged as what it is: no strength-set FAIL for 8 rounds
    const v = validateAgainst2JProtocol({ kind: 'routine', goal: 'general', level: 'intermediate', entries: out.ex, blockTypes: blockTypesOf(out.blocks) }, { lookup })
    expect(v.issues.map(i => i.code)).not.toContain('sets_outside_allowed')
    expect(d.ex[0].sets).toBe(3)   // the old day object is untouched
  })
  it('retiming an existing block keeps its label; "back to normal sets" drops only the pacing', () => {
    const off = LIB.blocks.find(b => b.id === 'off-abs-general-intermediate-x-circuit')
    const d = insertInstance({ name: 'D', blocks: [], ex: [] }, instantiateBlock(off))
    const seg = segmentsOf(d)[0]
    expect(seg.meta).toMatchObject({ type: 'circuit', src: off.id })
    const re = setSegmentTiming(d, seg, 'circuit', { ...seg.meta.timing, rounds: 2 })
    expect(re.blocks[0]).toMatchObject({ iid: seg.blk, src: off.id, timing: { rounds: 2 } })
    expect(re.ex.every(e => e.sets === 2)).toBe(true)
    const back = clearSegmentTiming(re, segmentsOf(re)[0])
    expect(back.blocks[0].type).toBe('strength')
    expect(back.blocks[0].timing).toBeUndefined()
    expect(back.ex).toHaveLength(re.ex.length)
  })
  it('the day minutes count a guided segment by its timing', () => {
    const tab = LIB.blocks.find(b => b.id === 'off-cardio-general-advanced-x-hiit')
    const d = insertInstance({ name: 'D', blocks: [], ex: [] }, instantiateBlock(tab))
    expect(dayMinutes(d.ex, 'general', d.blocks)).toBe(5)
    expect(dayMinutes([{ id: '0025', sets: 3, reps: 10 }], 'hypertrophy')).toBeGreaterThan(0)   // legacy call still works
  })
})

describe('library grid / list', () => {
  const render = () => renderToStaticMarkup(<Library onAdd={() => {}} />)
  it('the view is a per-user, per-device preference — never synced, grid by default', () => {
    expect(readLibView('t1')).toBe('grid')
    writeLibView('t1', 'list')
    expect(readLibView('t1')).toBe('list')
    expect(readLibView('t2')).toBe('grid')
    expect([...memory.keys()]).toEqual(['cx_lib_view:t1'])
  })
  it('both views show the same blocks through the same sections; the list is compact with its columns', () => {
    // Server rendering reads the store's initial snapshot (useSyncExternalStore), so seed that.
    Object.assign(useBlocks.getInitialState(), { status: 'ready', blocks: LIB.blocks, favorites: [LIB.blocks[0].id], uid: 't1', load: () => {} })
    const grid = render()
    expect(grid).toContain('cx-card')
    expect(grid).not.toContain('cx-lrow')
    writeLibView('t1', 'list')
    const list = render()
    expect(list).toContain('class="cx-list"')
    expect(list).not.toContain('<article class="cx-card')
    const ids = html => (html.match(/aria-label="Preview [^"]+"/g) || []).sort()
    expect(ids(list)).toEqual(ids(grid))
    for (const cls of ['cx-lc goal', 'cx-lc level', 'cx-lc var', 'cx-lc exn', 'cx-lc min', 'cx-lc eq', 'cx-lc src', 'cx-view', 'cx-add', 'cx-star'])
      expect(list, cls).toContain(cls)
    for (const s of ['Favorites', '2J official', 'Show more']) { expect(grid).toContain(s); expect(list).toContain(s) }
    expect(list).toContain('aria-pressed="true" title="List"')
  })
})
