import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/* Bunker V2.1 — the compact multi-member grid: facts per card, density for 1/3/6/10 members at 1920×1080 and 1366×768, expand/collapse, no big image. */
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))), IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
let mod, nav, supers, memory
async function boot() {
  vi.resetModules(); memory = new Map()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), innerWidth: 1920, innerHeight: 1080 })
  const { useUI } = await import('../store/useUI.js'); ;(await import('../components/ui.jsx')).bindUI(useUI)
  await (await import('../lib/i18n.js')).setLang('en')
  mod = await import('./BunkerRoutine.jsx'); nav = await import('../lib/bunker-nav.js'); supers = await import('../lib/superset-colors.js')
}
afterEach(() => vi.unstubAllGlobals())
const set = (done, extra = {}) => ({ w: 40, r: 8, done, ...extra })
const entries = () => [
  { id: '0001', target: { sets: 3, reps: 8, targetRepsMin: 8, targetRepsMax: 10, mode: 'reps', note: 'RPE 8 · descanso 2:00' }, sets: [set(true), set(false), set(false)] },
  { id: '0003', sg: 's1', target: { sets: 2, reps: 12, mode: 'reps' }, sets: [set(false, { rpe: 7.5 }), set(false)] },
  { id: '0004', sg: 's1', target: { sets: 2, reps: 12, mode: 'reps' }, sets: [set(false), set(false)] },
  { id: '0005', target: { sets: 1, mode: 'cardio' }, sets: [{ min: 20, speed: 9, done: false }] },
]

describe('what a compact card knows', () => {
  it('position, current set, target range, planned RPE, next exercise', async () => {
    await boot()
    const f = nav.compactFacts(entries(), 0)
    expect(f).toMatchObject({ position: 1, total: 4, setNo: 2, setTotal: 3, target: { mode: 'reps', sets: 3, reps: '8-10' }, nextId: '0003' })
    expect(f.rpe).toEqual({ kind: 'rpe', value: 8, planned: true })
  })
  it('the logged effort of the working set wins; a superset exposes its partners; cardio shows minutes; nothing left → no next', async () => {
    await boot()
    const e = entries()
    const f = nav.compactFacts(e, 1, { effortKind: 'rpe' })
    expect(f.rpe).toEqual({ kind: 'rpe', value: 7.5 }); expect(f.unit).toEqual([1, 2]); expect(f.nextId).toBe('0005')
    expect(nav.compactFacts(e, 3).target).toEqual({ mode: 'cardio', min: 20 })
    const done = e.map(x => ({ ...x, sets: x.sets.map(s => ({ ...s, done: true })) }))
    expect(nav.compactFacts(done, 3).nextId).toBeNull(); expect(nav.compactFacts([], 0)).toBeNull()
  })
})

describe('density for a wall screen', () => {
  it('1, 3, 6 and 10 members: few rows, readable columns on 1920×1080 and on 1366×768', async () => {
    await boot()
    const big = n => nav.compactCols(n, 1920, 1080), small = n => nav.compactCols(n, 1366, 768)
    expect([1, 3, 6, 10].map(big)).toEqual([1, 2, 3, 5]); expect([1, 3, 6, 10].map(small)).toEqual([1, 2, 2, 4])
    for (const n of [6, 10]) { expect(Math.ceil(n / big(n))).toBeLessThanOrEqual(2); expect(Math.ceil(n / small(n))).toBeLessThanOrEqual(3); expect(1366 / small(n)).toBeGreaterThan(300) }
  })
})

describe('the compact card and grid', () => {
  const card = props => renderToStaticMarkup(<mod.BunkerCompactCard name="Ana" routineName="Torso" exName="Remo" nextName="Press" onOpen={() => {}} {...props} />)
  it('shows name, exercise, set, target, RPE, superset letter with its partner, position, next and progress — and no exercise image', async () => {
    await boot()
    const e = entries(), ss = supers.supersetGroupInfo(e), facts = nav.compactFacts(e, 1, { effortKind: 'rpe' })
    const html = card({ facts, ssLabel: supers.supersetLabel(ss[1]), partner: 'A2 Ex 0004', progress: { percent: 40 }, rest: <span className="bk-ring">45</span> })
    expect(html).toContain('Ana'); expect(html).toContain('Remo'); expect(html).toContain('>A1<'); expect(html).toContain('⇄ A2 Ex 0004')
    expect(html).toContain('Set 1 of 2'); expect(html).toContain('2 × 12'); expect(html).toContain('RPE 7.5'); expect(html).toContain('Exercise 2 of 4'); expect(html).toContain('Up next: Press')
    expect(html).toContain('bk-ring'); expect(html).toContain('aria-valuenow="40"'); expect(html).toContain('role="button"')
    expect(html).not.toContain('<img'); expect(html).not.toContain('bk-exmedia')
  })
  it('a hidden card stays mounted but not shown; a pending connection is flagged', async () => {
    await boot()
    expect(card({ facts: nav.compactFacts(entries(), 0), hidden: true })).toContain('display:none')
    expect(card({ facts: null, warn: 'Changes pending' })).toContain('Changes pending')
  })
  it('compact grid: all members as cards with the density variables; expanding one shows only its full panel (others stay mounted, hidden); collapse returns to the grid', async () => {
    await boot()
    const credentials = Object.fromEntries(Array.from({ length: 10 }, (_, i) => ['u' + i, { token: 't' + i, name: 'M' + i }]))
    const all = Object.keys(credentials)
    const seen = []
    const render = props => { seen.length = 0; return renderToStaticMarkup(<mod.BunkerPanelGrid credentials={credentials} activeUids={all} compact {...props} renderPanel={(uid, c, hidden, m) => { seen.push([uid, hidden, m.compact, m.focused]); return <i key={uid} data-uid={uid} data-hidden={String(hidden)} /> }} />) }
    const grid = render({})
    expect(grid).toContain('bk-multi-grid compact'); expect(grid).not.toContain('dense'); expect(grid).toContain('--cols:5'); expect(grid).toContain('data-layout="compact"')   // 1920×1080: roomy cards
    window.innerWidth = 1366; window.innerHeight = 768
    const small = render({})
    expect(small).toContain('bk-multi-grid compact dense'); expect(small).toContain('--cols:4')   // 1366×768: denser, still readable
    window.innerWidth = 1920; window.innerHeight = 1080
    expect(seen.every(([, hidden, compact]) => !hidden && compact)).toBe(true); expect(seen).toHaveLength(10)
    const focused = render({ focusUid: 'u3' })
    expect(focused).toContain('users-1'); expect(focused).toContain('data-layout="normal"'); expect(focused).not.toContain('compact dense')
    expect(seen.filter(([, hidden]) => !hidden).map(([u, , , f]) => [u, f])).toEqual([['u3', true]])
    expect(seen.filter(([u]) => u !== 'u3').every(([, hidden, compact]) => hidden && compact)).toBe(true)   // the others stay mounted as compact cards (no idle minimise)
    expect(render({})).toContain('bk-multi-grid compact')
  })
  it('without compact the old grid is untouched', async () => {
    await boot()
    const credentials = { a: { token: 'x', name: 'A' }, b: { token: 'y', name: 'B' } }
    const html = renderToStaticMarkup(<mod.BunkerPanelGrid credentials={credentials} activeUids={['a', 'b']} renderPanel={(uid, c, hidden, m = {}) => <i key={uid} data-compact={String(!!m.compact)} />} />)
    expect(html).toContain('users-2'); expect(html).toContain('data-compact="false"'); expect(html).not.toContain('data-layout="compact"')
  })
})
