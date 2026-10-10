import { describe, it, expect } from 'vitest'
import { getExerciseAlternatives, getReplacementGroups, QUICK_FILTERS, sameEquipment, matchesQuickFilter } from './alternatives.js'
import { setHiddenExercises, setUnavailableEquipment, EXIDX } from './exercises.js'
import { compatibleWithGym } from './gym-profiles.js'

const BENCH = '0025'          // barbell bench press — tg: pectorals, eq: barbell
const DECLINE_BENCH = '0033'   // barbell decline bench press — tg: pectorals, eq: barbell (exact match)
const DUMBBELL_PUSHUP = '1274' // deep push up — tg: pectorals, eq: dumbbell
const CABLE_BENCH = '0151'     // cable bench press — tg: pectorals, eq: cable
const TRICEP_DIP = '0019'      // assisted triceps dip — tg: triceps, sm includes chest/shoulders

const baseS = (over = {}) => ({ customEx: [], ...over })

describe('getExerciseAlternatives', () => {
  it('never includes the exercise itself', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    expect(alts.some(a => a.ex.id === BENCH)).toBe(false)
  })

  it('labels the same muscle + same equipment as an exact match', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const decline = alts.find(a => a.ex.id === DECLINE_BENCH)
    expect(decline).toBeTruthy()
    expect(decline.matchKey).toBe('exact')
    expect(decline.sameEquipment).toBe(true)
  })

  it('labels same muscle + different equipment as sameMuscle, not exact', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const cable = alts.find(a => a.ex.id === CABLE_BENCH)
    expect(cable).toBeTruthy()
    expect(cable.matchKey).toBe('sameMuscle')
    expect(cable.sameEquipment).toBe(false)
  })

  it('same primary muscle, different equipment -> sameMuscle', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const pushup = alts.find(a => a.ex.id === DUMBBELL_PUSHUP)
    expect(pushup).toBeTruthy()
    expect(pushup.matchKey).toBe('sameMuscle')
    expect(pushup.sameEquipment).toBe(false)
  })

  it('no shared primary muscle but real secondary overlap -> related', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const dip = alts.find(a => a.ex.id === TRICEP_DIP)
    expect(dip).toBeTruthy()
    expect(dip.matchKey).toBe('related')
  })

  it('ranks same-muscle matches above merely-related ones', () => {
    const alts = getExerciseAlternatives(baseS(), BENCH)
    const pushupIdx = alts.findIndex(a => a.ex.id === DUMBBELL_PUSHUP)
    const dipIdx = alts.findIndex(a => a.ex.id === TRICEP_DIP)
    expect(pushupIdx).toBeGreaterThanOrEqual(0)
    expect(dipIdx).toBeGreaterThan(pushupIdx)
  })

  it('is empty for an unknown exercise id', () => {
    expect(getExerciseAlternatives(baseS(), 'nope-not-real')).toEqual([])
  })

  // V1.2 — the "Replace exercise" picker must never offer a candidate the gym itself has
  // hidden (out of equipment, retired from the floor), same rule allExercises() already
  // enforces for every other picker in the app.
  it('never offers a candidate the gym has hidden', () => {
    setHiddenExercises([DECLINE_BENCH])
    const alts = getExerciseAlternatives(baseS(), BENCH)
    setHiddenExercises([])
    expect(alts.some(a => a.ex.id === DECLINE_BENCH)).toBe(false)
  })

  // V2 — a "Machine Smith blocked" style admin action must not offer another Smith exercise
  // as the "fix" (section 22): the same exclusion isHidden already gets, now also for equipment.
  it('never offers a candidate whose equipment is currently marked unavailable', () => {
    setUnavailableEquipment(['barbell'])   // DECLINE_BENCH's own equipment
    const alts = getExerciseAlternatives(baseS(), BENCH)
    setUnavailableEquipment([])
    expect(alts.some(a => a.ex.id === DECLINE_BENCH)).toBe(false)
  })

  it('an exercise on unaffected equipment is still offered while another equipment is blocked', () => {
    setUnavailableEquipment(['barbell'])
    const alts = getExerciseAlternatives(baseS(), BENCH)
    setUnavailableEquipment([])
    expect(alts.some(a => a.ex.id === CABLE_BENCH)).toBe(true)
  })
})

describe('QUICK_FILTERS', () => {
  it('covers the four pills the brief asks for', () => {
    expect(QUICK_FILTERS.map(f => f.key)).toEqual(['same', 'dumbbell', 'cable', 'machine'])
  })
})

