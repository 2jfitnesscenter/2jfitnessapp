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
  expect(DEFAULT_2J_EQUIPMENT).toEqual(['bodyweight', 'barbell', 'ez_bar', 'dumbbell', 'kettlebell', 'cable', 'weighted', 'selectorized', 'machine', 'plate_loaded', 'smith', 'sled', 'stability_ball', 'roller', 'treadmill', 'bike', 'elliptical', 'stepmill', 'skierg'])
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
test('personal equipment edits persist for Home, Hotel and custom places and change compatibility', () => {
  for (const id of ['home', 'hotel', 'gym-1']) {
    const S = state(id)
    if (id === 'gym-1') saveGymProfile(S, { id, name: 'My place', type: 'custom', availableEquipment: ['bodyweight'] })
    const exercise = ex('dumbbell')
    expect(compatibleWithGym(S, exercise)).toBe(false)
    saveGymProfile(S, { id, availableEquipment: ['bodyweight', 'dumbbell', 'not-in-catalog'] })
    const restored = JSON.parse(JSON.stringify(S))
    expect(activeGymProfile(restored).availableEquipment).toEqual(['bodyweight', 'dumbbell'])
    expect(compatibleWithGym(restored, exercise)).toBe(true)
    saveGymProfile(restored, { id, availableEquipment: ['bodyweight'] })
    expect(compatibleWithGym(restored, exercise)).toBe(false)
  }
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

test('the real 2J inventory (machines, kettlebells, plates, stair climber, sled) is recognised with the existing categories', async () => {
  const { EXIDX } = await import('./exercises.js')
  const { equipmentIdOf } = await import('./protocol/movements.js')
  setOfficialGymEquipment(DEFAULT_2J_EQUIPMENT)
  const S = state('2j')
  const mustWork = {
    '0058': 'barbell hip thrust (Glute Drive / Hip Thruster, plates)', '0585': 'lever leg extension (Dual Leg Extension)', '0599': 'lever seated leg curl (Seated / Horizontal Leg Curl)',
    '0586': 'lever lying leg curl', '0597': 'lever seated hip abduction (Dual Abductor / Standing Hip Abductor)', '0598': 'lever seated hip adduction (Dual Adductor)',
    '0573': 'lever back extension', '0593': 'lever reverse hyperextension', '0489': 'hyperextension (Horizontal Roman Chair)', '0739': 'sled 45 leg press (3 inclined presses)',
    '0743': 'sled hack squat (pendulum / hack)', '2311': 'walking on stepmill (Stair Climber)', '0760': 'smith leg press (Multipower)',
  }
  for (const [id, label] of Object.entries(mustWork)) {
    expect(EXIDX[id], id).toBeTruthy()
    expect(compatibleWithGym(S, EXIDX[id]), `${id} ${label} → ${equipmentIdOf(EXIDX[id])}`).toBe(true)
  }
  const kettlebell = Object.values(EXIDX).find(e => e.eq === 'kettlebell')
  expect(kettlebell).toBeTruthy()
  expect(compatibleWithGym(S, kettlebell)).toBe(true)
  // no taxonomy was added for this: every id of the official inventory already exists
  const { EQUIPMENT } = await import('./protocol/movements.js')
  expect(DEFAULT_2J_EQUIPMENT.every(id => EQUIPMENT.some(e => e.id === id))).toBe(true)
  expect(EQUIPMENT).toHaveLength(28)
})
