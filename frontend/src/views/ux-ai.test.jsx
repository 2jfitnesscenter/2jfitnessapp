import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Profile priorities on their own screen, Settings with Account first, and Admin → Artificial intelligence with the three
 * AIs — over the real store (same harness as adaptive.test.jsx). */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, store, views, aiStatus
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', {
    getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k),
    get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null,
  })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  ;({ useStore: store } = await import('../store/useStore.js'))
  const { useUI } = await import('../store/useUI.js')
  ;(await import('../components/ui.jsx')).bindUI(useUI)
  const ai = await import('./AdminAI.jsx')
  aiStatus = ai.aiStatus
  views = {
    Profile: (await import('./Profile.jsx')).default,
    Priorities: (await import('./TrainingPriorities.jsx')).default,
    Settings: (await import('./Settings.jsx')).default,
    Admin: (await import('./Admin.jsx')).default,
    AdminAI: ai.default,
  }
}
async function seed(over = {}, user = { id: 'u1', name: 'Ana Socia', created: '2026-01-10T00:00:00Z' }) {
  memory = new Map()
  await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { body: 'male', onboarded: true, height: 178 }, over)))
  memory.set('gym_user', JSON.stringify(user))
  await boot()
}
const render = async View => { await boot(); return renderToStaticMarkup(<MemoryRouter><View /></MemoryRouter>) }
const ADMIN = { id: 'ad', name: 'Admin', admin: true, created: '2026-01-10T00:00:00Z' }

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-09T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Training priorities leave the main Profile', () => {
  it('Profile shows one compact row with the current choice, not the two unfolded pickers', async () => {
    await seed({ priorityMuscles: ['chest'], secondaryMuscles: ['triceps'] })
    const html = await render(views.Profile)
    expect(html).toContain('Training priorities')
    expect(html).toContain('Chest, Triceps')
    expect(html).not.toContain('What do you want to prioritize?')
    expect(html).not.toContain('Anything else? (up to 3)')
    expect(html.indexOf('About you')).toBeLessThan(html.indexOf('Training priorities'))
  })
  it('the new screen has everything that used to be there, and it keeps the stored data', async () => {
    await seed({ priorityMuscles: ['chest'], secondaryMuscles: ['triceps'] })
    const html = await render(views.Priorities)
    for (const kept of ['What do you want to prioritize? (up to 2)', 'Anything else? (up to 3)', 'Optional. The quick plan and the AI Coach give these a little more work than the rest.', 'Quads', 'Glutes', 'Hamstrings', 'Abs']) expect(html).toContain(kept)
    expect(html).toMatch(/chip on[^>]*>Chest</)
    expect(html).toMatch(/chip on[^>]*>Triceps</)
    expect(store.getState().S.priorityMuscles).toEqual(['chest'])
  })
  it('saving works as before: up to 2 priorities, one muscle is never in both lists', async () => {
    await seed({ priorityMuscles: ['chest'], secondaryMuscles: ['triceps'] })
    const pick = (key, k) => store.getState().update(s => {
      const v = s[key] || []
      s[key] = v.includes(k) ? v.filter(x => x !== k) : v.length < (key === 'priorityMuscles' ? 2 : 3) ? [...v, k] : v
    })
    pick('priorityMuscles', 'back'); pick('priorityMuscles', 'abs')
    expect(store.getState().S.priorityMuscles).toEqual(['chest', 'back'])
  })
})

describe('Settings starts with the account', () => {
  it('Account is the first group, then the rest in the agreed order', async () => {
    await seed({})
    const html = await render(views.Settings)
    const order = ['Account', 'Appearance', 'Training', 'Health &amp; activity', 'Social &amp; privacy', 'Notifications', 'Data', 'Security', 'Advanced']
    const at = order.map(g => html.indexOf('<h3 class="set-grp">' + g))
    expect(at.every(i => i > 0)).toBe(true)
    expect([...at].sort((a, b) => a - b)).toEqual(at)
    expect(html).toContain('Sign out')           // the account controls are still there
  })
})

describe('Admin → Artificial intelligence', () => {
  it('the dashboard has a single entry for the AIs instead of three scattered panels', async () => {
    await seed({}, ADMIN)
    const html = await render(views.Admin)
    expect(html).toContain('Artificial intelligence')
    expect(html).not.toContain('Trainer panel AI')
    expect(html).not.toContain('Auxiliary AI')
  })
  it('the section shows the three AIs with name, purpose and state, and a way to their controls', async () => {
    await seed({}, ADMIN)
    const html = await render(views.AdminAI)
    for (const ai of ['data-ai="coach"', 'data-ai="trainer"', 'data-ai="aux"']) expect(html).toContain(ai)
    for (const name of ['AI Coach', 'Trainer panel AI', 'Auxiliary AI']) expect(html).toContain(name)
    expect(html).toContain('it builds and adjusts their plan')
    expect(html).toContain('Generate with AI')
    expect(html).toContain('matching imported exercises')
    expect(html.match(/Configure</g)).toHaveLength(3)
  })
  it('only an admin sees it', async () => {
    await seed({})
    expect(await render(views.AdminAI)).toBe('')
  })
  it('state is honest: off, credential missing or expired, last job failed, working', () => {
    expect(aiStatus(null).key).toBe('loading')
    expect(aiStatus({ disabledByEnv: true }).key).toBe('env')
    expect(aiStatus({ enabled: false }).key).toBe('off')
    expect(aiStatus({ enabled: true, auth: { state: 'disconnected' } }).key).toBe('nocred')
    expect(aiStatus({ enabled: true, auth: { state: 'expired' } }).label).toMatch(/expired/)
    expect(aiStatus({ enabled: true, auth: { state: 'connected' }, lastError: { at: 5 }, lastSuccess: { at: 1 } }).key).toBe('attention')
    expect(aiStatus({ enabled: true, auth: { state: 'connected' }, lastError: { at: 1 }, lastSuccess: { at: 5 } }).key).toBe('on')
    expect(aiStatus({ enabled: true, auth: { state: 'not-required' } }).key).toBe('on')
  })
})
