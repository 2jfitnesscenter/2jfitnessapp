import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Custom covers (framing, stored as a media id in the existing `image` field), Grid/Rows view (local preference, not synced), Settings V3 hub. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(), passkeyDeleteAccount: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, mods
const NOW = new Date('2026-09-09T12:00:00')
const R1 = { id: 'r1', name: 'Push day', emoji: 'dumbbell', ex: [{ id: '0025', sets: 3, reps: 5, rest: 120 }], meta: { goal: 'hypertrophy', level: 'intermediate' } }
const R2 = { id: 'r2', name: 'Photo day', emoji: 'dumbbell', ex: [{ id: '0032', sets: 3, reps: 8 }], image: 'abc123.jpg' }

async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }), localStorage: globalThis.localStorage, open: vi.fn() })
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  mods = { crop: await import('../lib/cover-crop.js'), pref: await import('../lib/view-pref.js'), cards: await import('../components/PlanCards.jsx'), heroes: await import('../components/DetailHeroes.jsx') }
}
async function seed(over = {}, { user = { id: 'u1', name: 'Ana Socia' }, admin = null } = {}) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true }, over)))
  if (user) memory.set('gym_user', JSON.stringify(user))
  if (admin) memory.set('gym_features_v1', JSON.stringify(admin))
  await boot()
}
const noop = () => {}
beforeEach(() => { memory = new Map(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Cover framing', () => {
  it('crops the largest 2:1 window, zoom shrinks it, the position stays inside the image', async () => {
    await boot()
    const { cropRect, panBy } = mods.crop
    expect(cropRect({ iw: 2000, ih: 1000 })).toEqual({ sx: 0, sy: 0, sw: 2000, sh: 1000 })
    const tall = cropRect({ iw: 1000, ih: 3000, fy: 0.5 })          // a long vertical photo: full width, a 500px band
    expect(tall.sw).toBe(1000); expect(tall.sh).toBe(500); expect(tall.sy).toBe(1250)
    expect(cropRect({ iw: 1000, ih: 3000, fy: 5 }).sy).toBe(2500)   // clamped to the bottom
    const z = cropRect({ iw: 2000, ih: 1000, zoom: 2 }); expect([z.sw, z.sh]).toEqual([1000, 500])
    expect(cropRect({ iw: 2000, ih: 1000, zoom: 99 }).sw).toBe(2000 / mods.crop.MAX_ZOOM)
    expect(cropRect({ iw: 0, ih: 10 })).toBeNull()
    // dragging down shows what is above (fy decreases); nothing moves when there is no room on that axis
    expect(panBy({ iw: 1000, ih: 3000, zoom: 1, fx: 0.5, fy: 0.5 }, 0, 40, 400).fy).toBeLessThan(0.5)
    expect(panBy({ iw: 2000, ih: 1000, zoom: 1, fx: 0.5, fy: 0.5 }, 30, 30, 400)).toEqual({ fx: 0.5, fy: 0.5 })
  })
  it('the stored result is a small JPEG in the media store; the state only keeps the id (no base64 in the plan)', async () => {
    await boot()
    expect(mods.crop.COVER_OUT).toEqual({ w: 1000, h: 500 })
    const sheet = readFileSync(new URL('../components/CoverSheet.jsx', import.meta.url), 'utf8')
    expect(sheet).toMatch(/uploadImage\(dataUrl\)\.then\(id => \{[^}]*onChange\(id\)/)
    expect(sheet).toContain("onChange(null)")                       // back to the 2J cover
    expect(sheet).not.toMatch(/image = dataUrl|\.image = .*dataUrl/)
    for (const f of ['RoutineEdit', 'ProgramEdit']) {
      const src = readFileSync(new URL(`./${f}.jsx`, import.meta.url), 'utf8')
      expect(src).toContain('coverSheet({'); expect(src).toMatch(/delete (x|pr)\.image/)
    }
  })
  it('heroes offer "Change cover" only when the editor passes the action; the photo or the 2J cover shows either way', async () => {
    await seed({ routines: [R1, R2] })
    const S = JSON.parse(memory.get('gym_state_v1'))
    const { RoutineHero } = mods.heroes
    const plain = renderToStaticMarkup(<MemoryRouter><RoutineHero r={R1} S={S} /></MemoryRouter>)
    expect(plain).not.toContain('v3-cover-edit'); expect(plain).toContain('wcov')
    const edit = renderToStaticMarkup(<MemoryRouter><RoutineHero r={R2} S={S} onCover={noop} /></MemoryRouter>)
    expect(edit).toContain('v3-cover-edit'); expect(edit).toContain('Change cover'); expect(edit).toContain('/api/social/media?id=abc123.jpg')
  })
})

describe('Grid / Rows view', () => {
  it('is a per-user, per-device preference in localStorage, defaults to grid and ignores junk', async () => {
    await boot()
    const { readViewModes, writeViewMode } = mods.pref
    expect(readViewModes('u1')).toEqual({ routines: 'grid', programs: 'grid' })
    writeViewMode('u1', 'routines', 'rows')
    expect(readViewModes('u1')).toEqual({ routines: 'rows', programs: 'grid' })
    expect(readViewModes('u2')).toEqual({ routines: 'grid', programs: 'grid' })
    writeViewMode('u1', 'programs', 'bogus'); expect(readViewModes('u1').programs).toBe('grid')
    memory.set('2j:plan-view:v1:u3', '{not json'); expect(readViewModes('u3')).toEqual({ routines: 'grid', programs: 'grid' })
    expect([...memory.keys()].every(k => k.startsWith('2j:plan-view:v1:'))).toBe(true)
  })
  it('is never part of the synced state (Sync V2 untouched)', async () => {
    await seed({})
    const { DEF } = await import('../store/useStore.js')
    expect(JSON.stringify(DEF)).not.toMatch(/viewMode|plan-view|rows/i)
    const plan = readFileSync(new URL('./Plan.jsx', import.meta.url), 'utf8')
    expect(plan).toContain('readViewModes'); expect(plan).not.toMatch(/update\(s => \{ s\.(view|layout)/)
  })
  it('rows cards keep the same content and action, with a row layout class and the goal visible', async () => {
    await seed({ routines: [R1], programs: [{ id: 'p1', name: 'Split', routineIds: ['r1'], meta: { goal: 'toning' } }], activeProgramId: 'p1' })
    const S = JSON.parse(memory.get('gym_state_v1'))
    const { RoutineCard, ProgramCard } = mods.cards
    const grid = renderToStaticMarkup(<MemoryRouter><RoutineCard r={R1} S={S} onOpen={noop} onStart={noop} onFav={noop} onDuplicate={noop} /></MemoryRouter>)
    const rows = renderToStaticMarkup(<MemoryRouter><RoutineCard r={R1} S={S} layout="rows" onOpen={noop} onStart={noop} onFav={noop} onDuplicate={noop} /></MemoryRouter>)
    expect(grid).not.toContain('v3-card row'); expect(rows).toContain('v3-card row')
    for (const k of ['Push day', 'v3-card-go', 'Duplicate', 'Build muscle', 'Intermediate']) { expect(rows).toContain(k) }
    const prows = renderToStaticMarkup(<MemoryRouter><ProgramCard p={S.programs[0]} S={S} layout="rows" onOpen={noop} onContinue={noop} /></MemoryRouter>)
    expect(prows).toContain('v3-card row'); expect(prows).toContain('Tone up'); expect(prows).toContain('Active'); expect(prows).toContain('v3-card-go')
  })
  it('the switch is two labelled, pressable icon buttons', async () => {
    await boot()
    const html = renderToStaticMarkup(<mods.cards.ViewToggle value="rows" onChange={noop} />)
    expect(html).toContain('aria-label="Grid"'); expect(html).toContain('aria-label="Rows"')
    expect(html).toMatch(/class="on"[^>]*aria-pressed="true"[^>]*aria-label="Rows"/)
  })
})

describe('Settings V3', () => {
  const html = async (over, o) => { await seed(over, o); const Settings = (await import('./Settings.jsx')).default; return renderToStaticMarkup(<MemoryRouter><Settings /></MemoryRouter>) }
  it('a member sees the profile card first and the nine groups in order', async () => {
    const h = await html({})
    expect(h).toContain('set-hero'); expect(h.indexOf('set-hero')).toBeLessThan(h.indexOf('Appearance'))
    const order = ['Account', 'Appearance', 'Training', 'Health &amp; activity', 'Social &amp; privacy', 'Notifications', 'Data', 'Security', 'Advanced']
    const at = order.map(g => h.indexOf('<h3 class="set-grp">' + g)); expect(at.every(i => i > 0)).toBe(true); expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(h).toContain('Sign out everywhere'); expect(h.indexOf('Sign out everywhere')).toBeGreaterThan(h.indexOf('<h3 class="set-grp">Security'))
  })
  it('a guest has no profile card, account or security; admin OFF removes health and social cleanly', async () => {
    const g = await html({}, { user: null })
    for (const gone of ['set-hero', '>Security<', 'Sign out everywhere', 'Export my data']) expect(g).not.toContain(gone)
    const off = await html({}, { admin: { health: false, social: false, bioimpedance: false } })
    for (const gone of ['Health &amp; activity', 'Social preferences', 'Bioimpedance reminder']) expect(off).not.toContain(gone)
    expect(off).toContain('<h3 class="set-grp">Data')
  })
  it('staff keep their role pill and cannot delete their account here', async () => {
    const h = await html({}, { user: { id: 'u1', name: 'Coach', trainer: true } })
    expect(h).toContain('set-pill'); expect(h).toContain('Trainer'); expect(h).not.toContain('Delete my account')
  })
})
