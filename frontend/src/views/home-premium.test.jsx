import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'

/* Home's Premium block and the cover component over the real store: invitation without a program, "Tu programa" with one, never a broken image. */
vi.mock('../lib/api.js', () => ({
  api: vi.fn(() => Promise.reject(new Error('offline'))),
  IS_APPLE: false, IS_ANDROID: true, BIO: '', VAULT: '', webauthnOK: () => false,
  passkeyRegister: vi.fn(), passkeyLogin: vi.fn(), passkeyRecover: vi.fn(),
}))
vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), vibrate: vi.fn() }))

const clone = x => JSON.parse(JSON.stringify(x))
let memory, Card, Cover, F, premium, seed531
async function boot() {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k), get length() { return memory.size }, key: i => [...memory.keys()][i] ?? null })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('document', { addEventListener: vi.fn(), removeEventListener: vi.fn(), body: { classList: { toggle: vi.fn(), remove: vi.fn() } } })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), matchMedia: () => ({ matches: false }) })
  const { useUI } = await import('../store/useUI.js'); (await import('../components/ui.jsx')).bindUI(useUI)
  F = await import('../lib/features.js'); premium = await import('../lib/premium.js')
  Card = (await import('../components/PremiumHomeCard.jsx')).default; Cover = (await import('../components/PremiumCover.jsx')).default
  seed531 = (await import('../../../api/lib/premium-official.json', { with: { type: 'json' } })).default.programs.find(p => p.slug === '531')
}
async function seed(over = {}) {
  memory = new Map(); await boot()
  const { DEF } = await import('../store/useStore.js')
  memory.set('gym_state_v1', JSON.stringify(Object.assign(clone(DEF), { onboarded: true, workouts: [], routines: [] }, over)))
  memory.set('gym_user', JSON.stringify({ id: 'u1', name: 'Ana', created: '2026-01-10T00:00:00Z' }))
  await boot()
}
const html = el => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>)
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-12T12:00:00')) })
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

describe('Home Premium card', () => {
  it('without a program it is an invitation to the catalogue', async () => {
    await seed()
    const h = html(<Card />)
    expect(h).toContain('pm-home'); expect(h).toContain('Premium training'); expect(h).not.toContain('Your program')
  })
  it('with a running program it becomes "Your program": name, cycle and week, next workout, progress', async () => {
    await seed()
    const S = { workouts: [], unit: 'kg' }
    const premiumState = premium.activate(S, seed531, { tm: { squat: 100, bench: 70, deadlift: 120, press: 50 }, now: Date.parse('2026-10-11T10:00:00Z'), id: 'x' })
    await seed({ premium: premiumState })
    const h = html(<Card />)
    expect(h).toContain('Your program'); expect(h).toContain('5/3/1'); expect(h).toContain('Cycle 1 · Week 1/4'); expect(h).toContain('aria-valuenow="0"'); expect(h).toContain('Next: Press day')
  })
  it('the gym switching the catalogue off removes the invitation but never a running program', async () => {
    await seed(); F.setAdminFeatures({ premium: false })
    expect(html(<Card />)).toBe('')
    const premiumState = premium.activate({ workouts: [], unit: 'kg' }, seed531, { tm: { squat: 100, bench: 70, deadlift: 120, press: 50 }, now: 1, id: 'x' })
    await seed({ premium: premiumState }); F.setAdminFeatures({ premium: false })
    expect(html(<Card />)).toContain('Your program')
    F.setAdminFeatures({})
  })
})

describe('cover', () => {
  it('shows the picture with its alt text, lazy and with a reserved aspect ratio', async () => {
    await seed()
    const h = html(<Cover p={{ coverImage: '/premium/covers/531.jpg', coverImageAlt: 'Hands on a bar', coverFocalPoint: { x: 30, y: 60 } }} ratio="4 / 3" />)
    expect(h).toContain('src="/premium/covers/531.jpg"'); expect(h).toContain('alt="Hands on a bar"'); expect(h).toContain('loading="lazy"')
    expect(h).toContain('aspect-ratio:4 / 3'); expect(h).toContain('object-position:30% 60%'); expect(h).not.toContain('data-fallback')
  })
  it('eager loading is opt-in (the first card only)', async () => {
    await seed()
    expect(html(<Cover p={{ coverImage: '/premium/covers/531.jpg', coverImageAlt: 'x' }} eager />)).toContain('loading="eager"')
  })
  it('a program without a cover, or with an unsafe one, gets the Premium fallback art — never a broken image', async () => {
    await seed()
    for (const p of [{}, { coverImage: '' }, { coverImage: 'javascript:alert(1)' }, { coverImage: 'http://insecure.example/x.jpg' }, { coverImage: '/etc/passwd' }]) {
      const h = html(<Cover p={p} />)
      expect(h).toContain('data-fallback="true"'); expect(h).toContain('pm-cover-art'); expect(h).not.toContain('<img')
    }
  })
  it('an uploaded image is served through the app\'s media route; an https URL is allowed', async () => {
    await seed()
    expect(html(<Cover p={{ coverImage: 'media:abc123.jpg', coverImageAlt: 'x' }} />)).toContain('/api/social/media?id=abc123.jpg')
    expect(html(<Cover p={{ coverImage: 'https://upload.wikimedia.org/a.jpg', coverImageAlt: 'x' }} />)).toContain('src="https://upload.wikimedia.org/a.jpg"')
  })
})
