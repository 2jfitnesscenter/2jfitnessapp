import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const S = { gymProfiles: { activeId: 'home', overrides: { home: [] } } }
vi.mock('../store/useStore.js', () => ({ useStore: fn => fn({ S, update: vi.fn() }) }))
vi.mock('../sheets.jsx', () => ({ exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseNotesSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: fn => fn({ openSheet: vi.fn() }) }))
import DayCanvas from './constructor/DayCanvas.jsx'
import GymProfile, { GymProfileSheet } from './GymProfile.jsx'
import { t } from '../lib/i18n.js'
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
