import { describe, it, expect } from 'vitest'
import { matchScannedMachine, machineAliasKey } from './machine-scan.js'

describe('matchScannedMachine', () => {
  it('surfaces a single clean match as a one-item candidate list — confirmation, not silent auto-apply', () => {
    const m = matchScannedMachine({ name: 'Press de banca', nameEn: 'Bench Press' })
    expect(m.candidates).toHaveLength(1)
    expect(m.candidates[0].id).toBe('0025')   // dataset id for barbell bench press
  })

  it('surfaces every tied candidate when the recognised name is genuinely ambiguous', () => {
    // Same fixture routine-scan.test.js uses — "row machine" ties between several real
    // lever-row variants in the dataset, so matchExerciseCandidates refuses to pick one.
    const m = matchScannedMachine({ name: 'Remo máquina', nameEn: 'row machine' })
    expect(m.candidates.length).toBeGreaterThan(1)
  })

  it('returns no candidates when nothing in the library is close', () => {
    const m = matchScannedMachine({ name: 'Frobnicator curl 3000', nameEn: 'Frobnicator curl 3000' })
    expect(m.candidates).toEqual([])
  })

  it('keeps the printed/Spanish name for display, even though matching itself runs on nameEn', () => {
    const m = matchScannedMachine({ name: 'Press de banca', nameEn: 'Bench Press' })
    expect(m.name).toBe('Press de banca')
  })

  it('falls back to matching on name when nameEn is missing', () => {
    const m = matchScannedMachine({ name: 'Bench Press' })
    expect(m.candidates[0]?.id).toBe('0025')
  })
})

describe('machineAliasKey', () => {
  it('normalises case and diacritics so re-scans of the same machine land on the same key', () => {
    expect(machineAliasKey('Bench Press')).toBe(machineAliasKey('bench press'))
    expect(machineAliasKey('Prensa de piernas')).toBe(machineAliasKey('PRENSA DE PIERNAS'))
    expect(machineAliasKey('Peck-Déck')).toBe(machineAliasKey('peck-deck'))
  })
  it('is a plain trimmed lowercase string for an already-clean name', () => {
    expect(machineAliasKey('leg press')).toBe('leg press')
  })
  it('is empty, not throwing, for a missing name', () => {
    expect(machineAliasKey(undefined)).toBe('')
    expect(machineAliasKey(null)).toBe('')
  })
})
