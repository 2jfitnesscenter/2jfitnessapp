import { expect, test } from 'vitest'
import { adminIntelligenceFor } from './admin-intelligence.js'

test('admin-only detail projects at most three history signals without Health or Community', () => {
  const now = Date.parse('2026-09-28T12:00:00Z')
  const detail = { user: { id: 'm1' }, unit: 'kg', workouts: [{ d: '2026-08-01', entries: [] }],
    health: { private: true }, community: { private: true }, bodyweight: [{ w: 80 }] }
  const cards = adminIntelligenceFor(detail, now)
  expect(cards.map(r => r.type)).toContain('RETURN_AFTER_GAP')
  expect(cards.length).toBeLessThanOrEqual(3)
  expect(JSON.stringify(cards)).not.toMatch(/bodyweight|health|community|private/)
  expect(adminIntelligenceFor({ workouts: detail.workouts }, now)).toEqual([])
})
