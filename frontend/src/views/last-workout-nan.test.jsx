import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Progress → "Last workout" with a workout that has no `vol` (imported / older data): sets are shown, the volume is simply left out — never "NaN kg". */
vi.mock('../lib/api.js', () => ({ api: vi.fn(() => Promise.reject(new Error('offline'))), IS_APPLE: false, IS_ANDROID: false, BIO: '', VAULT: '', webauthnOK: () => false, passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn() }))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))
beforeEach(() => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {}, removeItem: () => {}, length: 0, key: () => null })
  vi.stubGlobal('navigator', {}); vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
})
afterEach(() => vi.unstubAllGlobals())
const wk = over => ({ id: 'w1', d: '2026-09-09', start: 1, end: 2, name: 'Pecho', prs: [], entries: [{ id: '0025', target: { sets: 2, reps: 5 }, sets: [{ w: 80, r: 5, done: true }, { w: 80, r: 5, done: true }] }], ...over })
describe('LastWorkoutCard', () => {
  it('omits the volume when the workout has none, and shows it when it has', async () => {
    const { LastWorkoutCard } = await import('../components/ProgressModules.jsx')
    const render = w => renderToStaticMarkup(<MemoryRouter><LastWorkoutCard S={{ workouts: [w], unit: 'kg', body: 'male' }} /></MemoryRouter>)
    const none = render(wk())
    expect(none).not.toContain('NaN'); expect(none).toContain('2 sets'); expect(none).not.toContain(' kg')
    const some = render(wk({ vol: 800 }))
    expect(some).toContain('2 sets'); expect(some).toContain('800 kg'); expect(some).not.toContain('NaN')
  })
})
