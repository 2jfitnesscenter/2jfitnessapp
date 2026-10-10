import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* The one screen for a routine or program a friend sent privately: who sent it, what is in it, whether it fits the gym, and save / start / not now.
 * Same harness idea as train2j-landing.test.jsx (network down, store from storage). */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../components/WorkoutGuide.jsx', () => ({ openWorkoutGuide: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, ReceivedPlan, i18n, EXIDX
async function boot(state = {}) {
  vi.resetModules()
  memory = new Map()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible', body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  const { DEF } = await import('./../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { onboarded: true, routines: [], programs: [] }, state)))
  vi.resetModules()
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  i18n = await import('../lib/i18n.js')
  ;({ EXIDX } = await import('../lib/exercises.js'))
  ReceivedPlan = (await import('../components/ReceivedPlan.jsx')).default
}
afterEach(() => vi.unstubAllGlobals())
const render = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)
const exOf = eq => Object.values(EXIDX).find(e => e.eq === eq && e.bp !== 'cardio' && !String(e.id).startsWith('c')).id

const routineItem = (ex, extra = {}) => ({ id: 'sh1', kind: 'routine', authorId: 'u2', authorName: 'Ana', createdAt: Date.UTC(2026, 9, 1), discarded: false,
  content: { snapshot: { name: 'Push day', emoji: 'dumbbell', ex, customExDefs: [] }, meta: { goal: 'hypertrophy', level: 'beginner', duration: '45 min', origin: 'plan', senderLabel: 'Ana' } }, ...extra })

describe('a routine sent by a friend', () => {
  it('shows who sent it, what is in it and the three choices', async () => {
    await boot()
    const h = render(<ReceivedPlan item={routineItem([{ id: exOf('body weight'), sets: 3, reps: 10 }, { id: exOf('body weight'), sets: 2, reps: 12 }])} />)
    i18n.setLang?.('en')
    expect(h).toContain('Ana'); expect(h).toContain('sent you a routine'); expect(h).toContain('Push day')
    expect(h).toContain('45 min'); expect(h).toContain('Build muscle'); expect(h).toContain('Beginner'); expect(h).toContain('From their plan')
    expect(h).toContain('3 × 10')
    expect(h).toMatch(/>Not now</); expect(h).toMatch(/>Save</); expect(h).toMatch(/>Start</)
    expect(h).toContain('Report')
    expect(h).not.toMatch(/NaN|undefined|Invalid Date/)
  })
  it('says it works here when everything is available, and names what is missing when it is not', async () => {
    await boot()
    const bw = exOf('body weight'), barbell = exOf('barbell')
    expect(render(<ReceivedPlan item={routineItem([{ id: bw, sets: 3, reps: 10 }])} />)).toContain('Compatible with this place')
    await boot({ gymProfiles: { activeId: 'home' } })
    const h = render(<ReceivedPlan item={routineItem([{ id: bw, sets: 3, reps: 10 }, { id: barbell, sets: 3, reps: 8 }])} />)
    expect(h).toContain('t2-fitbox'); expect(h).toMatch(/Missing here: /); expect(h).not.toContain('Compatible with this place')
    expect(h).toMatch(/>Start</)   // a mismatch never blocks saving or starting
  })
  it('a routine already saved offers no second save, and a set-aside one says so but can still be saved', async () => {
    await boot({ routines: [{ id: 'mine', name: 'Push day', emoji: 'dumbbell', ex: [{ id: 'x', sets: 1 }], fromShare: { shareId: 'sh1', senderId: 'u2', senderLabel: 'Ana', createdAt: 1 } }] })
    const ex = [{ id: exOf('body weight'), sets: 3, reps: 10 }]
    const saved = render(<ReceivedPlan item={routineItem(ex)} />)
    expect(saved).toMatch(/disabled=""[^>]*><svg[^>]*>.*?Saved|Saved<\/button>/s); expect(saved).not.toMatch(/>Not now</)
    await boot()
    const aside = render(<ReceivedPlan item={routineItem(ex, { discarded: true })} />)
    expect(aside).toContain('You set this aside'); expect(aside).not.toMatch(/>Not now</); expect(aside).toMatch(/>Save</)
  })
})

describe('a program sent by a friend', () => {
  it('lists its routines, opens the program instead of starting one routine, and promises no live link', async () => {
    await boot()
    const r = n => ({ name: n, emoji: 'dumbbell', ex: [{ id: exOf('body weight'), sets: 3, reps: 10 }], customExDefs: [] })
    const h = render(<ReceivedPlan item={{ id: 'sh2', kind: 'program', authorId: 'u2', authorName: 'Ana', createdAt: Date.UTC(2026, 9, 1), discarded: false,
      content: { snapshot: { name: 'Fuerza 3 días', emoji: 'folder', routines: [r('Día 1'), r('Día 2'), r('Día 3')] }, meta: { senderLabel: 'Ana', origin: 'plan' } } }} />)
    expect(h).toContain('sent you a program'); expect(h).toContain('Fuerza 3 días')
    expect(h).toContain('Día 1'); expect(h).toContain('Día 3'); expect(h).toContain('<details')
    expect(h).toMatch(/>Open program</); expect(h).not.toMatch(/>Start</)
    expect(h).toContain('later changes by the sender never reach your copy')
  })
})

describe('Spanish', () => {
  it('every string of the receiving flow exists in Spanish', () => {
    const es = readFileSync(new URL('../locales/es.js', import.meta.url), 'utf8')
    const files = ['../components/ReceivedPlan.jsx', '../components/PrivatePlanShareSheet.jsx', './SocialShareDetail.jsx']
    const keys = files.flatMap(f => [...readFileSync(new URL(f, import.meta.url), 'utf8').matchAll(/\bt\(\s*'((?:[^'\\]|\\.)*)'/g)].map(m => m[1].replace(/\\'/g, "'")))
    expect(keys.length).toBeGreaterThan(15)
    expect([...new Set(keys)].filter(k => !es.includes("'" + k.replace(/'/g, "\\'") + "':"))).toEqual([])
  })
})
