import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Premium sprint: Library / Routines / Programs cards, Seguimiento (member), "Needs attention" (staff), Friends privacy summary, chat polish.
   Presentation over existing data: figures are derived or omitted, empty blocks are not drawn, admin switches win. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, mods
const NOW = new Date('2026-09-09T12:00:00')            // a Wednesday
const wk = (id, d, routineId = 'r1') => ({ id, d, start: 1, end: 3000000, name: 'Push', routineId, prs: [], vol: 100, entries: [{ id: '0025', target: { sets: 3, reps: 5, mode: 'reps' }, sets: [1, 2, 3].map(() => ({ w: 60, r: 5, done: true })) }] })
const R1 = { id: 'r1', name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 5, rest: 120 }, { id: '0032', sets: 3, reps: 8 }], meta: { goal: 'hypertrophy', level: 'intermediate' } }
const R2 = { id: 'r2', name: 'Pull day', emoji: 'dumbbell', ex: [{ id: '0043', sets: 4, reps: 8 }], fav: true }
const R3 = { id: 'r2jp-abc', name: 'Official copy', emoji: 'sparkles', ex: [{ id: '0025', sets: 3 }] }

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  mods = {
    pc: await import('../lib/plan-cards.js'), cards: await import('../components/PlanCards.jsx'), fu: await import('../lib/followup-v3.js'),
    att: await import('../lib/attention.js'), priv: await import('../lib/privacy-summary.js'),
  }
}
async function seed(over = {}, admin = null, user = { id: 'u1', name: 'Ana Socia', username: 'ana' }) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, uxInviteDismissed: true }, over)))
  if (user) memory.set('gym_user', JSON.stringify(user))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
}
const render = async (loader, props) => { await boot(); const View = await loader(); return renderToStaticMarkup(<MemoryRouter><View {...props} /></MemoryRouter>) }
beforeEach(() => { memory = new Map(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Library V3 — routine and program cards derive only what exists', () => {
  it('routine meta: source, exercises, rough minutes, planned day, times trained', async () => {
    await boot()
    const S = { routines: [R1, R2, R3], week: { 3: 'r1', 5: 'r1' }, workouts: [wk('a', '2026-09-01'), wk('b', '2026-09-03')], routineVersions: { r2: [{ versionedAt: 1 }] } }
    const m = mods.pc.routineMeta(R1, S, NOW)
    expect(m).toMatchObject({ source: 'own', exercises: 2, sets: 6, daysPerWeek: 2, done: 2, lastDone: '2026-09-03', goal: 'hypertrophy', level: 'intermediate' })
    expect(m.next).toEqual({ inDays: 0, day: 'We' })
    expect(m.minutes).toBeGreaterThan(10)
    expect(mods.pc.routineSource(R2, S)).toBe('trainer'); expect(mods.pc.routineSource(R3, S)).toBe('2j')
    expect(mods.pc.routineMeta({ id: 'x', name: 'Empty', ex: [] }, S, NOW)).toMatchObject({ exercises: 0, sets: null, minutes: null, next: null, done: 0, lastDone: null })
  })
  it('personal program: progress is "routines trained this week"; next is the first one still to do', async () => {
    await boot()
    const P = { id: 'p1', name: 'Split', routineIds: ['r1', 'r2'], week: { 1: 'r1', 3: 'r2' } }
    const S = { routines: [R1, R2], programs: [P], activeProgramId: 'p1', week: {}, workouts: [wk('a', '2026-09-08', 'r1')] }
    const m = mods.pc.programMeta(P, S, NOW)
    expect(m).toMatchObject({ kind: 'personal', state: 'active', total: 2, done: 1, percent: 50, perWeek: 2 })
    expect(m.nextRoutine.id).toBe('r2')
    expect(mods.pc.programMeta(P, { ...S, activeProgramId: null }, NOW).state).toBe('saved')
  })
  it('cards draw the figures that exist, the source, a Start action — and no empty chips', async () => {
    await seed({ routines: [R1, R2, R3], week: { 3: 'r1' }, workouts: [wk('a', '2026-09-03')] })
    const S = JSON.parse(memory.get('gym_state_v1'))
    const html = renderToStaticMarkup(<MemoryRouter><mods.cards.RoutineCard r={R1} S={S} onOpen={() => {}} onStart={() => {}} onFav={() => {}} onDuplicate={() => {}} /></MemoryRouter>)
    for (const k of ['v3-card', 'Push day', '2 exercises', 'Planned today', 'v3-card-go', 'Mine', 'Duplicate']) expect(html).toContain(k)
    expect(html).not.toContain('0 exercises'); expect(html).not.toMatch(/>\s*<\/span><span class="v3-chip">\s*</)
    const bare = renderToStaticMarkup(<MemoryRouter><mods.cards.RoutineCard r={{ id: 'e', name: 'Empty', ex: [] }} S={S} onOpen={() => {}} onStart={() => {}} onFav={() => {}} onDuplicate={() => {}} /></MemoryRouter>)
    expect(bare).not.toContain('~') ; expect(bare).not.toContain('days/week'); expect(bare).not.toContain('Trained')
    const prog = renderToStaticMarkup(<MemoryRouter><mods.cards.ProgramCard p={{ id: 'p1', name: 'Split', routineIds: ['r1', 'r2'] }} S={{ ...S, programs: [], activeProgramId: 'p1' }} onOpen={() => {}} onContinue={() => {}} /></MemoryRouter>)
    expect(prog).toContain('Active'); expect(prog).toContain('Start Push day'); expect(prog).toContain('2 routines')
  })
  it('the Plan screen lists routines and programs as cards, and keeps its empty states', async () => {
    await seed({ routines: [R1, R2], programs: [{ id: 'p1', name: 'Split', routineIds: [] }], defaultLibraryTab: 'routines' })
    const html = await render(async () => (await import('./Plan.jsx')).default)
    expect(html).toContain('v3-grid'); expect(html).toContain('Push day'); expect(html).toContain('Pull day')
    await seed({ routines: [], programs: [], defaultLibraryTab: 'programs' })
    const empty = await render(async () => (await import('./Plan.jsx')).default)
    expect(empty).not.toContain('v3-card'); expect(empty).toContain('No programs yet.')
  })
})

describe('Seguimiento V3 (member)', () => {
  it('no data → no blocks; with workouts the evolution appears and the comparison needs a real previous stretch', async () => {
    await boot()
    const empty = mods.fu.followupDigest({ workouts: [], routines: [], week: {} }, null, '2026-09-09')
    expect(empty).toMatchObject({ goal: null, evolution: null, review: null, coach: null, empty: true })
    const S = { workouts: [wk('a', '2026-09-01'), wk('b', '2026-09-05')], week: { 1: 'r1', 3: 'r1', 5: 'r1' }, coach: { profile: { goal: 'fatloss' } } }
    const d = mods.fu.followupDigest(S, null, '2026-09-09')
    expect(d.evolution).toMatchObject({ workouts: 2, perWeek: 0.5, planned: 3, prevWorkouts: null })
    expect(d.goal).toBe('Lose fat')
    const d2 = mods.fu.followupDigest({ ...S, workouts: [...S.workouts, wk('c', '2026-08-05')] }, null, '2026-09-09')
    expect(d2.evolution.prevWorkouts).toBe(1)
  })
  it('coach notes and plan changes by staff come from the member’s own state, last 30 days only', async () => {
    await boot()
    const now = Date.parse('2026-09-09T12:00:00Z')
    const S = { workouts: [], routines: [R1, R2], programs: [], coach: { log: [{ at: '2026-09-01', summary: 'More legs', notes: ['Great consistency'], decisions: [{ status: 'accepted' }, { status: 'rejected' }] }] },
      routineVersions: { r1: [{ versionedAt: now - 5 * 86400000 }], r2: [{ versionedAt: now - 90 * 86400000 }] } }
    const d = mods.fu.followupDigest(S, null, '2026-09-09')
    expect(d.coach).toMatchObject({ summary: 'More legs', notes: ['Great consistency'], applied: 1 })
    expect(d.changes.map(c => c.id)).toEqual(['r1'])
  })
  it('the screen shows the check-in when Health is on, drops it when the admin turns it off, and never leaves an empty block', async () => {
    await seed({ workouts: [wk('a', '2026-09-05')], week: { 1: 'r1', 3: 'r1' }, routines: [R1] })
    const on = await render(async () => (await import('./Seguimiento.jsx')).default)
    for (const k of ['My follow-up', 'workouts in 4 weeks', 'checkin']) expect(on).toContain(k)
    expect(on).not.toContain('From your Coach'); expect(on).not.toContain('Plan changes')
    await seed({ workouts: [], routines: [] }, { health: false })
    const off = await render(async () => (await import('./Seguimiento.jsx')).default)
    expect(off).not.toContain('checkin'); expect(off).toContain('Nothing to follow yet')
  })
})

describe('Needs attention (staff) and permissions', () => {
  it('ranks urgent first, then upcoming reviews / inactivity, then on track; sorted by what matters', async () => {
    await boot()
    const row = (id, alerts, nextReview = null) => ({ user: { id, name: id }, alerts, summary: { nextReview, perWeek: 1, plannedPerWeek: 3, lastWorkout: '2026-09-01' } })
    const r = mods.att.rankAttention([
      row('ok', []), row('inactive', [{ code: 'no_recent_workouts', days: 20 }]), row('overdue', [{ code: 'review_overdue', days: 4 }], '2026-09-05'),
      row('pain', [{ code: 'repeated_discomfort', zone: 'knee', n: 3 }, { code: 'review_overdue', days: 1 }], '2026-09-08'), row('soon', [], '2026-09-12'),
    ], '2026-09-09')
    expect(r.urgent.map(x => x.user.id)).toEqual(['pain', 'overdue'])
    expect(r.soon.map(x => x.user.id)).toEqual(['soon', 'inactive'])
    expect(r.onTrack.map(x => x.user.id)).toEqual(['ok'])
  })
  it('the staff view exists only behind the admin route; the member page needs no role', () => {
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).toMatch(/path="\/admin\/attention" element=\{user\?\.admin \? <AdminAttention \/> : <Navigate to="\/home" replace \/>\}/)
    expect(app).toMatch(/path="\/seguimiento" element=\{<Seguimiento \/>\}/)
    expect(readFileSync(new URL('./AdminAttention.jsx', import.meta.url), 'utf8')).toMatch(/if \(!user\?\.admin\) return null/)
  })
  it('a non-admin session renders nothing for the staff view', async () => {
    await seed({}, null, { id: 'u1', name: 'Member', trainer: true })
    const html = await render(async () => (await import('./AdminAttention.jsx')).default)
    expect(html).toBe('')
  })
})

