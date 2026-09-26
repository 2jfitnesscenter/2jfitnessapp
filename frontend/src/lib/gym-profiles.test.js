import { afterEach, expect, test } from 'vitest'
import { activeGymProfile, gymProfilesOf, saveGymProfile, selectGymProfile, compatibleWithGym, gymExerciseList, gymRoutineCompatibility } from './gym-profiles.js'
import { EXDB, setUnavailableEquipment } from './exercises.js'
import { facets } from './library/index.js'
import { getReplacementGroups } from './alternatives.js'
const state = id => ({ gymProfiles: { activeId: id }, workouts: [], routines: [], customEx: [] })
const ex = eq => EXDB.find(e => facets(e)?.equipment === eq)
afterEach(() => setUnavailableEquipment([]))
test('legacy/default is 2J without mutating or seeding state', () => {
  const S = {}; expect(activeGymProfile(S).id).toBe('2j'); expect(S).toEqual({})
  expect(activeGymProfile(S).availableEquipment).not.toContain('smith')
})
test('official profiles have stable ids and only home/hotel permit personal overrides', () => {
  const S = state('home'); saveGymProfile(S, { id: 'home', availableEquipment: ['dumbbell', 'dumbbell', 'invented'] })
  expect(activeGymProfile(S).availableEquipment).toEqual(['dumbbell'])
  saveGymProfile(S, { id: '2j', availableEquipment: [] }); selectGymProfile(S, '2j')
  expect(activeGymProfile(S).availableEquipment).toContain('barbell')
})
test('Hotel conservatively starts bodyweight; an explicitly empty list stays empty', () => {
  const S = state('hotel'); expect(activeGymProfile(S).availableEquipment).toEqual(['bodyweight'])
  saveGymProfile(S, { id: 'hotel', availableEquipment: [] }); expect(compatibleWithGym(S, ex('bodyweight'))).toBe(false)
})
test.each(['other', 'custom'])('%s profiles retain stable id/name and only canonical equipment', type => {
  const S = {}; saveGymProfile(S, { id: 'gym-1', name: 'Mi sala', type, availableEquipment: ['band'] }); selectGymProfile(S, 'gym-1')
  expect(activeGymProfile(JSON.parse(JSON.stringify(S)))).toMatchObject({ id: 'gym-1', name: 'Mi sala', type, availableEquipment: ['band'] })
})
test('unknown selection falls back safely; changing context never touches historical data', () => {
  const S = { workouts: [{ id: 'w', entries: [{ id: 'legacy' }] }], routines: [{ id: 'r' }], active: { id: 'a' }, gymProfiles: { activeId: 'gone' } }
  const before = JSON.stringify(S); expect(activeGymProfile(S).id).toBe('2j'); expect(JSON.stringify(S)).toBe(before)
  const { gymProfiles, ...history } = S; selectGymProfile(S, 'home'); const { gymProfiles: after, ...rest } = S
  expect(rest).toEqual(history)
})
test('Library filter is optional, full catalogue preserved and compatibles first', () => {
  const S = state('home'), list = [ex('barbell'), ex('bodyweight')]
  expect(gymExerciseList(S, list)).toEqual([list[1], list[0]])
  expect(gymExerciseList(S, list, true)).toEqual([list[1]])
  expect(list[0]).toBe(ex('barbell'))
})
test('temporary 2J equipment restrictions do not affect another place', () => {
  setUnavailableEquipment(['dumbbell'])
  const S = state('home'); saveGymProfile(S, { id: 'home', availableEquipment: ['dumbbell'] })
  expect(compatibleWithGym(S, ex('dumbbell'))).toBe(true)
  expect(compatibleWithGym({}, ex('dumbbell'))).toBe(false)
})
test('swap ranks compatible before incompatible and keeps max eight plus fallback', () => {
  const S = state('home'), ref = ex('barbell')
  const groups = getReplacementGroups(S, ref.id)
  expect(groups.recommended.length).toBeLessThanOrEqual(8)
  expect(groups.recommended.some(a => compatibleWithGym(S, a.ex))).toBe(true)
  const flags = groups.recommended.map(a => compatibleWithGym(S, a.ex))
  expect(flags).toEqual([...flags].sort((a,b) => Number(b)-Number(a)))
  saveGymProfile(S, { id: 'home', availableEquipment: [] })
  expect(getReplacementGroups(S, ref.id).recommended.length).toBeGreaterThan(0)
})
test('Train2J compatibility is derived, does not create another routine', () => {
  const S = state('home'), r = { ex: [{ id: ex('bodyweight').id }] }, before = JSON.stringify(r)
  expect(gymRoutineCompatibility(S, r).compatible).toBe(true)
  expect(gymRoutineCompatibility(S, { ex: [{ id: ex('barbell').id }] }).compatible).toBe(false)
  expect(JSON.stringify(r)).toBe(before)
})
test('profile list is bounded and rejects reserved ids', () => {
  const S = {}; saveGymProfile(S, { id: 'bad', name: 'x' }); expect(gymProfilesOf(S)).toHaveLength(3)
  for(let i=0;i<20;i++) saveGymProfile(S,{id:'gym-'+i, name:'x'})
  expect(gymProfilesOf(S)).toHaveLength(15)
})
