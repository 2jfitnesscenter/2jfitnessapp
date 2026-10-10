import { describe, expect, it } from 'vitest'
import { routineShare, programShare, saveSharedRoutine, saveSharedProgram, savedShare, resolveStart, estimateMinutes, sharedFit } from './shared-plans.js'
import { EXIDX } from './exercises.js'

const ids = (() => {
  const all = Object.values(EXIDX)
  const bw = all.find(e => e.eq === 'body weight' && !String(e.id).startsWith('c'))
  const barbell = all.find(e => e.eq === 'barbell')
  return { bw: bw.id, barbell: barbell.id }
})()
const S = () => ({ unit: 'kg', routines: [{ id: 'r1', name: 'Push day', emoji: 'dumbbell', ex: [{ id: ids.bw, sets: 3, reps: 10, note: 'mi nota' }, { id: 'c9', sets: 2 }], privateNote: 'x' }, { id: 'r2', name: 'Pull day', emoji: 'dumbbell', ex: [{ id: ids.bw, sets: 3, reps: 8 }] }],
  customEx: [{ id: 'c9', n: 'Mi ejercicio', bp: 'back', secret: 'no' }, { id: 'c10', n: 'No usado', bp: 'back' }], programs: [{ id: 'p1', name: 'Plan', emoji: 'folder', routineIds: ['r1', 'r2'] }] })
const item = (kind, snapshot, extra = {}) => ({ id: 'sh1', kind, authorId: 'u2', authorName: 'Ana', createdAt: 1_700_000_000_000, content: { snapshot, meta: { senderLabel: 'Ana', ...extra } } })

describe('what the sender builds', () => {
  it('a routine travels with its own custom exercises only', () => {
    const share = routineShare(S(), S().routines[0])
    expect(share.kind).toBe('routine')
    expect(share.snapshot.customExDefs.map(d => d.id)).toEqual(['c9'])
    expect(share.meta.origin).toBe('plan')
  })
  it('a program carries its routines in order; an empty one is not shareable', () => {
    const s = S()
    const share = programShare(s, s.programs[0])
    expect(share.snapshot.routines.map(r => r.name)).toEqual(['Push day', 'Pull day'])
    expect(programShare(s, { name: 'x', routineIds: [] })).toBeNull()
    expect(routineShare(s, { name: 'x', ex: [] })).toBeNull()
  })
  it('an official 2J routine says so', () => {
    const s = S(); s.routines[0].from2j = { id: 'r2j-x' }
    expect(routineShare(s, s.routines[0]).meta.origin).toBe('2j')
  })
})

describe('what the receiver keeps', () => {
  it('saves an independent copy marked with where it came from, once', () => {
    const r = S(), it1 = item('routine', routineShare(S(), S().routines[0]).snapshot)
    r.routines = []; r.customEx = []
    const out = saveSharedRoutine(r, it1, { makeId: () => 'new1' })
    expect(out.ok).toBe(true)
    expect(out.routine).toMatchObject({ id: 'new1', name: 'Push day', fromShare: { shareId: 'sh1', senderId: 'u2', senderLabel: 'Ana', createdAt: 1_700_000_000_000 } })
    expect(r.customEx.map(c => c.id)).toEqual(['c9'])
    const again = saveSharedRoutine(r, it1, { makeId: () => 'new2' })
    expect(again.ok).toBe(false); expect(again.reason).toBe('already-saved'); expect(r.routines).toHaveLength(1)
    expect(savedShare(r, it1).id).toBe('new1')
    // later changes to the copy never touch the snapshot, and the other way round
    r.routines[0].ex[0].sets = 9
    expect(it1.content.snapshot.ex[0].sets).toBe(3)
  })
  it('saves a program as its own routines plus one program, all marked', () => {
    const r = { routines: [], programs: [], customEx: [] }
    let n = 0
    const out = saveSharedProgram(r, item('program', programShare(S(), S().programs[0]).snapshot), { makeId: () => 'id' + ++n })
    expect(out.ok).toBe(true)
    expect(r.routines.map(x => x.name)).toEqual(['Push day', 'Pull day'])
    expect(r.programs[0]).toMatchObject({ name: 'Plan', routineIds: r.routines.map(x => x.id), fromShare: { shareId: 'sh1' } })
    expect(r.routines.every(x => x.fromShare.shareId === 'sh1')).toBe(true)
    expect(saveSharedProgram(r, item('program', programShare(S(), S().programs[0]).snapshot)).reason).toBe('already-saved')
    expect(r.programs).toHaveLength(1)
  })
  it('refuses a share with nothing to save', () => {
    expect(saveSharedRoutine({ routines: [] }, item('routine', { name: 'x', ex: [] })).ok).toBe(false)
    expect(saveSharedProgram({ routines: [] }, item('routine', { name: 'x', routines: [] })).ok).toBe(false)
  })
})

describe('the numbers it shows', () => {
  it('estimates minutes from sets, work and rest; cardio counts its own minutes', () => {
    expect(estimateMinutes({ ex: [{ id: 'a', sets: 3, reps: 10 }] })).toBe(Math.round(3 * (40 + 75) / 60))
    expect(estimateMinutes({ ex: [{ id: 'a', mode: 'cardio', min: 20 }] })).toBe(20)
    expect(estimateMinutes({ ex: [] })).toBe(1)
  })
  it('says what equipment is missing at the active place, and leaves the sender\'s custom exercises out of the check', () => {
    const home = { gymProfiles: { activeId: 'home' } }
    const fit = sharedFit(home, [{ ex: [{ id: ids.bw }, { id: ids.barbell }, { id: 'c9' }] }])
    expect(fit.level).not.toBe('compatible'); expect(fit.missingIds).toEqual([ids.barbell]); expect(fit.equipment.length).toBeGreaterThan(0)
    expect(sharedFit(home, [{ ex: [{ id: 'c9' }] }]).level).toBe('compatible')
    expect(sharedFit(home, [{ ex: [{ id: ids.bw }] }]).level).toBe('compatible')
  })
})

describe('start', () => {
  it('starts from the receiver\'s own copy: saves one first when there is none, reuses it when there is', () => {
    const r = { routines: [], programs: [], customEx: [] }
    const share = item('routine', routineShare(S(), S().routines[0]).snapshot)
    const first = resolveStart(r, share, { makeId: () => 'mine1' })
    expect(first).toEqual({ ok: true, id: 'mine1', kind: 'routine', created: true })
    expect(r.routines[0].fromShare.shareId).toBe('sh1')
    const again = resolveStart(r, share, { makeId: () => 'mine2' })
    expect(again).toEqual({ ok: true, id: 'mine1', kind: 'routine', created: false }); expect(r.routines).toHaveLength(1)
    // what the sender does afterwards cannot reach it: the copy is a separate object
    share.content.snapshot.ex[0].sets = 99
    expect(r.routines[0].ex[0].sets).toBe(3)
  })
  it('a program opens the saved program; an unusable share starts nothing', () => {
    const r = { routines: [], programs: [], customEx: [] }
    let n = 0
    const share = item('program', programShare(S(), S().programs[0]).snapshot)
    expect(resolveStart(r, share, { makeId: () => 'id' + ++n })).toMatchObject({ ok: true, kind: 'program', created: true })
    expect(resolveStart(r, share).created).toBe(false)
    expect(resolveStart({ routines: [] }, item('routine', { name: 'x', ex: [] })).ok).toBe(false)
  })
})
