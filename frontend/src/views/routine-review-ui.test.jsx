import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Routine review notice: what the member sees (Seguimiento, Home) and the staff controls in "Needs attention". Visibility and wording only — the engine is
   covered by lib/routine-review.test.js. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory
const NOW = new Date('2026-10-06T12:00:00')
const addDays = (iso, n) => new Date(Date.parse(iso + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const set = (w, r) => ({ w, r, done: true })
const flat = start => [0, 1, 2, 3, 4].map(i => ({ id: 'w' + i, d: addDays(start, i * 3), routineId: 'r1', entries: [
  { id: 'A', target: { sets: 1, reps: 8 }, sets: [set(60, 8)] }, { id: 'B', target: { sets: 1, reps: 8 }, sets: [set(40, 8)] }] }))
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
}
async function renderView(name, over) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, uxInviteDismissed: true }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia' }))
  await boot()
  const View = (await import(`./${name}.jsx`)).default
  return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>)
}
beforeEach(() => { memory = new Map(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('member', () => {
  const routines = [{ id: 'r1', name: 'Push day', emoji: 'dumbbell', ex: [] }]
  it('Seguimiento shows the notice with the routine, the week, the data-based reason and both actions', async () => {
    const h = await renderView('Seguimiento', { routines, workouts: flat('2026-09-15') })      // 21 days → week 4, flat loads → brought forward
    for (const k of ['Routine review', 'Push day', 'Week 4 with this routine', 'Brought forward: the data shows a plateau.', 'No progress in 2 of 2 exercises', 'View routine']) expect(h).toContain(k)
    expect(h).not.toContain('Routine reviewed')            // only staff can close the review
  })
  it('no notice without a reason: normal progress in week 4, or fewer than 3 sessions', async () => {
    const progressing = flat('2026-09-15').map((w, i) => ({ ...w, entries: [{ id: 'A', target: w.entries[0].target, sets: [set(60 + i * 2.5, 8)] }, { id: 'B', target: w.entries[1].target, sets: [set(40 + i * 2.5, 8)] }] }))
    expect(await renderView('Seguimiento', { routines, workouts: progressing })).not.toContain('Routine review')
    expect(await renderView('Seguimiento', { routines, workouts: flat('2026-09-15').slice(0, 2) })).not.toContain('Routine review')
  })
  it('Home shows one compact notice when a review is due, nothing otherwise', async () => {
    const due = await renderView('Home', { routines, workouts: flat('2026-09-08') })            // 28 days → week 5
    expect(due).toContain('Routine review'); expect(due).toContain('View routine'); expect(due).not.toContain('Routine reviewed')
    expect(await renderView('Home', { routines, workouts: [] })).not.toContain('Routine review')
  })
  it('the member cannot close or edit anything from the notice: no markReviewed / setCycleDates anywhere in the member screens', () => {
    const card = readFileSync(new URL('../components/RoutineReviewCard.jsx', import.meta.url), 'utf8')
    expect(card).not.toMatch(/update\(|routines|onDone|Routine reviewed/)
    for (const f of ['Seguimiento', 'Home']) expect(readFileSync(new URL(`./${f}.jsx`, import.meta.url), 'utf8')).not.toMatch(/markReviewed|setCycleDates|routineReviews/)
  })
})

describe('staff ("Needs attention", admin only)', () => {
  const src = readFileSync(new URL('./AdminAttention.jsx', import.meta.url), 'utf8')
  it('shows the routine, week and reason, with a "Routine reviewed" button that posts to the admin-only endpoint with the member sync', () => {
    expect(src).toContain("a.code === 'routine_review'"); expect(src).toContain("t('Routine reviewed')")
    expect(src).toContain("stateAction('/api/admin/user/routine-reviewed', { id: r.user.id, routineId: a.routineId }, r.sync)")
    expect(src).toContain("if (!user?.admin) return null")
  })
  it('the staff Seguimiento (AdminFollowUp) edits start and review date in place and can close the review', () => {
    const fu = readFileSync(new URL('./AdminFollowUp.jsx', import.meta.url), 'utf8')
    for (const k of ["t('Routine start')", "t('Review date')", "t('Use automatic')", "'routine-cycle'", "'routine-reviewed'", 'type="date"']) expect(fu).toContain(k)
  })
  it('alert text names the routine and its week', async () => {
    memory = new Map(); await boot()
    const { alertText } = await import('./AdminFollowUp.jsx')
    expect(alertText({ code: 'routine_review', name: 'Push day', week: 5 })).toBe('Routine review: Push day (week 5)')
  })
})
