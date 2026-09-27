// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/* Constructor UX mini-sprint: days on top, exercise library (left) | day | block library (right),
 * drag & drop from both libraries onto the day. Real store, network down. */
vi.mock('../../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
const here = dirname(fileURLToPath(import.meta.url))
const LIB = JSON.parse(readFileSync(join(here, '..', '..', '..', '..', 'api', 'lib', 'blocks-official.json'), 'utf8'))
let memory
async function boot(over = {}) {
  vi.resetModules()
  memory = new Map()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible', body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  const { DEF } = await import('../../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(JSON.parse(JSON.stringify(DEF)), { onboarded: true }, over)))
  vi.resetModules()
  const ui = await import('../../store/useUI.js')
  ;(await import('../../components/ui.jsx')).bindUI(ui.useUI)
  return {
    sheets: await import('../../sheets.jsx'),
    canvas: await import('../../components/constructor/DayCanvas.jsx'),
    drag: await import('../../components/constructor/drag.js'),
    Library: await import('../../components/constructor/Library.jsx'),
    Constructor: await import('./Constructor.jsx'),
    protocol: await import('../../lib/protocol/index.js'),
  }
}
afterEach(() => { vi.unstubAllGlobals() })
const render = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)

describe('days on top', () => {
  const days = [
    { key: 'a', name: 'Push', ex: [{ id: '0025', sets: 3, reps: 10 }], blocks: [], dirty: false },
    { key: 'b', name: 'Pull', ex: [], blocks: [], dirty: true },
    { key: 'c', name: 'Legs', ex: [], blocks: [], dirty: false },
  ]
  it('one horizontal strip: every day in order, the active one marked, its weekdays, and Add day', async () => {
    const { Constructor } = await boot()
    const html = render(<Constructor.DayBar days={days} week={{ 1: 'a', 4: 'a', 3: 'c' }} active={1} goal="hypertrophy" onPick={() => {}} onAdd={() => {}} onToggleWeekday={() => {}} />)
    expect(html).toContain('class="cx-days cx-daybar"')
    expect(html.indexOf('Push')).toBeLessThan(html.indexOf('Pull'))
    expect(html.indexOf('Pull')).toBeLessThan(html.indexOf('Legs'))
    expect(html.match(/class="cx-day on"/g)).toHaveLength(1)
    expect(html).toMatch(/class="cx-day on"><button class="cx-day-b" aria-current="true"><span class="cx-day-n num">2</)
    expect(html).toContain('class="cx-day-wd"')                   // Push: Mo · Th
    expect(html).toContain('unsaved')                            // Pull is dirty
    expect(html).toContain('class="cx-day-add"')
    expect(html.match(/class="cx-wd/g)).toHaveLength(21)         // weekday toggles kept on every day
  })
  it('seven days still fit as one scrollable strip (no wrapping into a column)', async () => {
    const { Constructor } = await boot()
    const seven = Array.from({ length: 7 }, (_, i) => ({ key: 'k' + i, name: 'Day ' + (i + 1), ex: [], blocks: [] }))
    const html = render(<Constructor.DayBar days={seven} week={{}} active={6} goal="general" onPick={() => {}} onAdd={() => {}} onToggleWeekday={() => {}} />)
    expect(html.match(/class="cx-day( on)?"/g)).toHaveLength(7)
    const css = readFileSync(join(here, '..', '..', 'index.css'), 'utf8')
    expect(css).toMatch(/\.cx-daybar\{[^}]*flex-direction:row[^}]*overflow-x:auto/)
  })
})

describe('exercise library beside the day (the existing picker, inline)', () => {
  it('reuses ExercisePicker: search with an id, 2J scope, filters, Add buttons and draggable rows', async () => {
    const { sheets } = await boot()
    const html = render(<sheets.ExercisePicker inline searchId="cx-ex-search" onPick={() => {}} close={() => {}} />)
    expect(html).toContain('id="cx-ex-search"')
    expect(html).toContain('2J exercises')
    expect(html).toContain('Full library')
    expect(html).toContain('Compatible with this place')
    expect(html).toContain('Muscle group')
    expect(html).toContain('class="item cx-exitem" draggable="true"')
    expect(html).toContain('class="cx-add"')
    expect(html).not.toContain('<h3>Add exercise</h3>')        // the panel has its own title
    // the modal picker is unchanged: title, no drag, no Add buttons
    const modal = render(<sheets.ExercisePicker onPick={() => {}} close={() => {}} />)
    expect(modal).toContain('<h3>Add exercise</h3>')
    expect(modal).not.toContain('draggable')
    expect(modal).not.toContain('cx-exitem')
  })
  it('follows the active Gym Profile: favourites chip and place compatibility on each row', async () => {
    const { sheets } = await boot({ favEx: ['0025'], gymProfiles: { activeId: 'home', overrides: { home: ['bodyweight'] }, custom: [] } })
    const html = render(<sheets.ExercisePicker inline onPick={() => {}} close={() => {}} />)
    expect(html).toContain('Favourites')
    // a home profile without weights: compatible (bodyweight) exercises are listed first, each row says so
    const rows = html.split('class="item cx-exitem"').slice(1)
    expect(rows.length).toBeGreaterThan(5)
    expect(rows[0]).toContain('<span class="small dim">Compatible with this place</span>')
  })
})

describe('adding to the day: button, drop on a row, drop on the canvas', () => {
  const day = () => ({ name: 'D', blocks: [{ iid: 'k1', src: 'off-x', type: 'strength' }], ex: [
    { id: '0025', sets: 3, reps: 8, blk: 'k1' }, { id: '0294', sets: 3, reps: 12, blk: 'k1' }, { id: '0447', sets: 3, reps: 10 }] })
  it('an exercise dropped on a row goes before it and joins its block; elsewhere it is appended loose', async () => {
    const { canvas } = await boot()
    const d = day()
    const into = canvas.insertExerciseAt(d, { id: '0043', sets: 3, reps: 10, sg: 'x', blk: 'zz' }, 1)
    expect(into.ex.map(e => e.id)).toEqual(['0025', '0043', '0294', '0447'])
    expect(into.ex[1]).toMatchObject({ blk: 'k1' })
    expect(into.ex[1].sg).toBeUndefined()
    const end = canvas.insertExerciseAt(d, { id: '0043', sets: 3, reps: 10 }, null)
    expect(end.ex.map(e => e.id)).toEqual(['0025', '0294', '0447', '0043'])
    expect(end.ex[3].blk).toBeUndefined()
    expect(d.ex).toHaveLength(3)                                   // the old day is untouched
    expect(end.blocks).toEqual(d.blocks)
  })
  it('the prescription is the protocol’s, the same as the old picker path', async () => {
    const { canvas } = await boot()
    const e = canvas.prescribedEntry({ id: '0025' }, { goal: 'hypertrophy', level: 'intermediate' }, 0)
    const d = canvas.insertExerciseAt({ name: 'D', ex: [], blocks: [] }, e, null)
    expect(d.ex[0]).toEqual(e)
  })
  it('a dropped block is inserted like its Add button: a copied instance, the master untouched', async () => {
    const { canvas, protocol } = await boot()
    const off = LIB.blocks.find(b => b.official && b.type === 'strength')
    const before = JSON.stringify(off)
    const d = canvas.insertInstance({ name: 'D', ex: [], blocks: [] }, protocol.instantiateBlock(off))
    expect(d.ex).toHaveLength(off.ex.length)
    expect(d.blocks[0]).toMatchObject({ src: off.id })
    expect(JSON.stringify(off)).toBe(before)
  })
  it('drag payloads: exercise id or block id, read by type; internal reorder drags are ignored', async () => {
    const { drag } = await boot()
    const ev = types => ({ dataTransfer: { types } })
    expect(drag.dragKindOf(ev([drag.EX_DRAG_TYPE]))).toBe('ex')
    expect(drag.dragKindOf(ev([drag.BLOCK_DRAG_TYPE]))).toBe('block')
    expect(drag.dragKindOf(ev(['text/plain']))).toBe(null)
    expect(drag.dragKindOf({})).toBe(null)
  })
  it('the canvas accepts drops only where the builder wires them; Add exercise stays at the bottom', async () => {
    const { canvas } = await boot()
    const Canvas = canvas.default
    const props = { ctx: { goal: 'hypertrophy', level: 'intermediate' }, unit: 'kg', onChange: () => {}, onAddBlock: () => {}, onAddExercise: () => {} }
    const empty = render(<Canvas day={{ name: 'D', ex: [], blocks: [] }} {...props} onDropExternal={() => {}} />)
    expect(empty).toContain('Or drag an exercise or a block here')
    expect(render(<Canvas day={{ name: 'D', ex: [], blocks: [] }} {...props} />)).not.toContain('Or drag')
    const full = render(<Canvas day={day()} {...props} onDropExternal={() => {}} />)
    expect(full).toContain('Add exercise')
    expect(full).toContain('Add block')
  })
  it('block cards and rows are draggable only where they can be added (not on the management page)', async () => {
    const { Library } = await boot()
    const b = { ...LIB.blocks.find(x => x.official), estimatedMinutes: 20 }
    expect(render(<Library.BlockCard b={b} onPreview={() => {}} onAdd={() => {}} />)).toContain('draggable="true"')
    expect(render(<Library.BlockRow b={b} onPreview={() => {}} onAdd={() => {}} />)).toContain('draggable="true"')
    expect(render(<Library.BlockCard b={b} onPreview={() => {}} />)).not.toContain('draggable')
  })
})

describe('the builder wiring (source): layout, both libraries, save path untouched', () => {
  const src = readFileSync(join(here, 'Constructor.jsx'), 'utf8')
  it('days bar above a three-zone grid: exercises | day | blocks', () => {
    const iBar = src.indexOf('<DayBar'), iGrid = src.indexOf('cx-grid tri'), iEx = src.indexOf('cx-exlib'), iMain = src.indexOf('<main className="cx-main"'), iBlocks = src.indexOf('<Library onAdd={addBlock}')
    expect(iBar).toBeGreaterThan(0)
    expect(iBar < iGrid && iGrid < iEx && iEx < iMain && iMain < iBlocks).toBe(true)
  })
  it('the bottom "Add exercise" opens/focuses the exercise library; drops go through the same add paths', () => {
    expect(src).toMatch(/onAddExercise=\{openExercises\}/)
    expect(src).toMatch(/onDropExternal=\{onDropExternal\}/)
    expect(src).toMatch(/if \(kind === 'block'\) \{ const b = libBlocks\.find\(x => x\.id === xid\); if \(b\) addBlock\(b\) \}/)
    // saving still goes through the trainer endpoints with Sync V2 receipts, unchanged
    expect(src).toContain('saveMemberRoutine({ sync, memberId')
    expect(src).toContain('saveMemberProgram({ sync, memberId')
  })
})