describe('getReplacementGroups', () => {
  it('keeps personal custom alternatives scoped to each Bunker member context', () => {
    const personal = id => ({ id, n: id, bp: 'chest', tg: 'pectorals', eq: 'dumbbell', sm: [] })
    const a = getReplacementGroups(baseS({ customEx: [personal('c-ana')], gymProfiles: { activeId: '2j' } }), BENCH)
    const b = getReplacementGroups(baseS({ customEx: [personal('c-bruno')], gymProfiles: { activeId: '2j' } }), BENCH)
    expect(a.all.some(x => x.ex.id === 'c-ana')).toBe(true)
    expect(a.all.some(x => x.ex.id === 'c-bruno')).toBe(false)
    expect(b.all.some(x => x.ex.id === 'c-bruno')).toBe(true)
    expect(b.all.some(x => x.ex.id === 'c-ana')).toBe(false)
  })
  it('keeps ranked recommendations and exposes the complete available catalogue', () => {
    const groups = getReplacementGroups(baseS(), BENCH)
    expect(groups.recommended.length).toBeGreaterThan(0)
    expect(groups.recommended.length).toBeLessThanOrEqual(8)
    expect(groups.related.length).toBeGreaterThanOrEqual(groups.recommended.length)
    expect(groups.all.length).toBeGreaterThan(groups.related.length)
    expect(groups.all.some(a => a.ex.id === BENCH)).toBe(false)
  })

  it('allows a deliberately unrelated exercise and labels it for a discreet warning', () => {
    const groups = getReplacementGroups(baseS(), BENCH)
    const unrelated = groups.all.find(a => !groups.relatedIds.has(a.ex.id))
    expect(unrelated).toBeTruthy()
    expect(unrelated.matchKey).toBe('unrelated')
  })
})

describe('equipment is compared by the Library\'s canonical id, not the raw dataset string', () => {
  const ex = id => EXIDX[id]
  it('"band" and "resistance band" are the same equipment; so are "barbell" and "olympic barbell"', () => {
    expect(ex('3124').eq).toBe('resistance band'); expect(ex('0989').eq).toBe('band')
    expect(sameEquipment(ex('3124'), ex('0989'))).toBe(true)
    expect(sameEquipment(ex('0636'), ex(BENCH))).toBe(true)          // olympic barbell vs barbell
    expect(sameEquipment(ex(BENCH), ex(CABLE_BENCH))).toBe(false)
  })

  it('a record without a canonical equipment (custom, legacy) still compares by the raw string', () => {
    expect(sameEquipment({ id: 'c1', eq: 'sandbag' }, { id: 'c2', eq: 'sandbag' })).toBe(true)
    expect(sameEquipment({ id: 'c1', eq: 'sandbag' }, { id: 'c2', eq: 'kettlebell' })).toBe(false)
    expect(sameEquipment({ id: 'c1', eq: 'custom' }, ex(BENCH))).toBe(false)
    expect(sameEquipment(null, ex(BENCH))).toBe(false)
  })

  it('swap results mark sameEquipment from the canonical id, in both the alternatives and the variants', () => {
    const groups = getReplacementGroups(baseS(), '3124')
    const band = groups.all.find(a => a.ex.id === '0989')
    expect(groups.recommended.concat(groups.related).filter(a => a.ex.eq === 'band').every(a => a.sameEquipment)).toBe(true)
    expect(band).toBeTruthy()
    expect(getExerciseAlternatives(baseS(), BENCH).find(a => a.ex.id === DECLINE_BENCH)).toMatchObject({ matchKey: 'exact', sameEquipment: true })
  })

  it('the quick filters use canonical groups and keep selecting what the raw strings used to', () => {
    expect(QUICK_FILTERS.map(f => f.key)).toEqual(['same', 'dumbbell', 'cable', 'machine'])
    const pass = (key, id, ref = ex(BENCH)) => matchesQuickFilter(key, ex(id), ref)
    expect(pass('dumbbell', DUMBBELL_PUSHUP)).toBe(true); expect(pass('dumbbell', CABLE_BENCH)).toBe(false)
    expect(pass('cable', CABLE_BENCH)).toBe(true)
    for (const id of ['1299', '0577', '0576', '0766']) expect(pass('machine', id), id).toBe(true)   // machine, weight stack, plate-loaded, Smith
    expect(pass('machine', '0739')).toBe(false)                       // a sled was never part of "machines" here
    expect(pass('same', DECLINE_BENCH)).toBe(true); expect(pass('same', CABLE_BENCH)).toBe(false)
    expect(matchesQuickFilter('nope', ex(BENCH), ex(BENCH))).toBe(true)
    // legacy raw record
    expect(matchesQuickFilter('machine', { id: 'x', eq: 'leverage machine' }, ex(BENCH))).toBe(true)
    expect(matchesQuickFilter('cable', { id: 'x', eq: 'sandbag' }, ex(BENCH))).toBe(false)
  })

  it('exercises the active gym profile can host come first', () => {
    const home = { gymProfiles: { activeId: 'home' } }
    const groups = getReplacementGroups(baseS(home), BENCH)
    const firstIncompatible = groups.related.findIndex(a => !compatibleWithGym(baseS(home), a.ex))
    const lastCompatible = groups.related.map(a => compatibleWithGym(baseS(home), a.ex)).lastIndexOf(true)
    expect(groups.related.some(a => compatibleWithGym(baseS(home), a.ex))).toBe(true)
    expect(lastCompatible).toBeLessThan(firstIncompatible)
  })
})
