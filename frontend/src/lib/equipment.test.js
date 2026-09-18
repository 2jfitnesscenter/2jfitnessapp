import { describe, it, expect } from 'vitest'
import { equipmentClassOf, stepDumbbell2J, stepMachine2J, stepFlat, stepWeight, DUMBBELL_WEIGHTS_2J, MACHINE_WEIGHTS_CONFIG } from './equipment.js'

describe('equipmentClassOf', () => {
  it('classifies a dumbbell as its own class', () => {
    expect(equipmentClassOf('dumbbell')).toBe('dumbbell')
  })
  it('classifies every plate-loaded bar as barbell, not just the plain barbell', () => {
    ;['barbell', 'olympic barbell', 'ez barbell', 'trap bar', 'smith machine'].forEach(eq => {
      expect(equipmentClassOf(eq)).toBe('barbell')
    })
  })
  it('falls back to machine for anything else — cables, leverage machines, kettlebells', () => {
    ;['cable', 'leverage machine', 'kettlebell', 'sled machine', 'body weight'].forEach(eq => {
      expect(equipmentClassOf(eq)).toBe('machine')
    })
  })
})

describe('stepDumbbell2J — walks the real 2J dumbbell rack', () => {
  it('jumps to the next heavier pair on the rack from an exact match', () => {
    expect(stepDumbbell2J(6, 1)).toBe(8)
    expect(stepDumbbell2J(10, 1)).toBe(12.5)
  })
  it('jumps to the next lighter pair going down', () => {
    expect(stepDumbbell2J(8, -1)).toBe(6)
    expect(stepDumbbell2J(12.5, -1)).toBe(10)
  })
  it('rounds an off-grid value to its nearest neighbour in the pressed direction', () => {
    expect(stepDumbbell2J(7, 1)).toBe(8)     // next available above 7
    expect(stepDumbbell2J(7, -1)).toBe(6)    // next available below 7
  })
  it('starting from empty (0), + lands on the lightest pair on the rack', () => {
    expect(stepDumbbell2J(0, 1)).toBe(DUMBBELL_WEIGHTS_2J[0])
  })
  it('does not go past either end of the rack', () => {
    expect(stepDumbbell2J(40, 1)).toBe(40)
    expect(stepDumbbell2J(1, -1)).toBe(1)
  })
})

describe('stepMachine2J — the pin only lives inside the stack', () => {
  it('steps by the configured 5 kg either way', () => {
    expect(stepMachine2J(20, 1)).toBe(25)
    expect(stepMachine2J(20, -1)).toBe(15)
  })
  it('stepping up from empty (0, below the floor) lands on the floor, not floor+step', () => {
    expect(stepMachine2J(0, 1)).toBe(MACHINE_WEIGHTS_CONFIG.min)
  })
  it('never steps below the floor or above the ceiling', () => {
    expect(stepMachine2J(MACHINE_WEIGHTS_CONFIG.min, -1)).toBe(MACHINE_WEIGHTS_CONFIG.min)
    expect(stepMachine2J(MACHINE_WEIGHTS_CONFIG.max, 1)).toBe(MACHINE_WEIGHTS_CONFIG.max)
  })
})

describe('stepFlat', () => {
  it('steps by the given amount and floors at 0', () => {
    expect(stepFlat(10, 1, 2.5)).toBe(12.5)
    expect(stepFlat(1, -1, 5)).toBe(0)
  })
})

describe('stepWeight — dispatches per equipment class and the 2J-room-equipment toggle', () => {
  it('uses the real dumbbell rack for a dumbbell exercise when 2J mode is on (the default)', () => {
    expect(stepWeight({}, 'dumbbell', 6, 1)).toBe(8)
  })
  it('steps a barbell by a flat 5 kg regardless of the 2J toggle', () => {
    expect(stepWeight({ use2JRoomEquipment: true }, 'barbell', 60, 1)).toBe(65)
    expect(stepWeight({ use2JRoomEquipment: false }, 'barbell', 60, 1)).toBe(65)
  })
  it('steps a machine by the configured 5 kg pin when 2J mode is on', () => {
    expect(stepWeight({}, 'leverage machine', 20, 1)).toBe(25)
  })
  it('falls back to customIncrements per equipment class once 2J mode is off', () => {
    const S = { use2JRoomEquipment: false, customIncrements: { barbell: 5, dumbbell: 1, machineOther: 10 } }
    expect(stepWeight(S, 'dumbbell', 10, 1)).toBe(11)
    expect(stepWeight(S, 'cable', 20, 1)).toBe(30)
  })
  it('falls back to the default increments if customIncrements is missing entirely', () => {
    expect(stepWeight({ use2JRoomEquipment: false }, 'dumbbell', 10, 1)).toBe(12)
  })
})
