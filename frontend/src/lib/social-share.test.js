import { describe, expect, it } from 'vitest'
import { socialCardPayload } from './social-share.js'

describe('social share card payload', () => {
  it('keeps only bounded presentation fields and excludes private object fields', () => {
    const card = socialCardPayload('record', { title: 'Squat PR', metric: '100 kg × 5', date: '2026-09-27', health: { weight: 80 }, userId: 'private-id' })
    expect(card).toEqual({ kind: 'record', title: 'Squat PR', subtitle: '', metric: '100 kg × 5', date: '2026-09-27' })
    expect(JSON.stringify(card)).not.toContain('health')
    expect(JSON.stringify(card)).not.toContain('private-id')
  })
  it('rejects unsupported kinds and trims oversized fields', () => {
    expect(() => socialCardPayload('health', {})).toThrow()
    expect(socialCardPayload('routine', { title: 'x'.repeat(200) }).title).toHaveLength(80)
  })
})
