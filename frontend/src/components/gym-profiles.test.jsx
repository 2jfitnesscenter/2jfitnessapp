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
  expect(html).toContain(t('Search equipment'))
  expect(html).toContain(t('Save equipment'))
  expect(html).toContain(t('{0} selected', 0))
  expect(html).toContain('aria-label="What is the training place?"')
  expect(html).not.toContain('<select')
})
test('only admins see the official 2J inventory editor action', () => {
  mockStore.current.S = { gymProfiles: { activeId: '2j' } }
  mockStore.current.user = { admin: false }
  const member = renderToStaticMarkup(<GymProfileSheet close={() => {}} editable />)
  expect(member).not.toContain(t('Edit official equipment'))
  expect(member).toContain(t('Material managed by 2J Fitness Center'))
  expect(member).not.toContain(t('Search equipment'))
  mockStore.current.user = { admin: true }
  const admin = renderToStaticMarkup(<GymProfileSheet close={() => {}} editable />)
  expect(admin).toContain(t('Edit official equipment'))
  expect(admin).toContain('aria-pressed="true"')
})

/* Settings → "Where are you training today?": choosing a place, adding one and the add-place form layout. */
import { readFileSync } from 'node:fs'
import { gymProfilesOf, activeGymProfile, selectGymProfile, saveGymProfile } from '../lib/gym-profile-model.js'
const places = activeId => ({ gymProfiles: { activeId, custom: [
  { id: 'gym-a', name: 'Box Norte', type: 'other', availableEquipment: ['bodyweight'] },
  { id: 'gym-b', name: 'Garaje', type: 'custom', availableEquipment: ['bodyweight', 'dumbbell'] },
] } })

test('the chosen saved place is the selected one: chip, card and aria state follow the active place', () => {
  mockStore.current.S = places('gym-b')
  const html = renderToStaticMarkup(<GymProfileSheet close={() => {}} editable />)
  expect(html).toMatch(/gym-saved-place selected" aria-pressed="true">Garaje/)
  expect(html).toMatch(/gym-saved-place" aria-pressed="false">Box Norte/)
  const cards = html.match(/<button[^>]*gym-profile-card[^>]*>/g)
  expect(cards).toHaveLength(5)
  expect(cards.filter(c => c.includes('selected'))).toHaveLength(1)
  expect(cards.find(c => c.includes('selected'))).toBeTruthy()
  expect(html).toContain('Where are you training today?')
})

test('adding a place selects it, and the selection can move between places and survives a save/reload round trip', () => {
  const s = { gymProfiles: { activeId: '2j' } }
  saveGymProfile(s, { id: 'gym-new', name: 'Mi sala', type: 'other', availableEquipment: ['bodyweight'] }); selectGymProfile(s, 'gym-new')
  expect(activeGymProfile(s).name).toBe('Mi sala')
  saveGymProfile(s, { id: 'gym-two', name: 'Otra', type: 'custom', availableEquipment: ['bodyweight'] }); selectGymProfile(s, 'gym-two')
  expect(activeGymProfile(s).id).toBe('gym-two')
  selectGymProfile(s, 'gym-new'); expect(activeGymProfile(s).id).toBe('gym-new')           // two places of the same kind: each can be picked on its own
  selectGymProfile(s, 'home'); expect(activeGymProfile(s).id).toBe('home')                 // official places still work
  selectGymProfile(s, 'does-not-exist'); expect(activeGymProfile(s).id).toBe('home')       // unknown ids are ignored
  const reloaded = JSON.parse(JSON.stringify(s))
  expect(gymProfilesOf(reloaded).map(p => p.id)).toEqual(expect.arrayContaining(['2j', 'home', 'hotel', 'gym-new', 'gym-two']))
  selectGymProfile(reloaded, 'gym-two'); expect(activeGymProfile(JSON.parse(JSON.stringify(reloaded))).id).toBe('gym-two')
})

test('the add-place form keeps a usable field and a proportional button (the global .btn is full width)', () => {
  const css = readFileSync(new URL('../v2-screens.css', import.meta.url), 'utf8')
  expect(css).toMatch(/\.gym-create-row \.gym-create-button \{[^}]*width: auto/)
  expect(css).toMatch(/\.gym-create-row \.input \{[^}]*flex: 1 1 \d+px[^}]*min-height: 48px/)
  expect(css).toMatch(/\.gym-profile-card\.pending/)
})
