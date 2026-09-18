import { describe, it, expect } from 'vitest'
import { matchScannedRoutine, applyPendingChoice } from './routine-scan.js'

describe('matchScannedRoutine', () => {
  it('matches on nameEn (the scan prompt’s English equivalent) when the printed name is in another language, keeping the printed name for display', () => {
    const raw = {
      days: [{ label: null, exercises: [
        { name: 'Extensiones de cuádriceps', nameEn: 'leg extension', sets: 3, reps: 12, unit: 'reps' },
      ] }],
    }
    const b = matchScannedRoutine(raw)
    expect(b.routines[0].ex[0].id).toBe('0585')   // matched via nameEn, not the Spanish name
    expect(b.unmatchedNames).toEqual([])
  })

  it('falls back to matching on the printed name when nameEn is missing', () => {
    const raw = { days: [{ label: null, exercises: [{ name: 'Bench Press', sets: 4, reps: 8, unit: 'reps' }] }] }
    expect(matchScannedRoutine(raw).routines[0].ex[0].id).toBe('0025')
  })

  it('matches a recognised exercise name and turns an unrecognised one into a custom exercise', () => {
    const raw = {
      name: 'Rutina de Juan',
      days: [{ label: null, exercises: [
        { name: 'Bench Press', sets: 4, reps: 8, weight: 60, unit: 'reps' },
        { name: 'Frobnicator curl 3000', sets: 3, reps: 12, weight: 10, unit: 'reps' },
      ] }],
    }
    const b = matchScannedRoutine(raw)
    expect(b.name).toBe('Rutina de Juan')
    expect(b.routines).toHaveLength(1)
    const [bench, custom] = b.routines[0].ex
    expect(bench.id).toBe('0025')   // dataset id for barbell bench press
    expect(bench.sets).toBe(4)
    expect(bench.mode).toBe('reps')
    expect(bench.reps).toBe(8)
    expect(bench.weight).toBe(60)
    expect(custom.id).toMatch(/^c/)   // custom-exercise ids start with 'c' — see lib/exercises.js's isCustomId
    expect(b.customEx).toEqual([{ id: custom.id, n: 'frobnicator curl 3000', bp: 'waist', tg: '', eq: 'custom', custom: true }])
    expect(b.unmatchedNames).toEqual(['Frobnicator curl 3000'])
    expect(b.pendingChoices).toEqual([])   // nothing close enough to offer as a candidate
  })

  it('offers tied candidates instead of guessing, and lets applyPendingChoice pick one or dismiss it', () => {
    // "row machine" genuinely ties between several real lever-row variants in the dataset —
    // matchExercise refuses to pick one, same reasoning as the module doc comment: guessing
    // wrong files years of training under the wrong lift.
    const raw = { days: [{ label: null, exercises: [
      { name: 'Remo máquina', nameEn: 'row machine', sets: 4, reps: 10, unit: 'reps' },
    ] }] }
    const b = matchScannedRoutine(raw)
    expect(b.pendingChoices).toHaveLength(1)
    const pending = b.pendingChoices[0]
    expect(pending.name).toBe('Remo máquina')
    expect(pending.candidates.length).toBeGreaterThan(1)
    const placeholderId = b.routines[0].ex[0].id
    expect(placeholderId).toMatch(/^c/)
    expect(b.customEx.map(c => c.id)).toContain(placeholderId)

    // Picking a candidate swaps it in and clears the placeholder everywhere.
    const chosen = pending.candidates[0]
    const resolved = applyPendingChoice(b, pending.exId, chosen.id)
    expect(resolved.routines[0].ex[0].id).toBe(chosen.id)
    expect(resolved.customEx.some(c => c.id === placeholderId)).toBe(false)
    expect(resolved.pendingChoices).toEqual([])
    expect(resolved.unmatchedNames).toEqual([])

    // Dismissing just drops the offer and leaves it as the custom exercise it already was.
    const dismissed = applyPendingChoice(b, pending.exId, null)
    expect(dismissed.routines[0].ex[0].id).toBe(placeholderId)
    expect(dismissed.customEx.some(c => c.id === placeholderId)).toBe(true)
    expect(dismissed.pendingChoices).toEqual([])
  })

  it('reuses the same custom exercise for the same unmatched name across days', () => {
    const raw = {
      days: [
        { label: 'Day 1', exercises: [{ name: 'Made-up move', sets: 3, reps: 10, unit: 'reps' }] },
        { label: 'Day 2', exercises: [{ name: 'made-up move', sets: 3, reps: 10, unit: 'reps' }] },
      ],
    }
    const b = matchScannedRoutine(raw)
    expect(b.customEx).toHaveLength(1)
    expect(b.routines[0].ex[0].id).toBe(b.routines[1].ex[0].id)
  })

  it('reads a timed exercise into seconds mode instead of reps', () => {
    const raw = { days: [{ label: null, exercises: [{ name: 'Plank', sets: 3, reps: 30, unit: 'sec' }] }] }
    const ex = matchScannedRoutine(raw).routines[0].ex[0]
    expect(ex.mode).toBe('time')
    expect(ex.sec).toBe(30)
    expect('reps' in ex).toBe(false)
  })

  it('maps a recognisable weekday label into the week schedule, and leaves an unrecognisable one unscheduled', () => {
    const raw = {
      days: [
        { label: 'Lunes', exercises: [{ name: 'Squat', sets: 4, reps: 5, unit: 'reps' }] },
        { label: 'Push A', exercises: [{ name: 'Bench Press', sets: 4, reps: 5, unit: 'reps' }] },
      ],
    }
    const b = matchScannedRoutine(raw)
    expect(b.week).toEqual({ 1: b.routines[0].id })   // Monday only
    expect(b.routines[1].name).toBe('Push A')
  })

  it('drops a day with no exercises rather than proposing an empty routine', () => {
    const raw = { days: [{ label: 'Rest', exercises: [] }, { label: 'Push', exercises: [{ name: 'Squat', sets: 3, reps: 8, unit: 'reps' }] }] }
    const b = matchScannedRoutine(raw)
    expect(b.routines).toHaveLength(1)
    expect(b.routines[0].name).toBe('Push')
  })

  it('clamps out-of-range sets/reps into their valid range instead of trusting the scan blindly', () => {
    const raw = { days: [{ label: null, exercises: [{ name: 'Squat', sets: 99, reps: -5, unit: 'reps' }] }] }
    const ex = matchScannedRoutine(raw).routines[0].ex[0]
    expect(ex.sets).toBe(10)   // clamped down to the 1-10 range's ceiling
    expect(ex.reps).toBe(1)    // clamped up to the 1-100 range's floor
  })
  it('falls back to a sensible default when sets/reps are missing entirely', () => {
    const raw = { days: [{ label: null, exercises: [{ name: 'Squat', unit: 'reps' }] }] }
    const ex = matchScannedRoutine(raw).routines[0].ex[0]
    expect(ex.sets).toBe(3)
    expect(ex.reps).toBe(10)
  })
})
