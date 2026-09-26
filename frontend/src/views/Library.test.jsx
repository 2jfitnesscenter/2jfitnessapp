// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/* Exercise Library V2 in the UI: "2J exercises" by movement family, the picker's 2J scope,
 * favourites, and the Constructor's replace going through similar variants. Network down. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
const here = dirname(fileURLToPath(import.meta.url))
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
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(JSON.parse(JSON.stringify(DEF)), { onboarded: true }, over)))
  vi.resetModules()
  const store = await import('../store/useStore.js')
  const ui = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(ui.useUI)
  return { store, sheets: await import('../sheets.jsx'), Library: (await import('./Library.jsx')).default, lib: await import('../lib/library/index.js') }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('Plan > Exercises: 2J exercises', () => {
  it('shows movement families by region and a discreet way into the full library', async () => {
    const { Library, lib } = await boot()
    const html = renderToStaticMarkup(<MemoryRouter><Library /></MemoryRouter>)
    expect(html).toContain('2J exercises')
    expect(html).toContain('lib-fam')
    for (const label of ['Squat &amp; leg press', 'Hip thrust &amp; bridge', 'Row', 'Horizontal press', 'Lower body', 'Upper body']) expect(html).toContain(label)
    expect(html).toContain('See the full library')
    expect(html).toContain(`${[...lib.RECOMMENDED].length} recommended exercises`)
    expect(html).not.toContain('Favourites') // no favourites yet → no chip
    // Unset filters show their placeholder, never an "Any …" chip that looks switched on.
    for (const ph of ['Muscle', 'Movement', 'Gear']) expect(html).toMatch(new RegExp(`class="chip chip-select">${ph}<`))
    expect(html).not.toContain('Any muscle')
  })
  it('favourites and recents appear as chips when the member has them', async () => {
    const { Library } = await boot({ favEx: ['0025'], workouts: [{ id: 'w', d: '2026-09-20', end: 1, entries: [{ id: '0043', sets: [] }] }] })
    const html = renderToStaticMarkup(<MemoryRouter><Library /></MemoryRouter>)
    expect(html).toContain('Favourites')
    expect(html).toContain('Recent')
  })
})

describe('Add exercise picker (Constructor, routines, workout)', () => {
  it('opens on Recommended 2J with the full library one tap away; deprecated never in 2J', async () => {
    const { sheets, lib } = await boot()
    const html = renderToStaticMarkup(<MemoryRouter><sheets.ExercisePicker onPick={() => {}} close={() => {}} /></MemoryRouter>)
    expect(html).toContain('2J exercises')
    expect(html).toContain('Full library')
    expect(html).toContain(`Search ${lib.scopeList([...lib.RECOMMENDED].map(id => ({ id })), '2j').length} exercises`)
    expect(html).toContain('lib-2j')
    expect(html).not.toContain('Duplicated')
  })
})

describe('Constructor and trainer builder replace through similar variants', () => {
  it('DayCanvas and TrainerRoutineBuilder open the alternatives sheet, not the flat picker', () => {
    const src = f => readFileSync(join(here, f), 'utf8')
    expect(src('../components/constructor/DayCanvas.jsx')).toMatch(/onReplace=\{\(\) => alternativesSheet\(exOr\(e\.id\)/)
    expect(src('./trainer/TrainerRoutineBuilder.jsx')).toMatch(/onReplace: \(\) => alternativesSheet\(ex,/)
    expect(src('./Bunker.jsx')).toMatch(/alternativesSheet\(EXIDX\[entry\.id\]/) // Bunker keeps its flow, gets V2 through the same sheet
  })
})
