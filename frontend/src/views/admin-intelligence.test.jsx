import { expect, test, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { AdminIntelligence } from './Admin.jsx'

vi.mock('../store/useStore.js', () => ({ useStore: () => ({}) }))

test('admin insight stays compact and labels automatic advice separately from trainer action', () => {
  const detail = { user: { id: 'member' }, workouts: [
    { d: '2026-09-27', entries: [{ id: '0025', target: { targetRepsMin: 8, targetRepsMax: 10 }, sets: [{ w: 80, r: 5, feel: 'fail', rpe: 10, done: true }] }] },
    { d: '2026-09-21', entries: [{ id: '0025', target: { targetRepsMin: 8, targetRepsMax: 10 }, sets: [{ w: 80, r: 5, feel: 'fail', rpe: 10, done: true }] }] },
  ] }
  const html = renderToStaticMarkup(<AdminIntelligence detail={detail} />)
  expect(html).toContain('2J suggestion')
  expect(html).toContain('Trainer decides')
  expect(html).toContain('View history')
  expect(html).toContain('Two recent sessions')
  expect(html).not.toMatch(/health|community|diagnosis/i)
})
