// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/* Runtime behaviour of the Studio on the client: the library overlay reaching an offline device,
 * the catalogue cache refreshing when the server's revision moves, the three-level gym
 * compatibility, and the static pieces of the admin UI. No network, no DOM. */
const apiMock = vi.fn()
vi.mock('../../../lib/api.js', () => ({ api: (...a) => apiMock(...a), IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false }))

let mem
beforeEach(() => {
  mem = new Map()
  vi.stubGlobal('localStorage', { getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: k => mem.delete(k) })
  apiMock.mockReset()
})

describe('library overlay on the device', () => {
  it('a config answer applies the admin corrections and keeps a copy for offline starts', async () => {
    const sync = await import('../../../lib/library/overlay-sync.js')
    const core = await import('../../../lib/library/core.js')
    const { facets, isRecommended } = await import('../../../lib/library/index.js')
    const { EXIDX } = await import('../../../lib/exercises.js')
    core.applyLibraryOverlay(null)
    const target = '0376'
    expect(isRecommended(target)).toBe(false)
    const raw = { v: 1, rev: 41, entries: { [target]: { recommended: true, aliases: ['alias de prueba qa'], note: 'privada' } }, variants: [] }
    expect(sync.applyConfigOverlay({ libraryOverlay: raw })).toBe(true)
    expect(isRecommended(target)).toBe(true)
    expect(core.aliasIndexOf().get('alias de prueba qa')).toBe(target)
    expect(facets(EXIDX[target]).recommended).toBe(true)
    expect(JSON.parse(mem.get('lib_overlay_v1')).rev).toBe(41)
    // the same revision again changes nothing
    expect(sync.applyConfigOverlay({ libraryOverlay: raw })).toBe(false)
    // offline start: restore from the copy
    core.applyLibraryOverlay(null)
    expect(isRecommended(target)).toBe(false)
    expect(sync.restoreCachedOverlay()).toBe(true)
    expect(isRecommended(target)).toBe(true)
    core.applyLibraryOverlay(null)
  })
  it('the admin overlay is cached without curatorial notes; garbage is ignored, never applied', async () => {
    const sync = await import('../../../lib/library/overlay-sync.js')
    const core = await import('../../../lib/library/core.js')
    core.applyLibraryOverlay(null)
    sync.applyAdminOverlay({ v: 1, rev: 3, entries: { '0376': { recommended: true, note: 'solo admin' } }, variants: [] })
    expect(mem.get('lib_overlay_v1')).not.toMatch(/solo admin/)
    mem.set('lib_overlay_v1', '{not json')
    core.applyLibraryOverlay(null)
    expect(sync.restoreCachedOverlay()).toBe(false)
    expect(sync.applyConfigOverlay({})).toBe(false)
    expect(sync.applyConfigOverlay({ libraryOverlay: 'x' })).toBe(false)
    // an entry that contradicts the code is skipped, not fatal
    expect(() => sync.applyConfigOverlay({ libraryOverlay: { v: 1, rev: 99, entries: { '9999': { n: 'ghost' }, '0376': { movement: 'nonsense' } }, variants: [] } })).not.toThrow()
    core.applyLibraryOverlay(null)
  })
})

describe('catalogue cache invalidation', () => {
  it('a newer catalogue revision in /api/config reloads an open library; the same one does not', async () => {
    const { useGuided } = await import('../../../lib/guided-api.js')
    const catalog = rev => ({ uid: 'u1', rev, routines: [{ id: 'r1', name: 'One', ex: [] }], programs: [], collections: [], mine: [], canEdit: false, canAssign: false })
    apiMock.mockResolvedValueOnce(catalog('1.3.0'))
    await useGuided.getState().load('u1', true)
    expect(useGuided.getState().rev).toBe('1.3.0')
    expect(apiMock).toHaveBeenCalledTimes(1)
    useGuided.getState().notifyRev('1.3.0')
    expect(apiMock).toHaveBeenCalledTimes(1)
    apiMock.mockResolvedValueOnce({ ...catalog('1.4.0'), routines: [{ id: 'r1', name: 'One', ex: [] }, { id: 'r2', name: 'Two', ex: [] }] })
    useGuided.getState().notifyRev('1.4.0')
    await vi.waitFor(() => expect(useGuided.getState().routines).toHaveLength(2))
    expect(useGuided.getState().rev).toBe('1.4.0')
    useGuided.getState().notifyRev(undefined)
    expect(apiMock).toHaveBeenCalledTimes(2)
    // the member's device copy carries the new catalogue for the next offline start
    expect(JSON.parse(mem.get('g2j_catalog:u1')).routines).toHaveLength(2)
  })
})

describe('gym compatibility in three levels (a routine is never hidden for one exercise)', () => {
  it('compatible, partially compatible and needs other equipment, with the missing exercises named', async () => {
    const { gymRoutineCompatibility, compatibleWithGym } = await import('../../../lib/gym-profiles.js')
    const { EXDB } = await import('../../../lib/exercises.js')
    const S = {}
    const ok = EXDB.filter(e => compatibleWithGym(S, e)).slice(0, 12)
    const no = EXDB.filter(e => !compatibleWithGym(S, e)).slice(0, 12)
    expect(ok.length).toBeGreaterThan(4); expect(no.length).toBeGreaterThan(4)
    const mk = list => ({ ex: list.map(e => ({ id: e.id })) })
    expect(gymRoutineCompatibility(S, mk(ok.slice(0, 4)))).toMatchObject({ compatible: true, level: 'compatible', missing: 0, total: 4 })
    const partial = gymRoutineCompatibility(S, mk([...ok.slice(0, 4), no[0]]))
    expect(partial).toMatchObject({ compatible: false, level: 'partial', missing: 1, total: 5 })
    expect(partial.missingIds).toEqual([no[0].id])
    expect(gymRoutineCompatibility(S, mk([ok[0], ...no.slice(0, 3)]))).toMatchObject({ level: 'requires', missing: 3 })
    expect(gymRoutineCompatibility(S, { ex: [] })).toMatchObject({ compatible: false })
  })
})

