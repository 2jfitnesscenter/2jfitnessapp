import { expect, test, vi, beforeEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import IntelligenceToday, { canAskCoach } from './IntelligenceToday.jsx'

vi.mock('../lib/guided-api.js', () => ({ useGuided: selector => selector({ uid: null, routines: [], load: () => {} }) }))
vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ config: { coach: { enabled: true } } }) }))
const store = new Map()
beforeEach(() => {
  store.clear()
  vi.stubGlobal('localStorage', { getItem: key => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) })
})
const render = S => renderToStaticMarkup(<MemoryRouter><IntelligenceToday S={S} user={{ id: 'u1' }} showIntro /></MemoryRouter>)

test('first visit shows a short explanation with user control, without a debug surface', () => {
  const html = render({ workouts: [], routines: [], programs: [] })
  expect(html).toContain('For you today')
  expect(html).toContain('You always decide')
  expect(html).toContain('Got it')
  expect(html).not.toContain('<table')
  expect(html).not.toContain('JSON')
})

test('a real signal has a reason, explicit action and dismiss controls; no state mutation on render', () => {
  const S = { workouts: [{ d: '2026-08-01', entries: [{ id: '0025', target: { reps: 10 }, sets: [{ w: 80, r: 10, done: true }] }] }], routines: [], programs: [] }
  const before = JSON.stringify(S)
  const html = render(S)
  expect(html).toContain('Welcome back to training')
  expect(html).toContain('Why this suggestion?')
  expect(html).toContain('Not now')
  expect(html).toContain('Don’t suggest this again')
  expect(JSON.stringify(S)).toBe(before)
})

test('Coach explanation is offered only after consent; deterministic reason remains primary', () => {
  const S = { workouts: [{ d: '2026-08-01', entries: [] }], routines: [], programs: [] }
  expect(canAskCoach(S, true)).toBe(false)
  const consented = { ...S, coach: { consent: { agreedAt: '2026-09-28T00:00:00Z', version: 1 } } }
  expect(canAskCoach(consented, true)).toBe(true)
  expect(canAskCoach(consented, false)).toBe(false)
  expect(render(consented)).toContain('Why this suggestion?')
})
