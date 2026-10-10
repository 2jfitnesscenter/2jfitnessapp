import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ user: { id: 'member-a' } }) }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: vi.fn(), openSheet: vi.fn() }) }))
vi.mock('../lib/friends-api.js', () => ({ fetchFriends: vi.fn().mockResolvedValue({ friends: [] }) }))
vi.mock('../lib/chat-api.js', () => ({ startDirectThread: vi.fn(), sendShare: vi.fn() }))
vi.mock('../lib/social-api.js', () => ({ createSocialShare: vi.fn(), reportSocialContent: vi.fn() }))
vi.mock('../lib/share-image.js', () => ({ capturePng: vi.fn(), sharePng: vi.fn(), captureOptions: vi.fn() }))

import SocialShareSheet from './SocialShareSheet.jsx'
import CommunityShareCard from './CommunityShareCard.jsx'
import ProgramShareCard from './ProgramShareCard.jsx'
import InternalShareActions from './InternalShareActions.jsx'
import { socialCardPayload, extrasText } from '../lib/social-share.js'
import { captureOptions } from '../lib/share-image.js'

const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8')

test('a program has a card of its own: name, facts, its routines (six at most) and what is left over', () => {
  const data = socialCardPayload('program', { title: 'Fuerza 4 días', subtitle: 'Para empezar', date: '1 oct 2026', items: ['Día 1', 'Día 2', 'Día 3', 'Día 4', 'Día 5', 'Día 6', 'Día 7', 'Día 8'], facts: ['4 days a week', 'Beginner'] })
  const h = renderToStaticMarkup(<ProgramShareCard data={data} aspect="story" />)
  expect(h).toContain('program-sharecard'); expect(h).toContain('data-share-kind="program"'); expect(h).toContain('data-aspect="story"')
  expect(h).toContain('Fuerza 4 días'); expect(h).toContain('4 days a week'); expect(h).toContain('Día 6'); expect(h).not.toContain('Día 7'); expect(h).toContain('+2 more')
  expect(h).toContain('2J FITNESS CENTER'); expect(h).toContain('1 oct 2026')
  expect(h).not.toMatch(/NaN|undefined/)
})

test('the community card comes in three shapes and shows optional numbers only when it is given them', () => {
  for (const aspect of ['card', 'story', 'square']) expect(renderToStaticMarkup(<CommunityShareCard data={{ kind: 'record', title: 'Press banca', metric: '80 kg × 5' }} aspect={aspect} />)).toContain(`data-aspect="${aspect}"`)
  expect(renderToStaticMarkup(<CommunityShareCard data={{ kind: 'workout', title: 'Torso', metric: '8 sets' }} />)).not.toContain('csc-extras')
  const h = renderToStaticMarkup(<CommunityShareCard data={{ kind: 'workout', title: 'Torso', metric: '8 sets', extras: { duration: 52, volume: 4200, unit: 'kg', prs: 1, cardio: 20, bodyweight: 81, health: 'x' } }} />)
  expect(h).toContain('52 min'); expect(h).toContain('1 record'); expect(h).toContain('20 min cardio'); expect(h).toMatch(/4,?200 kg lifted/)
  expect(h).not.toMatch(/81|health/)
  expect(extrasText({ prs: 3 })).toEqual(['3 records']); expect(extrasText(null)).toEqual([]); expect(extrasText({ duration: 'x' })).toEqual([])
})

test('the card payload only carries the allow-listed fields', () => {
  const p = socialCardPayload('workout', { title: 'T', metric: 'M', bodyweight: 80, health: { x: 1 }, items: ['a', '', 'b'], facts: 'nope' })
  expect(Object.keys(p).sort()).toEqual(['date', 'items', 'kind', 'metric', 'subtitle', 'title'])
  expect(p.items).toEqual(['a', 'b']); expect(p.facts).toBeUndefined()
})

test('the share sheet offers card / 9:16 / 1:1 and uses the program card for a program', () => {
  const h = renderToStaticMarkup(<SocialShareSheet data={socialCardPayload('program', { title: 'Plan', items: ['A'] })} shareTarget={null} close={() => {}} />)
  expect(h).toContain('>Card<'); expect(h).toContain('9:16'); expect(h).toContain('1:1'); expect(h).toContain('program-sharecard')
  expect(renderToStaticMarkup(<SocialShareSheet data={socialCardPayload('record', { title: 'Plan' })} shareTarget={null} close={() => {}} />)).toContain('data-share-kind="record"')
})

test('a shared workout offers four optional details, all off, with the promise about what is never included; other kinds offer none', () => {
  const h = renderToStaticMarkup(<InternalShareActions target={{ kind: 'workout', targetId: 'w1' }} />)
  expect((h.match(/type="checkbox"/g) || []).length).toBe(4); expect(h).not.toMatch(/ checked=""/)
  for (const label of ['Duration', 'Volume', 'Records', 'Cardio']) expect(h).toContain(label)
  expect(h).toContain('Body weight, health and notes are never included.')
  expect(renderToStaticMarkup(<InternalShareActions target={{ kind: 'streak', targetId: '3' }} />)).not.toContain('type="checkbox"')
})

test('export sizes: story is 270x480 and square 270x270 (1080 px wide at pixel ratio 4), the original keeps its width, and nothing is clipped', () => {
  expect(css).toMatch(/\.community-sharecard\[data-aspect="story"\]\{width:270px;min-height:480px/)
  expect(css).toMatch(/\.community-sharecard\[data-aspect="square"\]\{width:270px;min-height:270px/)
  expect(css).toMatch(/\.community-sharecard\{[^}]*width:320px;min-height:400px/)
  // the shared capture helper measures the rendered card, so a long program still exports whole
  expect(readFileSync(new URL('../lib/share-image.js', import.meta.url), 'utf8')).toContain('scrollHeight')
  expect(captureOptions).toBeDefined()
})
