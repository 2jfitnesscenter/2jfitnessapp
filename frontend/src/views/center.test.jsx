import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* The console's three views, rendered from the shapes /api/center/* returns (the endpoints themselves are covered in api/test/center-console.test.js). */
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))), IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
let memory, mod, i18n
async function boot(user = { id: 'admin', name: 'Admin', admin: true }) {
  vi.resetModules(); memory = new Map()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  memory.set('gym_user', JSON.stringify(user))
  const { useUI } = await import('../store/useUI.js'); ;(await import('../components/ui.jsx')).bindUI(useUI)
  i18n = await import('../lib/i18n.js'); await i18n.setLang('en')
  mod = await import('./Center.jsx')
}
afterEach(() => vi.unstubAllGlobals())
const render = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)
const sig = { id: 'absence', severity: 'review', explanation: 'No workouts in the last {0} days.', args: [40] }
const today = {
  today: '2026-10-10', days: 7, scope: 'all', members: 12,
  activity: { activeNow: 2, trainedToday: 3, trained7d: 7, trained30d: 10, newMembers: 1, neverTrained: 2 },
  activeNow: [{ id: 'm3', name: 'Marcos', avatar: null, workout: 'Push day' }],
  attention: { count: 9, list: [{ id: 'm2', name: 'Marta', avatar: null, level: 'review', signals: [sig], daysSince: 40, reviewIn: null, nextReview: null }] },
  upcoming: { count: 1, list: [{ id: 'm1', name: 'Mario', avatar: null, level: 'normal', signals: [], daysSince: 1, reviewIn: 2, nextReview: '2026-10-12' }] },
  newMembers: { count: 1, list: [{ id: 'm4', name: 'Maria', avatar: null, created: '2026-10-07', workoutCount: 0 }] },
  idle: { count: 11, list: [{ id: 'm2', name: 'Marta', avatar: null, daysSince: 40, lastWorkoutAt: '2026-08-31' }] },
}

describe('Hoy', () => {
  it('shows the six blocks from the data it was given, with the engine\'s reason and honest wording about activity', async () => {
    await boot()
    const h = render(<mod.TodayView d={today} days={7} onDays={() => {}} openMember={() => {}} goMembers={() => {}} />)
    for (const text of ['Training now', 'Need attention', 'Upcoming reviews', 'New members', 'Not training', 'Push day', 'Marta', 'No workouts in the last 40 days.', '40 days ago', 'In 2 days', 'Maria', 'No workouts yet']) expect(h).toContain(text)
    expect(h).toContain('12 members in the centre'); expect(h).toContain('Activity is the last workout, not the last sync.')
    expect(h).toContain('See all in Members')          // 9 need attention, 1 shown
    expect(h).not.toMatch(/NaN|undefined|Invalid Date/)
    expect(h).not.toMatch(/active/i)           // "active" is never used for activity
  })
  it('a trainer\'s scope reads "assigned to you", and an empty block says so instead of staying blank', async () => {
    await boot()
    const empty = { ...today, scope: 'assigned', members: 3, activeNow: [], attention: { count: 0, list: [] }, upcoming: { count: 0, list: [] }, newMembers: { count: 0, list: [] }, idle: { count: 0, list: [] } }
    const h = render(<mod.TodayView d={empty} days={14} onDays={() => {}} openMember={() => {}} goMembers={() => {}} />)
    expect(h).toContain('3 members assigned to you'); expect(h).toContain('Nobody needs attention'); expect(h).toContain('Everybody has trained recently'); expect(h).not.toContain('See all in Members')
  })
})

const member = (id, name, extra = {}) => ({ id, name, avatar: null, assigned: true, role: 'member', disabled: false, created: '2025-01-01', assignedTrainers: [], workoutCount: 4, lastWorkoutAt: '2026-10-09', activeNow: false, live: null, ...extra })
const roster = { scope: 'all', admin: true, today: '2026-10-10', trainers: [{ id: 't1', name: 'Coach Uno' }], users: [
  member('a', 'Ana', { assignedTrainers: [{ id: 't1', name: 'Coach Uno' }], lastSync: 1 }), member('b', 'Beto', { lastWorkoutAt: '2026-09-20' }), member('c', 'Cris', { activeNow: true, live: { name: 'Push day' } }),
  member('f', 'Fran', { disabled: true }), member('t', 'Tina', { role: 'trainer' }), { id: 'g', name: 'Gus', avatar: null, assigned: false, assignedTrainers: [{ id: 't2', name: 'Coach Dos' }] }] }
const filters = (over = {}) => ({ q: '', status: 'all', trainer: '', role: '', scope: 'assigned', ...over })

