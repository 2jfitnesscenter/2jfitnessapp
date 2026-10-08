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
  it('an active multi-day program gives the member one program notice, not a card per routine', async () => {
    const routines = [0, 1, 2, 3].map(i => ({ id: 'day' + i, name: 'Program day ' + i, ex: [] }))
    const program = { id: 'member-program', catalogId: 'g2j-strength', source: 'guided-v2', status: 'active', name: 'Strength block', startedAt: Date.parse('2026-09-08T12:00:00Z'), weeks: [{ sessions: routines.map((r, i) => ({ day: i, routineId: r.id })) }] }
    const workouts = routines.map((r, i) => ({ id: 'pw' + i, d: addDays('2026-09-08', i + 1), routineId: r.id, src2j: { program: { programId: program.id, sessionId: `1:${i}:${i}` } }, entries: [] }))
    const h = await renderView('Home', { routines, programs: [program], activeProgramId: program.id, workouts,
      routineReviews: Object.fromEntries(routines.map(r => [r.id, { reviewedAt: '2026-09-08' }])) })
    expect(h).toContain('Program review'); expect(h).toContain('Strength block')
    expect(h.match(/Routine review/g)).toBeNull()
    expect(h).not.toContain('Program day')
  })
  it('a persisted reviewed program has no member card until the inclusive nextReviewAt, then returns once', async () => {
    const program = { id: 'member-program', catalogId: 'g2j-strength', source: 'guided-v2', status: 'active', name: 'Strength block',
      startedAt: Date.parse('2026-09-08T12:00:00Z'), weeks: [{ sessions: [{ day: 0, routineId: 'r1' }, { day: 1, routineId: 'r2' }] }] }
    const persistedReview = { 'member-program': { lastReviewAt: '2026-10-06', nextReviewAt: '2026-11-03', by: 'trainer1', n: 1 } }
    const reviewed = { routines: [{ id: 'r1', name: 'Day 1', ex: [] }, { id: 'r2', name: 'Day 2', ex: [] }],
      programs: [program], activeProgramId: program.id, programReviews: persistedReview }

    for (const surface of ['Home', 'Seguimiento']) {
      const html = await renderView(surface, reviewed) // models the reloaded, persisted state
      expect(html).not.toContain('Program review')
      expect(html).not.toContain('Program reviewed')
      expect(html).not.toContain('Week 5 with this program')
      expect(html).not.toContain('time to review it')
    }

    vi.setSystemTime(new Date('2026-11-03T12:00:00'))
    const due = await renderView('Seguimiento', reviewed)
    expect(due).toContain('Program review')
    expect(due).toContain('Strength block')
    expect(due.match(/class="v2-surface v3-rr"/g)).toHaveLength(1)
  })
  it('legacy program memberships render as one review in Home and Seguimiento, then close until nextReviewAt', async () => {
    const ids = ['shoulder-push', 'lower', 'shoulder-pull']
    const start = '2026-09-01'
    const program = { id: 'legacy-shoulder-program', status: 'active', source: 'guided-v2', name: 'Shoulder care · Block 1',
      startedAt: Date.parse(start + 'T12:00:00Z'), routineSnapshots: Object.fromEntries(ids.map(id => [id, { id }])) }
    const legacy = { routines: ids.map((id, i) => ({ id, name: `Legacy day ${i + 1}`, ex: [] })), programs: [program], activeProgramId: program.id,
      workouts: ids.map((routineId, i) => ({ id: `old-${i}`, routineId, d: addDays(start, i + 1), entries: [] })),
      routineReviews: Object.fromEntries(ids.map(id => [id, { startOverride: start, dueOverride: '2026-09-29', manualBy: 'staff' }])) }

    for (const surface of ['Home', 'Seguimiento']) {
      const before = await renderView(surface, legacy)
      expect(before).toContain('Program review')
      expect(before).toContain('Shoulder care · Block 1')
      expect(before).not.toContain('Routine review')

      const closed = { ...legacy, programReviews: { [program.id]: { lastReviewAt: '2026-10-06', nextReviewAt: '2026-11-03', by: 'trainer1', n: 1 } } }
      expect(await renderView(surface, closed)).not.toContain('Program review')
    }
    vi.setSystemTime(new Date('2026-11-03T12:00:00'))
    const due = await renderView('Seguimiento', { ...legacy, programReviews: { [program.id]: { lastReviewAt: '2026-10-06', nextReviewAt: '2026-11-03', by: 'trainer1', n: 1 } } })
    expect(due).toContain('Program review')
    expect(due.match(/class="v2-surface v3-rr/g)).toHaveLength(1)
  })
  it('a persisted independent routine is absent during its plateau-protected interval and visible at nextReviewAt', async () => {
    const reviewedAt = '2026-09-15'
    const reviewed = { routines, workouts: flat('2026-09-16'), routineReviews: { r1: { reviewedAt, by: 'trainer1', n: 1 } } }
    const html = await renderView('Seguimiento', reviewed) // plateau remains true, but this is before the next review date
    expect(html).not.toContain('Routine review')
    expect(html).not.toContain('Routine reviewed')
    vi.setSystemTime(new Date('2026-10-13T12:00:00'))
    const due = await renderView('Seguimiento', reviewed)
    expect(due).toContain('Routine review')
    expect(due).toContain('Push day')
  })
  it('staff cycle cards hide a reviewed cycle until its next review date', () => {
    const fu = readFileSync(new URL('./AdminFollowUp.jsx', import.meta.url), 'utf8')
    expect(fu).toContain('const visibleCycles = cycles.filter(c => !c.reviewed)')
    expect(fu).toContain('{visibleCycles.map(c =>')
  })
  it('staff Follow-up renders no closed legacy routine cards and shows the program again when due', async () => {
    memory = new Map(); await boot()
    const { RoutineCycles } = await import('./AdminFollowUp.jsx')
    const cycles = [
      { kind: 'program', programId: 'legacy-p', routineIds: ['r1', 'r2', 'r3'], name: 'Shoulder care', reviewed: true, nextReviewAt: '2026-11-03' },
      { kind: 'routine', routineId: 'r1', name: 'Old duplicate', reviewed: true, nextReviewAt: '2026-11-03' },
    ]
    const html = renderToStaticMarkup(<MemoryRouter><RoutineCycles id="member" cycles={cycles} setData={() => {}} /></MemoryRouter>)
    expect(html).toBe('')
    const due = renderToStaticMarkup(<MemoryRouter><RoutineCycles id="member" cycles={[{ ...cycles[0], reviewed: false, status: 'due' }]} setData={() => {}} /></MemoryRouter>)
    expect(due).toContain('Shoulder care')
    expect(due).toContain('Program reviewed')
  })
  it('the member cannot close or edit anything from the notice: no markReviewed / setCycleDates anywhere in the member screens', () => {
    const card = readFileSync(new URL('../components/RoutineReviewCard.jsx', import.meta.url), 'utf8')
    expect(card).not.toMatch(/update\(|routines|onDone|Routine reviewed/)
    for (const f of ['Seguimiento', 'Home']) expect(readFileSync(new URL(`./${f}.jsx`, import.meta.url), 'utf8')).not.toMatch(/markReviewed|setCycleDates|routineReviews/)
  })
})

describe('staff ("Needs attention", admin only)', () => {
  const src = readFileSync(new URL('./AdminAttention.jsx', import.meta.url), 'utf8')
  it('the staff sheet mounts the review editor ("Routine reviewed" posts to the admin-only endpoint with the member sync) behind the admin gate', () => {
    const sheet = readFileSync(new URL('../components/coach/CoachMember.jsx', import.meta.url), 'utf8')
    expect(sheet).toContain('<RoutineCycles id={id} cycles={d.routineCycles} sync={d.sync}')
    const fu = readFileSync(new URL('./AdminFollowUp.jsx', import.meta.url), 'utf8')
    expect(fu).toContain("t('Program reviewed')"); expect(fu).toContain("t('Routine reviewed')"); expect(fu).toContain("'routine-reviewed'")
    expect(fu).toContain('{ programId: c.programId } : { routineId: c.routineId }')
    expect(src).toContain('if (!user?.admin) return null')
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
