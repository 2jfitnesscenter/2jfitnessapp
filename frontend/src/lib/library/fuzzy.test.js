import { describe, expect, it } from 'vitest'
import { differsByOneEdit, scoreTypoFallback } from './fuzzy.js'

describe('bounded exercise typo matcher', () => {
  it('accepts one insertion, omission, substitution or adjacent transposition in long tokens', () => {
    for (const [query, word] of [
      ['sentadila', 'sentadilla'],
      ['presss', 'press'],
      ['benck', 'bench'],
      ['hip', 'hip'],
      ['trhust', 'thrust'],
      ['dumbbel', 'dumbbell'],
    ]) {
      if (query.length < 5) continue
      expect(differsByOneEdit(query, word)).toBe(true)
    }
  })

  it('rejects short tokens, unrelated words and multiple edits', () => {
    expect(differsByOneEdit('prss', 'press')).toBe(false)
    expect(differsByOneEdit('zzzzz', 'press')).toBe(false)
    expect(differsByOneEdit('sqat', 'squat')).toBe(false)
    expect(differsByOneEdit('sentadila', 'press')).toBe(false)
  })

  it('requires all query tokens to match and allows at most one typo', () => {
    const names = new Set(['hip', 'thrust'])
    expect(scoreTypoFallback(['hip', 'trhust'], names, new Set())).not.toBeNull()
    expect(scoreTypoFallback(['hip', 'trhust', 'sentadila'], names, new Set())).toBeNull()
    expect(scoreTypoFallback(['hip', 'zzzzz'], names, new Set())).toBeNull()
  })

  it('can use aliases, while still requiring one typo-sized match', () => {
    expect(scoreTypoFallback(['sentadila', 'trasera'], new Set(['back', 'squat']), new Set(['sentadilla', 'trasera']))).not.toBeNull()
    expect(scoreTypoFallback(['sentadila', 'trasera'], new Set(['back', 'squat']), new Set())).toBeNull()
  })
})