describe('Miembros', () => {
  it('one list: role, status, trainer, last real activity, and a way in to the follow-up and (admin) the profile', async () => {
    await boot()
    const h = render(<mod.MembersView data={roster} today={roster.today} admin filters={filters()} setFilters={() => {}} onFollow={() => {}} onProfile={() => {}} />)
    for (const text of ['Ana', 'Trainer: Coach Uno', 'Last workout yesterday', 'Last workout 20 days ago', 'Training now · Push day', 'Disabled', 'Trainer</span>', 'No trainer assigned']) expect(h).toContain(text)
    expect(h).toContain('aria-label="Follow-up of Ana"'); expect(h).toContain('aria-label="Profile of Ana"')
    expect(h).toContain('Any trainer'); expect(h).toContain('Any role'); expect(h).not.toContain('Which members')
    expect(h).not.toMatch(/NaN|undefined|Invalid Date/)
  })
  it('a row the viewer may not open has no actions and no training data, only who looks after them', async () => {
    await boot({ id: 'coach', name: 'Coach', trainer: true })
    const h = render(<mod.MembersView data={{ ...roster, admin: false, trainers: [] }} today={roster.today} admin={false} filters={filters({ scope: 'all' })} setFilters={() => {}} onFollow={() => {}} onProfile={() => {}} />)
    const gus = h.slice(h.indexOf('Gus') - 200, h.indexOf('Gus') + 400)
    expect(gus).toContain('Not assigned to you'); expect(gus).toContain('Trainer: Coach Dos')
    expect(gus).not.toContain('Follow-up of Gus'); expect(gus).not.toMatch(/Last workout|No workouts/)
  })
  it('a trainer gets the "Assigned to me / Everybody" list and no admin-only controls or profile buttons', async () => {
    await boot({ id: 'coach', name: 'Coach', trainer: true })
    const h = render(<mod.MembersView data={{ ...roster, admin: false, trainers: [] }} today={roster.today} admin={false} filters={filters({ scope: 'assigned' })} setFilters={() => {}} onFollow={() => {}} onProfile={() => {}} />)
    expect(h).toContain('Which members'); expect(h).toContain('Assigned to me'); expect(h).toContain('Everybody')
    expect(h).not.toContain('Any trainer'); expect(h).not.toContain('Any role'); expect(h).not.toContain('Profile of')
  })
  it('filters apply: a status chip, a trainer, and a search with no match', async () => {
    await boot()
    const view = f => render(<mod.MembersView data={roster} today={roster.today} admin filters={filters(f)} setFilters={() => {}} onFollow={() => {}} onProfile={() => {}} />)
    const only = view({ status: 'training' }); expect(only).toContain('Cris'); expect(only).not.toContain('Beto')
    const byTrainer = view({ trainer: 't1' }); expect(byTrainer).toContain('Ana'); expect(byTrainer).not.toContain('Cris')
    expect(view({ q: 'zzz' })).toContain('No members match')
  })
  it('empty states: a trainer with nobody assigned is told how that changes', async () => {
    await boot({ id: 'coach', name: 'Coach', trainer: true })
    const h = render(<mod.MembersView data={{ scope: 'assigned', admin: false, today: '2026-10-10', trainers: [], users: [] }} today="2026-10-10" admin={false} filters={filters()} setFilters={() => {}} onFollow={() => {}} onProfile={() => {}} />)
    expect(h).toContain('No members assigned yet'); expect(h).toContain('An administrator can assign members to you')
  })
})

describe('Entrenadores', () => {
  const stats = { members: 9, attention: 3, upcoming: 2, trainedLast7d: 6, activeNow: 1, lastWorkoutAt: '2026-10-09' }
  it('workload per trainer, the unassigned group, and a way to their members', async () => {
    await boot()
    const h = render(<mod.TrainersView d={{ admin: true, today: '2026-10-10', trainers: [{ id: 't1', name: 'Coach Uno', avatar: null, role: 'trainer', ...stats }], unassigned: { ...stats, members: 2, attention: 0 } }} onOpen={() => {}} />)
    for (const text of ['Coach Uno', 'Members', 'Need attention', 'Reviews soon', 'Trained in 7 days', 'Training now', 'Last workout', 'No trainer', 'View members']) expect(h).toContain(text)
    expect(h).toContain('>9<'); expect(h).toContain('>3<'); expect(h).not.toMatch(/NaN|undefined/)
  })
  it('a trainer with no members cannot open an empty list', async () => {
    await boot()
    const h = render(<mod.TrainersView d={{ admin: false, today: '2026-10-10', trainers: [{ id: 't1', name: 'Coach', avatar: null, role: 'trainer', members: 0, attention: 0, upcoming: 0, trainedLast7d: 0, activeNow: 0, lastWorkoutAt: null }], unassigned: null }} onOpen={() => {}} />)
    expect(h).toMatch(/disabled=""[^>]*>.*View members|View members/)
    expect(h).toContain('—')
  })
})

describe('the screen and its entrances', () => {
  it('renders nothing for a member, and the wiring is staff-only', async () => {
    await boot({ id: 'm', name: 'Miembro' })
    expect(render(<mod.default />)).toBe('')
    const app = readFileSync(new URL('../App.jsx', import.meta.url), 'utf8')
    expect(app).toMatch(/path="\/center" element=\{user\?\.admin \|\| user\?\.trainer \?/); expect(app).toMatch(/path="\/center\/member\/:id"/)
    expect(readFileSync(new URL('./Admin.jsx', import.meta.url), 'utf8')).toContain("nav('/center')")
    expect(readFileSync(new URL('./trainer/TrainerClients.jsx', import.meta.url), 'utf8')).toContain('#/center')
  })
  it('every string of the console exists in Spanish', () => {
    const es = readFileSync(new URL('../locales/es.js', import.meta.url), 'utf8')
    const src = f => readFileSync(new URL(f, import.meta.url), 'utf8')
    const literal = [...src('./Center.jsx').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'"))
    const labels = ['Today', 'Members', 'Trainers', 'All', 'Training now', 'Not training', 'Joined recently', 'New member', 'Disabled', 'Trained today', 'Trained in 7 days', 'New members', 'Never trained', 'Need attention', 'Upcoming reviews', 'Nobody is training right now', 'Nobody needs attention', 'No reviews in the next 7 days', 'No one joined recently', 'Everybody has trained recently', 'Nobody right now']
    const missing = [...new Set([...literal, ...labels])].filter(k => !es.includes("'" + k.replace(/'/g, "\\'") + "':"))
    expect(missing).toEqual([])
  })
})
