import { describe, expect, it } from 'vitest'
import { PROGRESS_IDS, PROGRESS_CARDS, normalizeProgress, progressOrder, visibleProgressCards, progressChoice, recommendedFor, goalPlanOf } from './progress-cards.js'
import { makeUx, PRESETS, USER_PREFS, uxOn, setAdminFeatures } from './features.js'

/* S.ux is the only personalisation store: Progress layout is two optional lists inside it. Legacy and untouched profiles keep the page exactly as it was. */
const DEFAULT = [...PROGRESS_IDS]

describe('legacy and untouched profiles keep the current page', () => {
  it('S.ux null, S.ux without progress, undefined state: every block in the default order', () => {
    for (const S of [undefined, {}, { ux: null }, { ux: { v: 1, at: 1, uses: {} } }, { ux: { v: 1, at: 1, uses: {}, progress: undefined } }]) {
      expect(progressOrder(S)).toEqual(DEFAULT); expect(visibleProgressCards(S)).toEqual(DEFAULT)
    }
  })
  it('malformed stored data is ignored, never fatal', () => {
    for (const progress of ['x', 3, [], { order: 'a', hidden: 7 }, { order: [1, null, {}], hidden: [false] }, { order: ['nope', 'weight', 'weight'] }]) {
      const S = { ux: { progress } }
      expect(() => visibleProgressCards(S)).not.toThrow()
      expect(new Set(progressOrder(S))).toEqual(new Set(DEFAULT)); expect(progressOrder(S)).toHaveLength(DEFAULT.length)
    }
    expect(normalizeProgress({ order: ['weight', 'nope', 'weight'], hidden: ['activity', 'x'] })).toEqual({ order: ['weight'], hidden: ['activity'] })
  })
  it('the catalogue is closed and small', () => {
    expect(PROGRESS_CARDS.length).toBeGreaterThanOrEqual(8); expect(PROGRESS_CARDS.length).toBeLessThanOrEqual(12)
    expect(new Set(PROGRESS_IDS).size).toBe(PROGRESS_IDS.length)
  })
})

describe('hide, show and re-order', () => {
  it('hiding removes the block and nothing else; showing it again restores its place', () => {
    const hidden = { ux: { progress: { order: DEFAULT, hidden: ['weight'] } } }
    expect(visibleProgressCards(hidden)).toEqual(DEFAULT.filter(i => i !== 'weight'))
    const shown = { ux: { progress: { order: DEFAULT, hidden: [] } } }
    expect(visibleProgressCards(shown)).toEqual(DEFAULT)
  })
  it('the member\'s order wins; blocks they never listed (a newer release) keep their default place', () => {
    const S = { ux: { progress: { order: ['activity', 'weight'], hidden: [] } } }
    const o = progressOrder(S)
    expect(o.indexOf('activity')).toBeLessThan(o.indexOf('weight'))                    // what they ordered keeps its relative order
    expect(new Set(o)).toEqual(new Set(DEFAULT)); expect(o).toHaveLength(DEFAULT.length)
    const full = [...DEFAULT].reverse()
    expect(progressOrder({ ux: { progress: { order: full } } })).toEqual(full)         // a complete saved order is respected exactly
    // a block missing from an old saved order lands right after its default predecessor
    const old = { ux: { progress: { order: DEFAULT.filter(i => i !== 'cardio') } } }
    const k = progressOrder(old)
    expect(k.indexOf('cardio')).toBe(k.indexOf(DEFAULT[DEFAULT.indexOf('cardio') - 1]) + 1)
  })
  it('an untouched layout is not stored at all; a changed one is stored whole', () => {
    expect(progressChoice(DEFAULT, [])).toBeUndefined()
    expect(progressChoice(DEFAULT, ['weight'])).toEqual({ order: DEFAULT, hidden: ['weight'] })
    const swapped = [...DEFAULT]; [swapped[0], swapped[1]] = [swapped[1], swapped[0]]
    expect(progressChoice(swapped, [])).toEqual({ order: swapped, hidden: [] })
  })
})

