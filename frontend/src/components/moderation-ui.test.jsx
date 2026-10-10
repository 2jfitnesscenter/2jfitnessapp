import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'

vi.mock('../store/useUI.js', () => ({ useUI: Object.assign(selector => selector({ toast: vi.fn(), openSheet: vi.fn() }), { getState: () => ({ openSheet: vi.fn(), toast: vi.fn() }) }) }))
vi.mock('../lib/social-api.js', () => ({ reportSocialContent: vi.fn() }))

import ReportContentButton from './ReportContentButton.jsx'

test('the inline report keeps its form; the icon variant is one small labelled button for messages and comments', () => {
  expect(renderToStaticMarkup(<ReportContentButton targetType="share" targetId="s1" />)).toContain('report-control')
  const icon = renderToStaticMarkup(<ReportContentButton icon targetType="message" targetId="t1:m1" />)
  expect(icon).toContain('report-icon'); expect(icon).toContain('aria-label="Report"'); expect(icon).not.toContain('<select')
})

test('chat shows a removed message as removed, a flag on the other person\'s messages only, and the polling cursor', () => {
  const chat = readFileSync(new URL('../views/ChatThread.jsx', import.meta.url), 'utf8')
  expect(chat).toContain("m.type === 'removed'")
  expect(chat).toMatch(/!mine && <ReportContentButton icon targetType="message"/)
  expect(chat).toContain('after: held.current.list.at(-1)')
})

test('every comment in the three places has a report flag for others, and the removal notice reads in Spanish', () => {
  const social = readFileSync(new URL('../views/Social.jsx', import.meta.url), 'utf8')
  for (const kind of ['wall', 'topic', 'board']) expect(social).toContain(`targetType="comment" targetId={'${kind}:'`)
  const es = readFileSync(new URL('../locales/es.js', import.meta.url), 'utf8')
  for (const k of ['Your {0} was removed for not following the community rules', 'This message was removed', 'Something you posted was removed', 'Sent to {0}']) expect(es).toContain(`'${k}':`)
  const notifications = readFileSync(new URL('../views/Notifications.jsx', import.meta.url), 'utf8')
  expect(notifications).toContain('moderation:')
})
