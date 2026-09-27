import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { tempData } from './helpers.mjs'
tempData()
const { build, librarySlice } = await import('../coach/payload.js')
const { selectGymProfile, saveGymProfile, gymEquipmentContext, setOfficialGymEquipment, DEFAULT_2J_EQUIPMENT } = await import('../lib/gym-profiles.js')
const { equipmentIdOf } = await import('../lib/protocol/movements.js')

test('API model matches the canonical frontend model without cross-container imports', () => {
  const frontend = readFileSync(new URL('../../frontend/src/lib/gym-profile-model.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const api = readFileSync(new URL('../lib/gym-profiles.js', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  assert.equal(api.slice(api.indexOf('\n') + 1), frontend)
})
test('AI receives compact equipment context without arbitrary private place names', () => {
  const S = { coach: {}, workouts: [], routines: [], programs: [], week: {}, dayPlan: {} }
  saveGymProfile(S, { id: 'gym-test', name: 'Private address', availableEquipment: ['band'], type: 'custom' }); selectGymProfile(S, 'gym-test')
  const p = build(S, 'test', {})
  assert.deepEqual(p.gymProfile.availableEquipment, ['band'])
  assert.match(p.gymProfile.authority, /restrictions, safety and training protocol/)
  assert.ok(!JSON.stringify(p).includes('Private address'))
})
test('AI prioritizes compatible equipment after an explicit selection; legacy order remains supported', () => {
  const S = {}; selectGymProfile(S, 'hotel')
  const list = librarySlice(S, [])
  assert.equal(equipmentIdOf(list[0]), 'bodyweight')
  assert.ok(list.some(e => equipmentIdOf(e) !== 'bodyweight'), 'fallback remains available')
  assert.deepEqual(gymEquipmentContext({}).availableEquipment, DEFAULT_2J_EQUIPMENT)
})
test('official AI equipment context follows the gym-wide admin inventory without entering member state', () => {
  const S = { workouts: [{ id: 'kept' }] }, before = JSON.stringify(S)
  setOfficialGymEquipment(['bodyweight', 'skierg'])
  assert.deepEqual(gymEquipmentContext(S).availableEquipment, ['bodyweight', 'skierg'])
  assert.equal(JSON.stringify(S), before)
  setOfficialGymEquipment(DEFAULT_2J_EQUIPMENT)
})