describe('Detail heroes (routine / program editors)', () => {
  it('draw cover, source, only the figures that exist, singular/plural labels and one Start action', async () => {
    await seed({ routines: [R1, R2], week: { 3: 'r1' }, workouts: [wk('a', '2026-09-03')], programs: [{ id: 'p1', name: 'Split', routineIds: ['r1', 'r2'], week: { 1: 'r1' } }], activeProgramId: 'p1' })
    const S = JSON.parse(memory.get('gym_state_v1'))
    const { RoutineHero, ProgramHero } = await import('../components/DetailHeroes.jsx')
    const h = renderToStaticMarkup(<MemoryRouter><RoutineHero r={R1} S={S} /></MemoryRouter>)
    for (const k of ['v3-hero', 'Push day', 'Mine', '2 exercises', '1 day/week', 'Planned today', 'v3-card-go']) expect(h).toContain(k)
    expect(h).not.toContain('1 days/week')
    const bare = renderToStaticMarkup(<MemoryRouter><RoutineHero r={{ id: 'e', name: 'Empty', ex: [] }} S={S} /></MemoryRouter>)
    expect(bare).not.toContain('v3-card-go'); expect(bare).not.toContain('~'); expect(bare).not.toContain('exercises')
    const p = renderToStaticMarkup(<MemoryRouter><ProgramHero p={S.programs[0]} S={S} /></MemoryRouter>)
    for (const k of ['v3-hero', 'Split', 'Active', '2 routines', 'role="progressbar"', 'Start Push day']) expect(p).toContain(k)
    const none = renderToStaticMarkup(<MemoryRouter><ProgramHero p={{ id: 'p2', name: 'Void', routineIds: [] }} S={S} /></MemoryRouter>)
    expect(none).not.toContain('v3-card-go'); expect(none).not.toContain('progressbar')
  })
})

