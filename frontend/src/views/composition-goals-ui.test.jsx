import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Health V2 composition goals on screen: current · trend · goal · state (always in words), documented ranges only, empty values, no verdicts. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

let memory, Goals
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  const { useUI } = await import('../store/useUI.js'); (await import('../components/ui.jsx')).bindUI(useUI)
  Goals = (await import('../components/CompositionGoals.jsx')).default
}
const S = (over = {}) => ({ unit: 'kg', height: 178, birthDate: '1990-05-04', body: 'male', bodyweight: [{ d: '2026-07-20', w: 84 }, { d: '2026-10-10', w: 81 }],
  measurements: { bodyFat: [{ d: '2026-07-21', v: 21, t: 1 }, { d: '2026-10-09', v: 18.6, t: 1 }], muscleMass: [{ d: '2026-10-09', v: 36.2, t: 1 }] }, ...over })
const html = state => renderToStaticMarkup(<MemoryRouter><Goals S={state} /></MemoryRouter>)
beforeEach(async () => { memory = new Map(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00')); await boot() })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Composition goals', () => {
  it('shows current, trend, goal, what remains and a state in words', async () => {
    const h = html(S({ targetW: 78, compGoals: { bodyFat: { target: 15, at: '2026-07-22' } } }))
    for (const k of ['Composition goals', 'Weight', 'Body fat', '81 kg', '78 kg', '3 kg to go', 'Moving toward your goal', 'Trend (90 days)', '15 %', 'Edit goal']) expect(h, k).toContain(k)
    expect(h).toMatch(/18[.,]6 %/)
    expect(h).toContain('role="progressbar"')
  })
  it('a metric without a goal offers "Set a goal" and gives no verdict', async () => {
    const h = html(S())
    expect(h).toContain('Set a goal'); expect(h).not.toContain('Moving toward'); expect(h).not.toContain('Goal reached')
  })
  it('documented ranges only: BMI (WHO) and body fat (ACE) with their basis; muscle mass says there is no accepted range', async () => {
    const h = html(S({ targetW: 78 }))
    expect(h).toContain('Basis: WHO (adults)'); expect(h).toContain('Basis: ACE (adults)'); expect(h).toContain('Above the normal range'); expect(h).toContain('Average'); expect(h).toContain('not a diagnosis')
    expect(h).toContain('There is no widely accepted reference range for muscle mass')
  })
  it('without a birth date it asks for it instead of guessing', async () => {
    const h = html(S({ birthDate: null, targetW: 78 }))
    expect(h).toContain('Add your birth date in your profile'); expect(h).not.toContain('Basis: WHO'); expect(h).not.toContain('Basis: ACE')
  })
  it('empty values: nothing measured and no goal renders nothing; a goal with no reading says so', async () => {
    expect(html({ unit: 'kg' })).toBe('')
    const h = html({ unit: 'kg', compGoals: { bodyFat: { target: 15, at: '2026-10-01' } } })
    expect(h).toContain('No reading yet'); expect(h).toContain('15 %')
  })
  it('one reading, or readings days apart, claims no trend', async () => {
    const h = html(S({ targetW: 78, bodyweight: [{ d: '2026-10-10', w: 81 }] }))
    expect(h).toContain('Not enough readings for a trend yet'); expect(h).not.toContain('Moving toward')
  })
})
