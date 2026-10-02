import { afterEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import { FEATURE_KEYS, FEATURE_GROUPS, USER_PREFS, PRESETS, setAdminFeatures, getAdminFeatures, allowedByAdmin, chosenByMember, uxOn, helpsOn, configurable, makeUx, currentUses } from './features.js'
import { effortOf } from './history.js'
import { coachAvailable } from './coach.js'
import { workoutPrefs } from './workout-prefs.js'

afterEach(() => setAdminFeatures({}))

describe('feature keys', () => {
  it('are the same list the server knows (api/lib/features-store.js)', () => {
    const src = fs.readFileSync(new URL('../../../api/lib/features-store.js', import.meta.url), 'utf8')
    const server = [...src.slice(src.indexOf('FEATURE_KEYS'), src.indexOf('];', src.indexOf('FEATURE_KEYS'))).matchAll(/'([a-z0-9]+)'/g)].map(m => m[1])
    expect([...FEATURE_KEYS].sort()).toEqual([...server].sort())
  })
  it('every admin-screen entry is a real key, once; every member preference is a real key or the member-only hints', () => {
    const listed = FEATURE_GROUPS.flatMap(g => g.keys.map(k => k.key))
    expect(new Set(listed).size).toBe(listed.length)
    expect(listed.sort()).toEqual([...FEATURE_KEYS].sort())
    for (const k of USER_PREFS) expect(k === 'helps' || FEATURE_KEYS.includes(k)).toBe(true)
  })
})

describe('precedence: admin ∩ member', () => {
  const S = uses => ({ ux: uses ? makeUx(uses) : null })
  it('a profile never personalised keeps today’s behaviour: everything the admin allows is on', () => {
    for (const k of FEATURE_KEYS) expect(uxOn(S(null), k)).toBe(true)
    expect(uxOn(null, 'effort')).toBe(true)
    expect(helpsOn(S(null))).toBe(true)
  })
  it('an admin switch off wins over everything, and a member can never bring it back', () => {
    setAdminFeatures({ effort: false, social: false })
    expect(uxOn(S(null), 'effort')).toBe(false)
    expect(uxOn(S({ effort: true }), 'effort')).toBe(false)          // the member said yes — still off
    expect(uxOn(S({ social: true }), 'chat')).toBe(true)              // chat is its own admin switch…
    setAdminFeatures({ chat: false })
    expect(uxOn(S({ social: true }), 'chat')).toBe(false)             // …and off means off
  })
  it('with the admin on, the member decides', () => {
    expect(uxOn(S({ effort: false }), 'effort')).toBe(false)
    expect(uxOn(S({ effort: true }), 'effort')).toBe(true)
    expect(chosenByMember(S({ volume: false }), 'volume')).toBe(false)
  })
  it('chat, friends and challenges follow the member’s Social choice', () => {
    const off = S({ social: false })
    for (const k of ['social', 'chat', 'friends', 'challenges']) expect(uxOn(off, k)).toBe(false)
    expect(uxOn(S({ social: true }), 'friends')).toBe(true)
  })
  it('visual hints belong to the member alone: no admin switch can touch them', () => {
    setAdminFeatures({ helps: false })
    expect(helpsOn(S(null))).toBe(true)
    expect(helpsOn(S({ helps: false }))).toBe(false)
  })
  it('a failed or missing admin config never switches anything off', () => {
    setAdminFeatures(undefined); expect(allowedByAdmin('coach')).toBe(true)
    setAdminFeatures('nope'); expect(getAdminFeatures()).toEqual({}); expect(allowedByAdmin('coach')).toBe(true)
  })
})

describe('what the configurator offers', () => {
  it('only the features the admin left on (plus the member-only hints), so no switch ever does nothing', () => {
    expect(configurable().sort()).toEqual([...USER_PREFS].sort())
    setAdminFeatures({ coach: false, bodyweight: false, social: false })
    const c = configurable()
    expect(c).not.toContain('coach'); expect(c).not.toContain('bodyweight'); expect(c).not.toContain('social')
    expect(c).toContain('helps'); expect(c).toContain('effort')
  })
  it('presets cover every member preference and make sense: simple < balanced < complete', () => {
    for (const p of Object.values(PRESETS)) expect(Object.keys(p).sort()).toEqual([...USER_PREFS].sort())
    const on = p => Object.values(p).filter(Boolean).length
    expect(on(PRESETS.simple)).toBeLessThan(on(PRESETS.balanced))
    expect(on(PRESETS.balanced)).toBeLessThan(on(PRESETS.complete))
    expect(PRESETS.simple.effort).toBe(false); expect(PRESETS.complete.effort).toBe(true)
  })
  it('makeUx stores only known preferences, defaulting to on; currentUses reads "never personalised" as all on', () => {
    expect(Object.keys(makeUx({ nope: false }).uses).sort()).toEqual([...USER_PREFS].sort())
    expect(makeUx({ effort: false }).uses.effort).toBe(false); expect(makeUx({}).uses.coach).toBe(true)
    expect(makeUx({}).v).toBe(1)
    expect(Object.values(currentUses({ ux: null })).every(Boolean)).toBe(true)
    expect(currentUses({ ux: makeUx({ volume: false }) }).volume).toBe(false)
  })
})

describe('the central gates', () => {
  it('effort: logging goes quiet when the admin or the member turns it off; the stored choice is kept', () => {
    const S = { effort: 'rpe', ux: null }
    expect(effortOf(S)).toBe('rpe')
    expect(effortOf({ ...S, ux: makeUx({ effort: false }) })).toBe('none')
    setAdminFeatures({ effort: false })
    expect(effortOf(S)).toBe('none')
    expect(S.effort).toBe('rpe')
  })
  it('the Coach is unavailable when the admin switches it off, even where a provider exists', () => {
    const config = { coach: { enabled: true } }, user = { id: 'u' }
    expect(coachAvailable(config, user)).toBe(true)
    setAdminFeatures({ coach: false })
    expect(coachAvailable(config, user)).toBe(false)
    expect(coachAvailable(config, user, { demo: true })).toBe(false)
  })
  it('the progression assistant follows the suggestions switch', () => {
    expect(workoutPrefs({ enableProgressiveOverloadCoach: true, ux: null }).progression).toBe(true)
    expect(workoutPrefs({ enableProgressiveOverloadCoach: true, ux: makeUx({ suggestions: false }) }).progression).toBe(false)
    setAdminFeatures({ suggestions: false })
    expect(workoutPrefs({ enableProgressiveOverloadCoach: true, ux: null }).progression).toBe(false)
  })
})
