import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/* Bunker V2 — the parts of a training panel that show and move through the routine, rendered for real (react-dom/server) from the same shapes the
 * panel passes them. The sync/finish/handoff contracts are covered by api/test/bunker-*.test.js and lib/bunker-persistence.test.js. */
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))), IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

let mod, tools, exlib, supers, memory
async function boot() {
  vi.resetModules(); memory = new Map()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  const { useUI } = await import('../store/useUI.js'); ;(await import('../components/ui.jsx')).bindUI(useUI)
  await (await import('../lib/i18n.js')).setLang('en')
  mod = await import('./BunkerRoutine.jsx'); tools = await import('./BunkerTools.jsx'); exlib = await import('../lib/exercises.js'); supers = await import('../lib/superset-colors.js')
}
afterEach(() => vi.unstubAllGlobals())

const nameOf = id => 'Ex ' + id
const set = done => ({ w: 40, r: 8, done })
const entries = () => [
  { id: '0001', sets: [set(true), set(true)] }, { id: '0002', sets: [set(false), set(false)] },
  { id: '0003', sets: [set(false), set(false)], sg: 's1' }, { id: '0004', sets: [set(true), set(false)], sg: 's1' },
  { id: '0005', sets: [set(false)] }, { id: '0006', sets: [set(false), set(false), set(false)] }, { id: '0007', sets: [set(false)] },
]

describe('the full routine is visible and navigable', () => {
  it('shows all 7 exercises with set counts, marks the current and the next one, and numbers or letters them', async () => {
    await boot()
    const e = entries(), ss = supers.supersetGroupInfo(e)
    const html = renderToStaticMarkup(<mod.BunkerOutline entries={e} cur={1} ssInfo={ss} nameOf={nameOf} onGo={() => {}} />)
    expect((html.match(/role="listitem"/g) || []).length).toBe(7)
    expect(html).toContain('2/2'); expect(html).toContain('0/2'); expect(html).toContain('1/2')
    expect(html).toMatch(/data-state="current"[^>]*aria-current="step"|aria-current="step"[^>]*data-state="current"/)
    expect((html.match(/data-state="next"/g) || []).length).toBe(1)
    expect(html).toContain('>A1<'); expect(html).toContain('>A2<')
    for (const id of ['0001', '0007']) expect(html).toContain('Ex ' + id)
  })
  it('previous / next buttons and the "up next" line follow the cursor; the ends disable the matching button', async () => {
    await boot()
    const mid = renderToStaticMarkup(<mod.BunkerStepper entries={entries()} cur={1} nameOf={nameOf} onGo={() => {}} />)
    expect(mid).toContain('Exercise 2 of 7'); expect(mid).toContain('Up next: Ex 0003'); expect(mid).not.toContain('disabled')
    const first = renderToStaticMarkup(<mod.BunkerStepper entries={entries()} cur={0} nameOf={nameOf} onGo={() => {}} />)
    expect(first).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Previous exercise"/)
    const done = entries().map(x => ({ ...x, sets: x.sets.map(() => set(true)) }))
    expect(renderToStaticMarkup(<mod.BunkerStepper entries={done} cur={6} nameOf={nameOf} onGo={() => {}} />)).toContain('All exercises done')
    expect(renderToStaticMarkup(<mod.BunkerStepper entries={[]} cur={0} nameOf={nameOf} onGo={() => {}} />)).toBe('')
  })
})

