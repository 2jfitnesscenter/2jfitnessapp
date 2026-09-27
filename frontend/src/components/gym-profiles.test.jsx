import { beforeEach, expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const S = { gymProfiles: { activeId: 'home', overrides: { home: [] } } }
const mockStore = vi.hoisted(() => ({ current: null }))
vi.mock('../store/useStore.js', () => ({ useStore: fn => fn(mockStore.current) }))
vi.mock('../sheets.jsx', () => ({ exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseNotesSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: fn => fn({ openSheet: vi.fn() }) }))
import DayCanvas from './constructor/DayCanvas.jsx'
import GymProfile, { GymProfileSheet } from './GymProfile.jsx'
import { t } from '../lib/i18n.js'
beforeEach(() => { mockStore.current = { S, update: vi.fn(), user: { admin: false }, gymProfileRevision: 0, saveOfficialGymEquipment: vi.fn() } })
test('Constructor keeps incompatible entries and renders a factual equipment warning', () => {
  const day = { ex: [{ id: '0025', sets: 3, reps: 10 }], blocks: [] }, before = JSON.stringify(day)
  const html = renderToStaticMarkup(<DayCanvas day={day} ctx={{ goal: 'hypertrophy', level: 'beginner' }} unit="kg" onChange={() => {}} />)
  expect(html).toContain(t('Equipment not confirmed here'))
  expect(JSON.stringify(day)).toBe(before)
})
test('training place opens a visual selector row instead of a native dropdown', () => {
  const html = renderToStaticMarkup(<GymProfile />)
  expect(html).toContain('Training place'); expect(html).toContain('Home gym')
  expect(html).toContain('lrow-c'); expect(html).not.toContain('<select')
})
test('visual place sheet shows five profile cards, active state, equipment chips and contextual help', () => {
  const html = renderToStaticMarkup(<GymProfileSheet close={() => {}} editable />)
  expect(html).toContain('Where are you training today?')
  for (const name of ['2J Fitness Center', 'Home gym', 'Hotel', 'Other gym', 'Custom gym']) expect(html).toContain(name)
  expect(html).toContain('aria-pressed="true"')
  expect(html).toContain('Material available')
  expect(html).toContain('aria-label="What is the training place?"')
  expect(html).not.toContain('<select')
})
test('only admins see the official 2J inventory editor action', () => {
  mockStore.current.S = { gymProfiles: { activeId: '2j' } }
  mockStore.current.user = { admin: false }
  const member = renderToStaticMarkup(<GymProfileSheet close={() => {}} editable />)
  expect(member).not.toContain(t('Edit official equipment'))
  mockStore.current.user = { admin: true }
  const admin = renderToStaticMarkup(<GymProfileSheet close={() => {}} editable />)
  expect(admin).toContain(t('Edit official equipment'))
  expect(admin).toContain('aria-pressed="true"')
})
