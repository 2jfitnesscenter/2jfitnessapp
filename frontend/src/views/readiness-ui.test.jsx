import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Readiness card (Home compact / Seguimiento full) and the staff signal. Decisions are covered by lib/readiness.test.js. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory
const NOW = new Date('2026-10-20T12:00:00')
const TODAY = '2026-10-20'
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const set = (w, r, extra = {}) => ({ w, r, done: true, ...extra })
const sessions = extra => [0, 1, 2, 3, 4, 5].map(i => ({ id: 'f' + i, d: addDays(TODAY, -(6 - i) * 3), entries: ['0025', '0032'].map(id => ({ id, target: { id, sets: 2, reps: 8 }, sets: [set(60, 8, extra(i, id)), set(60, 8, extra(i, id))] })) }))
const highWorkouts = () => sessions((i, id) => ({ rpe: 7 + i / 2, feel: i >= 4 && id === '0025' ? 'fail' : i >= 3 ? 'hard' : 'good' }))
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
}
async function renderView(name, over, admin = null) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, uxInviteDismissed: true }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia' }))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
  const View = (await import(`./${name}.jsx`)).default
  return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>)
}
beforeEach(() => { memory = new Map(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('member', () => {
  it('Seguimiento shows the state, real reasons and the deload PROPOSAL with Apply / Keep (nothing applied yet)', async () => {
    const h = await renderView('Seguimiento', { workouts: highWorkouts() })
    for (const k of ['Today’s readiness', 'Deload / recover', 'A lighter week could help', 'Apply deload', 'Keep my plan', 'Your routines are not changed']) expect(h).toContain(k)
    expect(h).toMatch(/v3-rd-score/)
    expect(h).not.toContain('Deload week until')
  })
  it('an accepted deload shows as an active, reversible week', async () => {
    const h = await renderView('Seguimiento', { workouts: highWorkouts(), deload: { from: TODAY, until: addDays(TODAY, 7), volumeCut: 0.35, loadCut: 0.075, rir: 3 } })
    expect(h).toContain('Deload week until'); expect(h).toContain('Back to my normal plan'); expect(h).not.toContain('Apply deload')
  })
  it('an ordinary training log with effort shows a calm state and no proposal; no data shows no card', async () => {
    const h = await renderView('Seguimiento', { workouts: sessions(() => ({ rpe: 8, feel: 'good' })) })
    expect(h).toContain('Today’s readiness'); expect(h).toMatch(/Keep steady|Good to push/); expect(h).not.toContain('Apply deload')
    expect(await renderView('Seguimiento', { workouts: [] })).not.toContain('Today’s readiness')
  })
  it('Home shows the compact card; the admin switching recovery off removes it everywhere', async () => {
    expect(await renderView('Home', { workouts: highWorkouts() })).toContain('Today’s readiness')
    expect(await renderView('Home', { workouts: highWorkouts() }, { recovery: false })).not.toContain('Today’s readiness')
    expect(await renderView('Seguimiento', { workouts: highWorkouts() }, { recovery: false })).not.toContain('Today’s readiness')
  })
})

describe('staff signal', () => {
  it('the staff follow-up names the fatigue signals and mentions the proposal (the triage side is covered in api/test/coach-followup.test.js)', async () => {
    memory = new Map(); await boot()
    const { alertText } = await import('./AdminFollowUp.jsx')
    const a = { code: 'fatigue_high', points: 7, proposed: true, signals: [{ code: 'effort_up' }, { code: 'hard' }] }
    const text = alertText(a)
    expect(text).toContain('Accumulated fatigue is high'); expect(text).toContain('harder effort at the same loads'); expect(text).toContain('A deload has been proposed')
  })
  it('the staff cannot apply a deload: only the member screens write S.deload', () => {
    const read = f => readFileSync(new URL(f, import.meta.url), 'utf8')
    for (const f of ['./AdminAttention.jsx', './AdminFollowUp.jsx']) expect(read(f)).not.toMatch(/applyDeload|S\.deload|cancelDeload/)
    expect(read('../components/ReadinessSection.jsx')).toMatch(/applyDeload/)
  })
})