describe('supersets', () => {
  it('A/B chips appear for the pair only, mark the one on screen, and show each partner\'s own progress', async () => {
    await boot()
    const e = entries(), ss = supers.supersetGroupInfo(e)
    const html = renderToStaticMarkup(<mod.BunkerSupersetSwitch entries={e} cur={2} ssInfo={ss} nameOf={nameOf} onGo={() => {}} />)
    expect((html.match(/class="bk-ab-chip/g) || []).length).toBe(2)
    expect(html).toMatch(/bk-ab-chip on"[^>]*aria-pressed="true"[\s\S]*A1/); expect(html).toContain('A2')
    expect(html).toContain('0/2'); expect(html).toContain('1/2')
    expect(renderToStaticMarkup(<mod.BunkerSupersetSwitch entries={e} cur={0} ssInfo={ss} nameOf={nameOf} onGo={() => {}} />)).toBe('')
  })
})

describe('exercise image', () => {
  it('uses the library image (gif first, then still) through the library\'s own helpers, never a hardcoded URL', async () => {
    await boot()
    const withGif = exlib.EXDB.find(x => x.gif), onlyImg = exlib.EXDB.find(x => !x.gif && x.img)
    const g = renderToStaticMarkup(<mod.BunkerExerciseMedia ex={withGif} name="Press" />)
    expect(g).toContain('<img'); expect(g).toContain(`src="${exlib.gifSrc(withGif)}"`); expect(g).toContain('alt="Press"')
    if (onlyImg) expect(renderToStaticMarkup(<mod.BunkerExerciseMedia ex={onlyImg} name="Row" />)).toContain(`src="${exlib.imgSrc(onlyImg)}"`)
  })
  it('falls back to a clean placeholder with the name when there is no image or no library entry', async () => {
    await boot()
    for (const ex of [undefined, { id: 'custom-1' }, { id: 'x', n: 'X' }]) {
      const html = renderToStaticMarkup(<mod.BunkerExerciseMedia ex={ex} name="Mi ejercicio" />)
      expect(html).not.toContain('<img'); expect(html).toContain('bk-exmedia-fallback'); expect(html).toContain('aria-label="No image available"'); expect(html).toContain('Mi ejercicio')
    }
  })
})

describe('no routine for today', () => {
  const routines = [{ id: 'r1', name: 'Pecho', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 10, mode: 'reps' }] }, { id: 'r2', name: 'Vacía', ex: [] }]
  const S = () => ({ week: {}, dayPlan: {}, programs: [], activeProgramId: null, routines, unit: 'kg', workouts: [], exWeights: {}, tests: {} })
  it('offers free training and the member\'s own routines (only usable ones); nothing is assigned by showing it', async () => {
    await boot()
    const html = renderToStaticMarkup(<mod.BunkerTodayPicker routines={routines} sessionS={S} onPickRoutine={() => {}} onFreeTraining={() => {}} />)
    expect(html).toContain('What do you want to train today?'); expect(html).toContain('Pecho'); expect(html).not.toContain('Vacía')
    expect(html).toContain('Freestyle workout (pick as you go)')
  })
  it('with no saved routines it still offers free training', async () => {
    await boot()
    const html = renderToStaticMarkup(<mod.BunkerTodayPicker routines={[]} sessionS={S} onPickRoutine={() => {}} onFreeTraining={() => {}} />)
    expect(html).toContain('No saved routines yet.'); expect(html).toContain('Freestyle workout')
  })
  it('picking a routine builds a session object and touches no plan: the member\'s week / dayPlan / programs are exactly as before', async () => {
    await boot()
    const state = S(), before = JSON.stringify(state)
    const a = mod.buildBunkerActive(state, routines[0])
    expect(a.routineId).toBe('r1'); expect(a.entries.length).toBe(1); expect(a.cur).toBe(0)
    expect(Object.keys(a)).not.toEqual(expect.arrayContaining(['week', 'dayPlan', 'programs', 'activeProgramId']))
    expect(JSON.stringify(state)).toBe(before)
  })
})

describe('several members on one screen', () => {
  it('one panel per member, keyed by uid, each handed its own credential; at most three columns; hidden ones stay mounted', async () => {
    await boot()
    const credentials = { a: { token: 'tok-a', name: 'Ana' }, b: { token: 'tok-b', name: 'Beto' }, c: { token: 'tok-c', name: 'Cris' } }
    const seen = []
    const render = active => renderToStaticMarkup(<mod.BunkerPanelGrid credentials={credentials} activeUids={active} renderPanel={(uid, c, hidden) => { seen.push([uid, c.token, hidden]); return <section key={uid} data-uid={uid} data-token={c.token} data-hidden={String(hidden)} /> }} />)
    const three = render(['a', 'b', 'c'])
    expect(three).toContain('users-3'); expect((three.match(/data-uid=/g) || []).length).toBe(3)
    expect(seen.map(([u, t]) => `${u}:${t}`)).toEqual(['a:tok-a', 'b:tok-b', 'c:tok-c'])
    seen.length = 0
    const one = render(['b'])
    expect(one).toContain('users-1'); expect((one.match(/data-uid=/g) || []).length).toBe(3)
    expect(seen.filter(([, , h]) => !h).map(([u]) => u)).toEqual(['b'])
    expect(render(['a', 'b', 'c', 'x'])).toContain('users-3')
  })
})

describe('the toolbar stays generic', () => {
  it('Library, Plates, 1RM, Timer and Warm-up, a room title and the admin gear: nothing about whoever is training', async () => {
    await boot()
    const html = renderToStaticMarkup(<tools.BunkerTopBar active="training" onSelect={() => {}} header="2J Fitness Center" paired={null} onAdmin={() => {}} onExitTap={() => {}} />)
    for (const label of ['Library', 'Plates', '1RM', 'Timer', 'Warm-up']) expect(html.toLowerCase()).toContain(label.toLowerCase())
    expect((html.match(/bk-topbar-tab/g) || []).length).toBeGreaterThanOrEqual(5)
    expect(html).toContain('2J Fitness Center')
    for (const who of ['Ana', 'Beto', 'tok-', 'uid']) expect(html).not.toContain(who)
  })
})
