import { describe, it, expect } from 'vitest'
import { supersetGroupInfo, supersetLabel, SUPERSET_COLOR_TOKENS, SUPERSET_GROUP_LETTERS } from './superset-colors.js'

const sg = (sgId) => sgId ? { sg: sgId } : {}

describe('supersetGroupInfo', () => {
  it('is null for every entry when nothing is superset', () => {
    const ex = [{ id: 'a' }, { id: 'b' }, { id: 'c' }]
    expect(supersetGroupInfo(ex)).toEqual([null, null, null])
  })

  it('labels a two-exercise group A1/A2, both sharing one color token', () => {
    const ex = [{ id: 'a', ...sg('g1') }, { id: 'b', ...sg('g1') }]
    const info = supersetGroupInfo(ex)
    expect(info[0]).toMatchObject({ letter: 'A', pos: 1, size: 2 })
    expect(info[1]).toMatchObject({ letter: 'A', pos: 2, size: 2 })
    expect(info[0].token).toBe(info[1].token)
  })

  it('assigns the second distinct group a different letter and a different color, by first-appearance order — never by the sg value itself', () => {
    // The second group's own sg id sorts BEFORE the first group's ("aaa" < "zzz"), which must
    // not matter: group order is read-order, not id order.
    const ex = [
      { id: 'a', ...sg('zzz-later') }, { id: 'b', ...sg('zzz-later') },
      { id: 'c' },
      { id: 'd', ...sg('aaa-earlier-string-but-appears-second') }, { id: 'e', ...sg('aaa-earlier-string-but-appears-second') },
    ]
    const info = supersetGroupInfo(ex)
    expect(info[0].letter).toBe('A')
    expect(info[3].letter).toBe('B')
    expect(info[0].token).not.toBe(info[3].token)
    expect(info[2]).toBeNull()
  })

  it('leaves a lone exercise wearing a stale sg (no adjacent partner) unlabeled, same as supersetUnits treats it', () => {
    const ex = [{ id: 'a', sg: 'orphan' }, { id: 'b' }]
    expect(supersetGroupInfo(ex)).toEqual([null, null])
  })

  it('supports a 3+ exercise superset (a "giant set"), all one letter, positions 1..n', () => {
    const ex = [{ id: 'a', ...sg('g') }, { id: 'b', ...sg('g') }, { id: 'c', ...sg('g') }]
    const info = supersetGroupInfo(ex)
    expect(info.map(i => i.pos)).toEqual([1, 2, 3])
    expect(info.every(i => i.letter === 'A')).toBe(true)
  })

  it('stays stable across a reorder that keeps the same groups (same input order in, same output out)', () => {
    const ex1 = [{ id: 'a', ...sg('g1') }, { id: 'b', ...sg('g1') }, { id: 'c', ...sg('g2') }, { id: 'd', ...sg('g2') }]
    const info1 = supersetGroupInfo(ex1)
    // Re-running on the identical array must reproduce identical letters/tokens — the whole
    // point of keying by read-order rather than randomness.
    const info2 = supersetGroupInfo(ex1)
    expect(info1).toEqual(info2)
  })

  it('wraps the color palette deterministically past the last named token, never at random', () => {
    const many = []
    SUPERSET_COLOR_TOKENS.forEach((_, gi) => { many.push({ id: 'x' + gi + 'a', sg: 'g' + gi }); many.push({ id: 'x' + gi + 'b', sg: 'g' + gi }) })
    // One more group than the palette has colors.
    many.push({ id: 'wrap-a', sg: 'wrap' }); many.push({ id: 'wrap-b', sg: 'wrap' })
    const info = supersetGroupInfo(many)
    const lastGroupToken = info[info.length - 1].token
    expect(lastGroupToken).toBe(SUPERSET_COLOR_TOKENS[0])   // wrapped back to the first color
    expect(info[info.length - 1].letter).toBe(SUPERSET_GROUP_LETTERS[SUPERSET_COLOR_TOKENS.length])
  })

  it('handles an empty or missing exercise list without throwing', () => {
    expect(supersetGroupInfo([])).toEqual([])
    expect(supersetGroupInfo(undefined)).toEqual([])
  })
})

describe('supersetLabel', () => {
  it('formats letter + position', () => {
    expect(supersetLabel({ letter: 'A', pos: 1 })).toBe('A1')
    expect(supersetLabel({ letter: 'C', pos: 2 })).toBe('C2')
  })
  it('is empty for a non-superset (null) entry', () => {
    expect(supersetLabel(null)).toBe('')
  })
})