describe('persistence inside S.ux (no second store)', () => {
  const uses = Object.fromEntries(USER_PREFS.map(k => [k, true]))
  it('makeUx keeps the existing shape and adds progress only when given', () => {
    const plain = makeUx(uses, 5)
    expect(Object.keys(plain).sort()).toEqual(['at', 'uses', 'v']); expect(plain.v).toBe(1)
    const withLayout = makeUx(uses, 5, { progress: { order: DEFAULT, hidden: ['cardio'] } })
    expect(withLayout.progress).toEqual({ order: DEFAULT, hidden: ['cardio'] })
    expect(JSON.parse(JSON.stringify(withLayout))).toEqual(withLayout)                // survives the JSON round trip every sync does
    expect(makeUx(uses, 5, { progress: undefined })).toEqual(plain)
  })
  it('the feature gates still decide what is allowed: choosing a block never overrides an admin or member switch', () => {
    setAdminFeatures({ bodyweight: false })
    expect(uxOn({ ux: null }, 'bodyweight')).toBe(false)
    expect(visibleProgressCards({ ux: { progress: { order: DEFAULT, hidden: [] } } })).toContain('weight')   // listed, but Stats.jsx still applies uxOn('bodyweight') inside
    setAdminFeatures({})
  })
})

describe('goal defaults: applied only on an explicit action, and only to the layout/uses it is handed', () => {
  const base = PRESETS.balanced
  it('each goal brings its blocks first; unknown goals change nothing', () => {
    expect(recommendedFor({ coach: { profile: { goal: 'fatloss' } } }, base).progress.order.slice(0, 3)).toEqual(['weight', 'activity', 'composition'])
    expect(recommendedFor({ coach: { profile: { goal: 'hypertrophy' } } }, base).progress.order.slice(0, 3)).toEqual(['muscles', 'exercise', 'weight'])
    expect(recommendedFor({ coach: { profile: { goal: 'power' } } }, base).progress.order.slice(0, 2)).toEqual(['exercise', 'insights'])
    expect(recommendedFor({ coach: { profile: { goal: 'longevity' } } }, base).progress.order.slice(0, 3)).toEqual(['activity', 'health', 'last'])
    for (const S of [{}, { coach: { profile: { goal: 'padel' } } }, { coach: { profile: { goal: null } } }]) expect(recommendedFor(S, base).progress).toBeUndefined()   // default layout
    expect(goalPlanOf('unknown')).toBeNull()
  })
  it('it turns on what the goal needs (fat loss: weight, composition, activity, health) but never beyond what was asked', () => {
    const u = recommendedFor({ coach: { profile: { goal: 'fatloss' } } }, PRESETS.simple).uses
    expect(u.bodyweight).toBe(true); expect(u.bioimpedance).toBe(true); expect(u.health).toBe(true); expect(u.activity).toBe(true)
    const m = recommendedFor({ coach: { profile: { goal: 'fatloss' } } }, PRESETS.simple, { minimal: true })
    expect(m.uses).toEqual(PRESETS.simple); expect(m.progress).toBeUndefined()      // "just train" stays minimal whatever the goal
  })
  it('hypertrophy only adds body weight when the member actually logs it', () => {
    const S = { coach: { profile: { goal: 'hypertrophy' } } }
    expect(recommendedFor(S, PRESETS.simple, {}).uses.bodyweight).toBe(PRESETS.simple.bodyweight)
    expect(recommendedFor(S, { ...PRESETS.simple, bodyweight: false }, { logged: { bodyweight: true } }).uses.bodyweight).toBe(true)
    expect(recommendedFor(S, { ...PRESETS.simple, bodyweight: false }, { logged: { bodyweight: false } }).uses.bodyweight).toBe(false)
    expect(recommendedFor(S, { ...PRESETS.simple, bodyweight: false }, { logged: { bodyweight: true } }).uses.volume).toBe(true)
  })
  it('after the member personalises, their choice rules: the goal is never consulted by the readers', () => {
    const mine = { order: ['cardio', ...DEFAULT.filter(i => i !== 'cardio')], hidden: ['weight'] }
    for (const goal of ['fatloss', 'hypertrophy', 'power', 'longevity', null]) {
      const S = { coach: { profile: { goal } }, ux: { progress: mine } }
      expect(visibleProgressCards(S)).toEqual(mine.order.filter(i => i !== 'weight'))
    }
  })
})
