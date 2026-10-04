import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Mi 2J — the screens and the real finish flow, rendered over the real store and booted from
 * storage exactly like a reopen (same harness as Workout.test.jsx). The network is down the
 * whole time: every call rejects, so this is also the offline path. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, ui, sheets, views
const BENCH = '0025'
const wk = (id, d, sets, prs = []) => ({ id, d, start: 1, end: 2, name: 'Pecho', prs, vol: 1,
  entries: [{ id: BENCH, target: { sets: sets.length, reps: 5, mode: 'reps' }, sets: sets.map(([w, r]) => ({ w, r, done: true })) }] })

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  ;({ useStore: store } = await import('../store/useStore.js'))
  ;({ useUI: ui } = await import('../store/useUI.js'))
  ;(await import('../components/ui.jsx')).bindUI(ui)
  sheets = await import('../sheets.jsx')
  views = {
    Mi2J: (await import('./Mi2J.jsx')).default,
    Records: (await import('./Records.jsx')).default,
    Home: (await import('./Home.jsx')).default,
    Stats: (await import('./Stats.jsx')).default,
  }
}
async function seed(over = {}) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, bodyweight: [{ d: '2026-09-01', w: 80, t: 1 }] }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  await boot()
}
const render = async View => { await boot(); return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>) }
const journalOps = () => { const r = memory.get('gym_sync_v2:u1'); return r ? JSON.parse(r).operations : [] }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Mi 2J screens read the real store', () => {
  it('a new member: carnet with the overall rank still locked and an inviting empty state — no zeros wall', async () => {
    await seed()
    const html = await render(views.Mi2J)
    expect(html).toContain('v3-pass')      // Mi 2J V2: the athlete passport (the compact carnet still lives in Profile)
    expect(html).toContain('Ana Socia')
    expect(html).toMatch(/v3-pass-lock[\s\S]*0\/6/)
    expect(html).toContain('Your journey starts here')
    expect(html).toContain('Start training')
    expect(html).not.toContain('m2-ranks')
    for (const to of ['My ranks', 'My achievements', 'My records', 'Progress']) expect(html).toContain(to)
  })
  it('with history: group ranks with their real emblem, latest records, and no empty state', async () => {
    await seed({ workouts: [wk('a', '2026-09-02', [[80, 5]]), wk('b', '2026-09-09', [[85, 5]], [BENCH])] })
    const html = await render(views.Mi2J)
    expect(html).toContain('m2-ranks')
    expect(html).toMatch(/\/ranks\/rank_[a-z]+_[123]\.webp/)
    expect(html).toContain('Latest records')
    expect(html).not.toContain('Your journey starts here')
  })
  it('records keep a real record and an estimated 1RM visibly apart', async () => {
    await seed({ workouts: [wk('a', '2026-09-02', [[80, 5]]), wk('b', '2026-09-09', [[85, 3]], [BENCH])] })
    const html = await render(views.Records)
    expect(html).toMatch(/rec-k"><svg[\s\S]*?Record<\/span><span class="rec-v">85/)
    expect(html).toMatch(/rec-k est"[\s\S]*?e1RM/)
    expect(html).toContain('Before: 80 kg × 5')
    await seed()
    expect(await render(views.Records)).toContain('No records yet')
  })
})

describe('Home shows only what is relevant', () => {
  it('new member: no week/advance/goal cards; with history: your week on Home, the latest step forward in Progress', async () => {
    await seed()
    let html = await render(views.Home)
    expect(html).not.toContain('Your week')
    expect(html).not.toContain('Latest step forward')
    await seed({ workouts: [wk('a', '2026-09-02', [[80, 5]]), wk('b', '2026-09-09', [[85, 5]], [BENCH])] })
    html = await render(views.Home)
    expect(html).toContain('Your week')
    expect(html).toMatch(/2 weeks in a row/)
    // Adaptive UX: Home stays simple — the latest step forward moved to Progress (views/Stats.jsx).
    expect(html).not.toContain('Latest step forward')
    html = await render(views.Stats)
    expect(html).toMatch(/Latest step forward[\s\S]*New record/)
  })
})

describe('finishing a workout (offline) — celebrate once, sync once, never twice', () => {
  const active = () => ({ id: 'live', d: '2026-09-09', start: Date.now() - 3600e3, routineId: null, name: 'Pecho', cur: 0,
    entries: [{ id: BENCH, target: { sets: 1, reps: 5, mode: 'reps' }, sets: [{ w: 90, r: 5, done: true }] }] })

  it('derives the moments, keeps only an unseen marker, shows them after a reopen, then never again', async () => {
    await seed({ workouts: [wk('a', '2026-09-02', [[80, 5]])], active: active() })
    store.getState().setUser({ id: 'u1', name: 'Ana Socia' })
    sheets.finishWorkout()
    const S = store.getState().S
    expect(S.active).toBeNull()
    expect(S.workouts.map(w => w.id)).toEqual(['a', 'live'])
    // Hero first (a new rank family), then the summary behind it.
    expect(ui.getState().sheets.length).toBeGreaterThanOrEqual(1)
    expect(JSON.parse(memory.get('gym_mi2j_pending:u1'))).toMatchObject({ workoutId: 'live' })
    // The journal carries the workout like any finish — and nothing about celebrations.
    const ops = journalOps()
    expect(ops.length).toBe(1)
    expect(JSON.stringify(ops)).not.toMatch(/mi2j|celebrat|pending/i)

    // App killed before the summary was dismissed → reopen (still offline): shown again, once.
    ui.getState().closeAll()
    await boot()
    sheets.showPendingCelebration()
    expect(ui.getState().sheets.length).toBe(1)
    const { markSeen } = await import('../lib/celebrations.js')
    markSeen(localStorage, 'u1', 'live')                             // what "Continue" does
    ui.getState().closeAll()

    // Reopen again / the connection comes back: nothing re-announces the same workout.
    await boot()
    sheets.showPendingCelebration()
    expect(ui.getState().sheets.length).toBe(0)
    expect(store.getState().S.workouts.filter(w => w.id === 'live')).toHaveLength(1)
  })
})
