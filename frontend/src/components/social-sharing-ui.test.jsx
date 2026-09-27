import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../store/useStore.js', () => ({ useStore: selector => selector({ user: { id: 'member-a' } }) }))
vi.mock('../store/useUI.js', () => ({ useUI: selector => selector({ toast: vi.fn(), openSheet: vi.fn() }) }))
vi.mock('../lib/friends-api.js', () => ({ fetchFriends: vi.fn().mockResolvedValue({ friends: [] }) }))
vi.mock('../lib/chat-api.js', () => ({ startDirectThread: vi.fn(), sendShare: vi.fn() }))
vi.mock('../lib/social-api.js', () => ({ createSocialShare: vi.fn(), reportSocialContent: vi.fn() }))
vi.mock('../lib/share-image.js', () => ({ capturePng: vi.fn(), sharePng: vi.fn() }))

import SocialShareSheet from './SocialShareSheet.jsx'
import CommunityShareCard from './CommunityShareCard.jsx'
import ReportContentButton from './ReportContentButton.jsx'

test.each(['workout', 'achievement', 'streak'])('renders an illustrated %s card for export', kind => {
  const html = renderToStaticMarkup(<CommunityShareCard data={{ kind, title: 'Training moment', metric: '8 weeks' }} />)
  expect(html).toContain(`data-share-kind="${kind}"`)
  expect(html).toContain('Training moment')
  expect(html).toContain('csc-art-icon')
})

test('share sheet explains control and offers in-app plus image destinations', () => {
  const html = renderToStaticMarkup(<SocialShareSheet data={{ kind: 'workout', title: 'Session', metric: '20 sets' }} shareTarget={{ kind: 'workout', targetId: 'w1' }} close={() => {}} />)
  expect(html).toContain('Share inside 2J')
  expect(html).toContain('Community')
  expect(html).toContain('Send to a friend')
  expect(html).toContain('Share image')
})

test('report flow begins with a compact user action and reason selector when opened by UI', () => {
  const html = renderToStaticMarkup(<ReportContentButton targetType="share" targetId="share-1" />)
  expect(html).toContain('Report')
  expect(html).not.toContain('<select')
})
