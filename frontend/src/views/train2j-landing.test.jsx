import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { readFileSync } from 'node:fs'

/* Train2J's first screen: on a phone, search, filters and "For you" come before the featured workout; wider screens keep the hero on top.
 * Goal filter, favourites and the gym show up where a person can use them. Same harness idea as Train2J.test.jsx (network down, store from storage). */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
vi.mock('../components/WorkoutGuide.jsx', () => ({ openWorkoutGuide: vi.fn() }))

const SEED = JSON.parse(readFileSync(new URL('../../../api/lib/guided-official.json', import.meta.url), 'utf8'))
const clone = x => JSON.parse(JSON.stringify(x))
let memory, Train2J, guided, parts

async function boot({ narrow, state = {} }) {
  vi.resetModules()
  memory = new Map()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible', body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: narrow }) })
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { onboarded: true, routines: [], coach: { profile: { goal: 'fatloss', experience: 'new' } } }, state)))
  vi.resetModules()
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  guided = await import('../lib/guided-api.js')
  Object.assign(guided.useGuided.getInitialState(), { status: 'ready', uid: 'u1', routines: clone(SEED.routines), programs: [], collections: clone(SEED.collections), load: () => {}, migrateFavorites: () => {} })
  Train2J = (await import('./Train2J.jsx')).default
  parts = await import('../components/train2j/parts.jsx')
}
afterEach(() => vi.unstubAllGlobals())
const render = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)
const at = (h, s) => h.indexOf(s)

describe('Train2J first screen', () => {
  it('on a phone: search and filters, then "For you", then the featured workout', async () => {
    await boot({ narrow: true })
    const h = render(<Train2J />)
    const order = [at(h, 'class="t2-tools"'), at(h, 'id="t2-foryou"'), at(h, 'class="t2-hero"')]
    expect(order.every(i => i > 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(at(h, 'class="t2-hero"')).toBeLessThan(at(h, 'id="t2-colls"'))          // still ahead of the rails below
  })
  it('on a wider screen the featured workout stays on top', async () => {
    await boot({ narrow: false })
    const h = render(<Train2J />)
    expect(at(h, 'class="t2-hero"')).toBeGreaterThan(0)
    expect(at(h, 'class="t2-hero"')).toBeLessThan(at(h, 'class="t2-tools"'))
  })
  it('the hero is shorter on a phone: no 4:5 poster', () => {
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.t2-hero-cov\.wide\{aspect-ratio:auto;min-height:300px\}/)
  })
})

describe('what the member chose shows where it can be used', () => {
  it('"For you" says why a session is there: the gym, the favourites, the goal', async () => {
    const fav = SEED.routines.find(r => r.category === 'hiit' && r.level === 'beginner')
    await boot({ narrow: false, state: { favRoutines: [fav.id], gymProfiles: { activeId: 'home' } } })
    const h = render(<Train2J />)
    expect(h).toContain('t2-why')
    expect(h).toMatch(/Works at|In your favorites|Like your favorites/)
  })
  it('the filters sheet offers the goal, and the favourite heart reads the synced state', async () => {
    await boot({ narrow: false, state: { favRoutines: ['r2j-core-start'] } })
    const sheet = render(<parts.FiltersSheet value={{}} onApply={() => {}} close={() => {}} />)
    expect(sheet).toContain('Goal'); expect(sheet).toMatch(/Hypertrophy|Muscle/); expect(sheet).toContain('Strength')
    expect(render(<parts.Heart id="r2j-core-start" />)).toContain('aria-pressed="true"')
    expect(render(<parts.Heart id="r2j-tabata-start" />)).toContain('aria-pressed="false"')
  })
})
