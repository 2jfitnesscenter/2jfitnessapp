import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
const S = { gymProfiles: { activeId: 'home', overrides: { home: [] } } }
vi.mock('../store/useStore.js', () => ({ useStore: fn => fn({ S, update: vi.fn() }) }))
vi.mock('../sheets.jsx', () => ({ exercisePicker: vi.fn(), exConfigSheet: vi.fn(), exerciseNotesSheet: vi.fn(), confirmSheet: vi.fn() }))
vi.mock('../store/useUI.js', () => ({ useUI: fn => fn({ openSheet: vi.fn() }) }))
import DayCanvas from './constructor/DayCanvas.jsx'
import GymProfile from './GymProfile.jsx'
import { t } from '../lib/i18n.js'
test('Constructor keeps incompatible entries and renders a factual equipment warning', () => {
  const day = { ex: [{ id: '0025', sets: 3, reps: 10 }], blocks: [] }, before = JSON.stringify(day)
  const html = renderToStaticMarkup(<DayCanvas day={day} ctx={{ goal: 'hypertrophy', level: 'beginner' }} unit="kg" onChange={() => {}} />)
  expect(html).toContain(t('Equipment not confirmed here'))
  expect(JSON.stringify(day)).toBe(before)
})
test('quick selector shows official profiles and the active place', () => {
  const html = renderToStaticMarkup(<GymProfile />)
  expect(html).toContain('2J Fitness Center'); expect(html).toContain('Hotel')
  expect(html).toContain('value="home" selected')
})