describe('Social V3', () => {
  it('privacy summary reads the existing preferences: what is shared, with whom; health is never listed', async () => {
    await boot()
    expect(mods.priv.privacySummary(null)).toBeNull()
    const s = mods.priv.privacySummary({ privacy: { profile: 'friends', activity: 'nobody', prs: true, achievements: true, routines: false, workouts: false } })
    expect(s).toMatchObject({ profile: 'friends', activity: 'nobody', visibleCount: 2 })
    expect(s.items.map(i => i.key)).toEqual(['prs', 'achievements', 'routines', 'workouts'])
    expect(JSON.stringify(s)).not.toMatch(/health|weight|measure/i)
    const { default: Card } = await import('../components/PrivacySummary.jsx')
    const html = renderToStaticMarkup(<MemoryRouter><Card prefs={{ privacy: { profile: 'private', activity: 'friends', prs: true, achievements: false, routines: true, workouts: false } }} /></MemoryRouter>)
    for (const k of ['What your friends can see', 'Only you', 'Personal records', 'never shared']) expect(html).toContain(k)
  })
  it('the chat keeps its encrypted backend untouched and adds timestamps, an accessible log and a retry for a failed send', () => {
    const chat = readFileSync(new URL('./ChatThread.jsx', import.meta.url), 'utf8')
    for (const k of ['className="chat-time"', 'role="log"', 'setFailed(true)', 'chat-failed']) expect(chat).toContain(k)
    expect(chat).toMatch(/sendMessage\(id, msg\)/)
    expect(readFileSync(new URL('./Friends.jsx', import.meta.url), 'utf8')).toContain('<PrivacySummary />')
  })
})
