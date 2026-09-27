import { describe, expect, it } from 'vitest'
import { communityIntroSeen, markCommunityIntroSeen } from './community-onboarding.js'

const memoryStorage = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v) } }

describe('Community intro persistence', () => {
  it('remembers dismissal for that user and does not suppress another account', () => {
    const storage = memoryStorage()
    expect(communityIntroSeen(storage, 'a')).toBe(false)
    expect(markCommunityIntroSeen(storage, 'a')).toBe(true)
    expect(communityIntroSeen(storage, 'a')).toBe(true)
    expect(communityIntroSeen(storage, 'b')).toBe(false)
  })
  it('fails open when local storage is unavailable', () => {
    const blocked = { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } }
    expect(communityIntroSeen(blocked, 'a')).toBe(false)
    expect(markCommunityIntroSeen(blocked, 'a')).toBe(false)
  })
})