describe('Studio UI pieces', () => {
  it('status pills, the first-use guide and the routine picker render accessibly in the user language', async () => {
    const { StatusPill, StudioHelp, RoutinePicker, Segmented } = await import('./parts.jsx')
    expect(renderToStaticMarkup(<StatusPill x={{ draft: true, active: false }} />)).toMatch(/st-pill draft[\s\S]*Draft/)
    expect(renderToStaticMarkup(<StatusPill x={{ active: false }} />)).toMatch(/st-pill hidden/)
    expect(renderToStaticMarkup(<StatusPill x={{}} />)).toMatch(/st-pill active/)
    const help = renderToStaticMarkup(<StudioHelp onClose={() => {}} />)
    expect(help).toMatch(/1 \/ 3/); expect(help).toMatch(/Build and check/); expect(help).toMatch(/Skip/)
    const seg = renderToStaticMarkup(<Segmented value="b" onChange={() => {}} options={[['a', 'A', 1], ['b', 'B', 2]]} />)
    expect(seg).toMatch(/aria-selected="true"[^>]*class="on"|class="on"[^>]*aria-selected="true"/)
    const routines = [{ id: 'r1', name: 'Warm-up · Upper body', category: 'mobility', level: 'beginner', estimatedMinutes: 5, draft: true }]
    const picker = renderToStaticMarkup(<RoutinePicker routines={routines} close={() => {}} onPick={() => {}} />)
    expect(picker).toMatch(/Warm-up/); expect(picker).toMatch(/Search routines/)
  })
})

describe('direct visibility switch', () => {
  it('ON publishes and OFF hides through the existing store calls; a refusal propagates and nothing else is called', async () => {
    const { setVisible } = await import('../../../lib/studio.js')
    const g = { setStatus: vi.fn().mockResolvedValue({}), saveProgram: vi.fn().mockResolvedValue({}), saveCollection: vi.fn().mockResolvedValue({}) }
    await setVisible(g, 'routine', { id: 'r1' }, false)
    await setVisible(g, 'routine', { id: 'r1' }, true)
    expect(g.setStatus.mock.calls).toEqual([['r1', 'hidden'], ['r1', 'active']])
    await setVisible(g, 'program', { id: 'p1', name: 'P', weeks: [], routines: { x: 1 }, routineIds: ['x'] }, false)
    expect(g.saveProgram).toHaveBeenCalledWith({ id: 'p1', name: 'P', weeks: [], status: 'hidden' })
    await setVisible(g, 'collection', { id: 'c1', name: 'C', routineIds: ['a'], active: true }, false)
    expect(g.saveCollection).toHaveBeenCalledWith({ id: 'c1', name: 'C', routineIds: ['a'], active: false })
    await setVisible(g, 'collection', { id: 'c1', name: 'C', routineIds: ['a'], active: false }, true)
    expect(g.saveCollection.mock.calls[1][0].active).toBe(true)
    g.setStatus.mockRejectedValueOnce(new Error('la rutina no cumple'))
    await expect(setVisible(g, 'routine', { id: 'r2' }, true)).rejects.toThrow('la rutina no cumple')
    await expect(setVisible(g, 'block', { id: 'b' }, true)).rejects.toThrow()
  })
  it('a visible row shows an ON switch and no chip; a hidden or draft row shows its chip and an OFF switch', async () => {
    const { VisibilityControl } = await import('./parts.jsx')
    const on = renderToStaticMarkup(<VisibilityControl x={{ id: 'a' }} name="Alpha" onToggle={() => {}} />)
    expect(on).toMatch(/role="switch"[^>]*aria-checked="true"|aria-checked="true"[^>]*role="switch"/)
    expect(on).not.toMatch(/st-pill/)
    const off = renderToStaticMarkup(<VisibilityControl x={{ id: 'a', active: false }} name="Alpha" onToggle={() => {}} />)
    expect(off).toMatch(/aria-checked="false"/)
    expect(off).toMatch(/st-pill hidden[\s\S]*Hidden/)
    const draft = renderToStaticMarkup(<VisibilityControl x={{ id: 'a', draft: true, active: false }} name="Alpha" onToggle={() => {}} />)
    expect(draft).toMatch(/st-pill draft/)
    expect(renderToStaticMarkup(<VisibilityControl x={{ id: 'a' }} name="Alpha" busy onToggle={() => {}} />)).toMatch(/disabled/)
  })
  it('blocks: the switch exists only where the person may edit, and a hidden block shows the "Hidden" chip', async () => {
    vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible', body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
    const { BlockSwitch, BlockCard } = await import('../../../components/constructor/Library.jsx')
    const block = { id: 'off-x', focus: 'chest', type: 'strength', ex: [], estimatedMinutes: 20, active: false, official: true }
    const visibility = { can: b => b.id === 'off-x', toggle: vi.fn(), busy: new Set() }
    expect(renderToStaticMarkup(<BlockSwitch b={block} visibility={visibility} />)).toMatch(/aria-checked="false"/)
    expect(renderToStaticMarkup(<BlockSwitch b={{ ...block, id: 'other' }} visibility={visibility} />)).toBe('')
    expect(renderToStaticMarkup(<BlockSwitch b={block} />)).toBe('')
    const card = renderToStaticMarkup(<BlockCard b={block} onPreview={() => {}} visibility={visibility} />)
    expect(card).toMatch(/cx-card off/); expect(card).toMatch(/cx-off">Hidden</)
  })
})
