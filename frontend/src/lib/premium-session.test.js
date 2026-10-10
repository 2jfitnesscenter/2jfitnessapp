import { describe, expect, it } from 'vitest'
import seed from '../../../api/lib/premium-official.json'
import { activate, runningView } from './premium.js'
import { premiumEntries } from './premium-session.js'

const prog = slug => seed.programs.find(p => p.slug === slug)
const base = (slug, tm) => { const S = { unit: 'kg', workouts: [], routines: [], programs: [] }; S.premium = activate(S, prog(slug), { tm, now: Date.parse('2026-10-11T10:00:00Z'), id: 'x' }); return S }

describe('a planned Premium session becomes the entries of a normal workout', () => {
  it('5/3/1 week 1 (press day, TM 50): warm-ups, then 65/75/85 % of the Training Max with an AMRAP last set', () => {
    const S = base('531', { squat: 100, bench: 70, deadlift: 120, press: 50 })
    const v = runningView(S)
    const entries = premiumEntries(S, v.plan, { unit: 'kg', warmups: true })
    const main = entries[0]
    const work = main.sets.filter(s => s.type !== 'warmup')
    expect(work.map(s => [s.w, s.r])).toEqual([[32.5, 5], [37.5, 5], [42.5, 5]])
    expect(work[2].amrap).toBe(true); expect(work.every(s => s.done === false)).toBe(true)
    expect(main.sets.some(s => s.type === 'warmup')).toBe(true)
    expect(main.plan.premium).toBe(true); expect(main.plan.why[0]).toMatch(/Training Max/)
  })
  it('warm-ups can be switched off and a program without Training Max still builds from the app engine', () => {
    const S = base('531', { squat: 100, bench: 70, deadlift: 120, press: 50 })
    expect(premiumEntries(S, runningView(S).plan, { warmups: false })[0].sets.some(s => s.type === 'warmup')).toBe(false)
    const F = base('full-body-hypertrophy', {})
    const entries = premiumEntries(F, runningView(F).plan, {})
    expect(entries.length).toBeGreaterThan(2); expect(entries.every(e => e.sets.length > 0)).toBe(true)
  })
  it('blocked blocks (a lift with no Training Max) are left out, never guessed', () => {
    const S = base('531', { squat: 100 })
    const v = runningView(S)
    expect(v.missing.length).toBe(3)
    expect(premiumEntries(S, v.plan, {}).length).toBeLessThan(v.plan.blocks.length)
  })
  it('conditioning blocks become cardio or timed entries', () => {
    const S = base('full-body-conditioning', {})
    const entries = premiumEntries(S, runningView(S).plan, {})
    expect(entries.length).toBeGreaterThan(0)
  })
})
