import { describe, it, expect } from 'vitest'
import { purgeStaleCredentials } from './bunker-credentials.js'

const cred = (token = 't') => ({ token, name: 'x', exp: Date.now() + 3600000 })
const card = uid => ({ uid, name: uid, checkinAt: Date.now(), exName: null, setIdx: 0, setsTotal: 0, restEndsAt: null, paused: false })

describe('purgeStaleCredentials', () => {
  it('keeps a credential whose card is still on the board — minimizing never removes it', () => {
    const credentials = { a: cred() }
    const next = purgeStaleCredentials(credentials, [card('a')], null)
    expect(next).toEqual({ a: credentials.a })
  })

  it('drops a credential whose card is no longer on the board (finished, force-closed, idle timeout)', () => {
    const credentials = { a: cred() }
    const next = purgeStaleCredentials(credentials, [], null)
    expect(next).toEqual({})
  })

  it('never drops the currently active panel\'s own credential, even if its card is momentarily missing from the board', () => {
    const credentials = { a: cred() }
    const next = purgeStaleCredentials(credentials, [], 'a')
    expect(next).toEqual({ a: credentials.a })
  })

  it('keeps A and drops B independently — no cross-user interference', () => {
    const credentials = { a: cred('token-a'), b: cred('token-b') }
    const next = purgeStaleCredentials(credentials, [card('a')], null)
    expect(next).toEqual({ a: credentials.a })
    expect(next.b).toBeUndefined()
  })

  it('alternating A -> B -> A -> B keeps both credentials intact the whole time, as long as both cards stay on the board', () => {
    let credentials = { a: cred('token-a'), b: cred('token-b') }
    const board = [card('a'), card('b')]
    for (const active of ['a', 'b', 'a', 'b']) {
      credentials = purgeStaleCredentials(credentials, board, active)
    }
    expect(Object.keys(credentials).sort()).toEqual(['a', 'b'])
  })

  it('returns the exact same object reference when nothing changed — avoids an unnecessary re-render', () => {
    const credentials = { a: cred() }
    const next = purgeStaleCredentials(credentials, [card('a')], null)
    expect(next).toBe(credentials)
  })

  it('handles an empty credentials map and an empty board without throwing', () => {
    expect(purgeStaleCredentials({}, [], null)).toEqual({})
    expect(purgeStaleCredentials({}, [card('a')], null)).toEqual({})
  })
})
