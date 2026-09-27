import { afterEach, expect, test, vi } from 'vitest'
import { activeGymProfile, gymProfilesOf, saveGymProfile, selectGymProfile, compatibleWithGym, gymExerciseList, gymRoutineCompatibility, DEFAULT_2J_EQUIPMENT, setOfficialGymEquipment, setCachedOfficialGymEquipment } from './gym-profiles.js'
import { EXDB, setUnavailableEquipment } from './exercises.js'
import { facets } from './library/index.js'
import { getReplacementGroups } from './alternatives.js'
const state = id => ({ gymProfiles: { activeId: id }, workouts: [], routines: [], customEx: [] })
const ex = eq => EXDB.find(e => facets(e)?.equipment === eq)
afterEach(() => { setUnavailableEquipment([]); setOfficialGymEquipment(DEFAULT_2J_EQUIPMENT); vi.unstubAllGlobals() })
test('legacy/default is 2J without mutating or seeding state', () => {
  const S = {}; expect(activeGymProfile(S).id).toBe('2j'); expect(S).toEqual({})
  expect(activeGymProfile(S).availableEquipment).toContain('smith')
})
test('official profiles have stable ids and only home/hotel permit personal overrides', () => {
  const S = state('home'); saveGymProfile(S, { id: 'home', availableEquipment: ['dumbbell', 'dumbbell', 'invented'] })
  expect(activeGymProfile(S).availableEquipment).toEqual(['dumbbell'])
  saveGymProfile(S, { id: '2j', availableEquipment: [] }); selectGymProfile(S, '2j')
  expect(activeGymProfile(S).availableEquipment).toContain('barbell')
})
test('2J official inventory uses existing canonical equipment and updates the shared compatibility context', () => {
  expect(DEFAULT_2J_EQUIPMENT).toEqual(['bodyweight', 'barbell', 'ez_bar', 'dumbbell', 'cable', 'weighted', 'selectorized', 'machine', 'plate_loaded', 'smith', 'sled', 'stability_ball', 'roller', 'treadmill', 'bike', 'elliptical', 'stepmill', 'skierg'])
  const before = { workouts: [{ id: 'historic' }], routines: [{ id: 'saved' }] }, unchanged = JSON.stringify(before)
  setOfficialGymEquipment(['bodyweight'])
  expect(activeGymProfile(before).availableEquipment).toEqual(['bodyweight'])
  const rows = gymExerciseList(before, [ex('smith'), ex('bodyweight')])
  expect(rows[0]).toBe(ex('bodyweight'))
  expect(compatibleWithGym(before, ex('smith'))).toBe(false)
  expect(JSON.stringify(before)).toBe(unchanged)
})
test('the last-known global inventory is cached outside each member state for offline reads', () => {
  const memory = new Map()
  vi.stubGlobal('localStorage', { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value) })
  const S = { workouts: [{ id: 'history' }], gymProfiles: { activeId: '2j' } }
  setCachedOfficialGymEquipment(['bodyweight', 'skierg'])
  expect(JSON.parse(memory.get('gym_official_equipment_v1'))).toEqual(['bodyweight', 'skierg'])
  expect(activeGymProfile(S).availableEquipment).toEqual(['bodyweight', 'skierg'])
  expect(S.gymProfiles).toEqual({ activeId: '2j' })
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
