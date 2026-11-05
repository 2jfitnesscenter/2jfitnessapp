// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The UI consumers of an exercise merge: the exercise menu entry "Fusionar con…" and the routine editor, which shows a
// merged-away exercise as its target. Undo (no mapping) brings the original back.
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { EXIDX } from '../lib/exercises.js'
import { nameFor } from '../lib/i18n.js'

vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))

const real = Object.keys(EXIDX).filter(id => EXIDX[id] && EXIDX[id].tg && !EXIDX[id].custom)
const A = real[0]
const B = real.find(id => id !== A && nameFor(EXIDX[id]) !== nameFor(EXIDX[A]) && EXIDX[id].tg !== EXIDX[A].tg)

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
  const base = JSON.parse(JSON.stringify(DEF))
  memory.set('gym_state_v1', JSON.stringify(Object.assign(base, { onboarded: true, routines: [{ id: 'r1', name: 'Day', ex: [{ id: B, sets: 3, reps: 8 }] }] }, over)))
  vi.resetModules()
  const ui = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(ui.useUI)
  return { ui: ui.useUI, sheets: await import('../sheets.jsx'), RoutineEdit: (await import('./RoutineEdit.jsx')).default }
}
afterEach(() => { vi.unstubAllGlobals() })

describe('Routine editor: a merged-away exercise shows its target', () => {
  it('shows the target name for a merged-away entry, and the original again once the merge is undone', async () => {
    const merged = await boot({ exMerges: { [B]: A } })
    const html = renderToStaticMarkup(<MemoryRouter initialEntries={['/plan/r1']}><Routes><Route path="/plan/:id" element={<merged.RoutineEdit />} /></Routes></MemoryRouter>)
    expect(html).toContain(nameFor(EXIDX[A]))
    expect(html).not.toContain(nameFor(EXIDX[B]))

    const undone = await boot({})
    const html2 = renderToStaticMarkup(<MemoryRouter initialEntries={['/plan/r1']}><Routes><Route path="/plan/:id" element={<undone.RoutineEdit />} /></Routes></MemoryRouter>)
    expect(html2).toContain(nameFor(EXIDX[B]))
  })
})

describe('Exercise menu: "Fusionar con…" entry', () => {
  const openDetail = (ui, sheets, ex) => {
    sheets.exerciseDetailSheet(ex)
    const sheet = ui.getState().sheets.at(-1)
    return renderToStaticMarkup(<MemoryRouter>{sheet.render(() => {})}</MemoryRouter>)
  }
  it('is offered for an exercise in the library, and not for one already merged away', async () => {
    const plain = await boot({})
    expect(openDetail(plain.ui, plain.sheets, EXIDX[B])).toContain('Fusionar con…')

    const merged = await boot({ exMerges: { [B]: A } })
    expect(openDetail(merged.ui, merged.sheets, EXIDX[B])).not.toContain('Fusionar con…')
    expect(openDetail(merged.ui, merged.sheets, EXIDX[A])).toContain('Fusionar con…')
  })
})
