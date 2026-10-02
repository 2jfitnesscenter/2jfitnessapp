import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* The admin's "Challenges & goals" switch (feature key `challenges`) must remove Challenges, Marks (record posts) and Goals from the
 * Social panel — tab, content, deep link and the record-sharing button — while admin ON + member ON keeps everything. Admin
 * availability always wins over the member's own choice. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, F, views
const BENCH = '0025'
const wk = (id, d, sets) => ({ id, d, start: 1, end: 2, name: 'Pecho', prs: [], vol: 1,
  entries: [{ id: BENCH, target: { sets: sets.length, reps: 5, mode: 'reps' }, sets: sets.map(([w, r]) => ({ w, r, done: true })) }] })

async function boot() {
  vi.resetModules()
  const ls = { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null }
  vi.stubGlobal('localStorage', ls)
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: ls })
  ;({ useStore: store } = await import('../store/useStore.js'))
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  F = await import('../lib/features.js')
  views = { Social: (await import('./Social.jsx')).default, Records: (await import('./Records.jsx')).default, App: null }
}
async function seed(over = {}, admin = null) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
}
const render = async (View, url = '/') => { await boot(); return renderToStaticMarkup(<MemoryRouter initialEntries={[url]}><View /></MemoryRouter>) }
const TAB = 'Challenges &amp; PRs'
const HISTORY = () => ({ workouts: [wk('a', '2026-09-02', [[80, 5]]), wk('b', '2026-09-09', [[85, 5]])] })

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Social panel: Challenges and Marks follow the admin switch', () => {
  it('admin ON and member never personalised: the tab is there', async () => {
    await seed({})
    expect(await render(views.Social)).toContain(TAB)
  })
  it('admin OFF: no Challenges / Marks tab at all, whatever the member chose', async () => {
    await seed({}, { challenges: false })
    expect(await render(views.Social)).not.toContain(TAB)
    await seed({ ux: F.makeUx({ social: true }) }, { challenges: false })    // the member said yes: still gone
    expect(await render(views.Social)).not.toContain(TAB)
  })
  it('admin OFF: a direct link to the tab lands on the Wall, with no Challenges or Marks content', async () => {
    await seed({}, { challenges: false })
    const html = await render(views.Social, '/social?tab=challenges')
    expect(html).not.toContain(TAB)
    expect(html).not.toContain('Post a record')
    expect(html).not.toContain('No records posted yet')
    expect(html).toContain('New topic')               // the Wall instead
  })
  it('admin ON + member ON: the deep link opens Challenges and Marks', async () => {
    await seed({ ux: F.makeUx({ social: true }) })
    const html = await render(views.Social, '/social?tab=challenges')
    expect(html).toContain(TAB)
    expect(html).toContain('Post a record')
    expect(html).not.toContain('New topic')
  })
  it('admin ON + member OFF (Social hidden by the member): hidden too', async () => {
    await seed({ ux: F.makeUx({ social: false }) })
    const html = await render(views.Social, '/social?tab=challenges')
    expect(html).not.toContain(TAB)
    expect(html).not.toContain('Post a record')
  })
  it('the other tabs are untouched when Challenges is off', async () => {
    await seed({}, { challenges: false })
    const html = await render(views.Social)
    for (const t of ['Wall', 'Moments', 'Routines', 'Trainers']) expect(html).toContain(t)
  })
})

describe('Marks outside the tab: record sharing', () => {
  it('Records offers "share" only while Challenges and Social are on', async () => {
    await seed(HISTORY())
    expect(await render(views.Records)).toContain('record-share-button')
    await seed(HISTORY(), { challenges: false })
    expect(await render(views.Records)).not.toContain('record-share-button')
    await seed(HISTORY(), { social: false })
    expect(await render(views.Records)).not.toContain('record-share-button')
    await seed({ ...HISTORY(), ux: F.makeUx({ social: false }) })
    expect(await render(views.Records)).not.toContain('record-share-button')
  })
  it('hiding the share button never hides the records themselves', async () => {
    await seed(HISTORY(), { challenges: false })
    const html = await render(views.Records)
    expect(html).toContain('My records')
    expect(html).toContain('85 kg')
  })
})

describe('Friends and Messages tiles follow their own switches', () => {
  it('admin OFF removes each tile; ON keeps it', async () => {
    await seed({})
    let html = await render(views.Social)
    expect(html).toContain('Friends'); expect(html).toContain('Messages')
    await seed({}, { friends: false })
    html = await render(views.Social)
    expect(html).not.toContain("community-tile community-tile-main"); expect(html).toContain('Messages')
    await seed({}, { chat: false })
    html = await render(views.Social)
    expect(html).not.toContain('Messages'); expect(html).toContain('community-tile-main')
  })
})

describe('the feature key and the client agree', () => {
  it('"challenges" is the exact key the admin screen switches and the server stores', async () => {
    await seed({})
    expect(F.FEATURE_KEYS).toContain('challenges')
    expect(F.FEATURE_GROUPS.flatMap(g => g.keys).find(k => k.key === 'challenges').label).toBe('Challenges & goals')
    F.setAdminFeatures({ challenges: false })
    expect(F.uxOn({ ux: null }, 'challenges')).toBe(false)
    expect(F.uxOn({ ux: F.makeUx({ social: true }) }, 'challenges')).toBe(false)
    F.setAdminFeatures({})
    expect(F.uxOn({ ux: F.makeUx({ social: true }) }, 'challenges')).toBe(true)
  })
})
