import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* What the staff sees of a member's Premium program: a line on the follow-up card and a section on the member sheet (read-only, with the warning). */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

async function boot() {
  vi.resetModules()
  const memory = new Map([['gym_user', JSON.stringify({ id: 'ad', name: 'Staff', admin: true, trainer: true })]])
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } }, documentElement: { lang: 'en' } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js'); (await import('../components/ui.jsx')).bindUI(useUI)
}
afterEach(() => vi.unstubAllGlobals())
const html = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)

const run = { programId: 'premium-531', version: 1, name: '5/3/1', status: 'active', phase: 'Week 2 · 3s', cycle: 3, week: 2, weeks: 4, session: 'squat', label: '5/3/1 · C3 · W2/4',
  completedInCycle: 5, totalInCycle: 16, adherence: { done: 21, expected: 24, pct: 88 }, methodState: { unit: 'kg', trainingMax: { squat: 105, bench: 72.5 } },
  lastAmrap: [{ exercise: '0025', w: 60, reps: 9, d: '2026-10-02' }], adaptations: 1, incidents: ['skipped'] }

describe('Premium in the Coach screens', () => {
  it('the member sheet section names program, version, phase, cycle, week, adherence, Training Max, incidents and warns about changing the method', async () => {
    await boot()
    const { PremiumRun } = await import('../components/coach/CoachMember.jsx')
    const h = html(<PremiumRun p={run} />)
    for (const k of ['5/3/1 · version 1', '5/3/1 · Cycle 3 · Week 2/4 · Week 2 · 3s', '5 of 16', '88% · 21 of 24 sessions', 'squat 105 kg', 'bench 72.5 kg', 'Sessions skipped', 'may affect the method', 'Supplementary work, cardio and scheduling stay open to you.']) expect(h, k).toContain(k)
  })
  it('the follow-up card shows "5/3/1 · Cycle 3 · Week 2/4", and paused when it is', async () => {
    await boot()
    const { BoardBody } = await import('../components/coach/CoachBoard.jsx')
    const r = id => ({ id, name: 'ana lopez', avatar: null, level: 'normal', goal: { key: 'hypertrophy', label: null, priority: 'normal', source: 'member' }, signals: [], signalCount: 0,
      adherence: { pct28: 80, done28: 8, planned28: 10, pct7: 100, done7: 2, planned7: 2, trend: 'flat' }, lastWorkout: '2026-10-19', daysSince: 1, nextReview: null, reviewIn: null, flagged: false, followUpActive: false,
      premium: { name: '5/3/1', version: 1, cycle: 3, week: 2, weeks: 4, status: id === 'p' ? 'paused' : 'active', label: '5/3/1 · C3 · W2/4' } })
    const board = ids => ({ today: '2026-10-20', scope: 'all', assigned: ids.length, counts: { attention: 0, upcoming: 0, stable: ids.length }, attention: [], upcoming: [], stable: ids.map(r) })
    const a = html(<BoardBody d={board(['a'])} shown="stable" />)
    expect(a).toContain('5/3/1 · Cycle 3 · Week 2/4'); expect(a).not.toContain('Paused')
    expect(html(<BoardBody d={board(['p'])} shown="stable" />)).toContain('Paused')
  })
})
