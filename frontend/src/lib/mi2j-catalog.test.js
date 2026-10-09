import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { saveOfficialRoutine } from './train2j.js'
import { saveGuidedProgram, startGuidedProgram, setGuidedProgramStatus, flattenProgramSessions } from './guided-programs.js'
import { favRoutinesOf, toggleRoutineFav, mergeFavorites, migrateLegacyFavorites } from './routine-favorites.js'

/* Mi 2J V2 — the catalogue side: an official routine or program can be SAVED by the member as an independent copy, and favourite routines
 * are synced state (with a one-time, duplicate-free move of the old per-device list). */
const json = p => JSON.parse(readFileSync(new URL('../../../api/lib/' + p, import.meta.url), 'utf8'))
const ROUTINES = json('guided-official.json').routines
const PROGRAM = json('guided-programs-official.json').programs[0]
const clone = x => JSON.parse(JSON.stringify(x))
const catalogOf = program => ({ ...clone(program), routines: Object.fromEntries([...new Set(flattenProgramSessions(program).map(s => s.routineId))].map(id => [id, clone(ROUTINES.find(r => r.id === id))])) })

describe('saving an official routine', () => {
  const master = ROUTINES.find(r => r.id === 'r2j-tabata-fullbody')
  it('makes an independent copy with a note of where it came from, and touches nothing else', () => {
    const mine = { id: 'r1', name: 'Pierna A', ex: [{ id: '0043', sets: 3, reps: 8 }] }
    const S = { routines: [mine], programs: [], week: { 1: 'r1' } }
    const m = clone(master)
    const out = saveOfficialRoutine(S, m, { makeId: () => 'new1', now: 1000, rev: '5.1.7' })
    expect(out.ok).toBe(true)
    expect(S.routines).toHaveLength(2); expect(S.routines[0]).toBe(mine)
    expect(S.week).toEqual({ 1: 'r1' })
    expect(out.routine).toMatchObject({ id: 'new1', from2j: { id: master.id, v: master.seedVersion || null, rev: '5.1.7', at: 1000 } })
    expect(out.routine.ex).toEqual(master.ex)
    // decoupled in both directions: editing the copy leaves the master alone, and a later change to the master leaves the copy alone
    out.routine.ex[0].sets = 99
    expect(m.ex[0].sets).not.toBe(99)
    const before = JSON.stringify(out.routine.ex)
    m.ex[0].sets = 77; m.name = 'Renamed upstream'
    expect(JSON.stringify(out.routine.ex)).toBe(before)
    expect(out.routine.name).not.toBe('Renamed upstream')
    expect(out.routine.blocks.length).toBe((master.blocks || []).length)
  })
  it('does not save the same official routine twice, and refuses an empty one', () => {
    const S = { routines: [] }
    expect(saveOfficialRoutine(S, master, { makeId: () => 'a' }).ok).toBe(true)
    const again = saveOfficialRoutine(S, master, { makeId: () => 'b' })
    expect(again).toMatchObject({ ok: false, reason: 'already-saved' }); expect(again.routine.id).toBe('a')
    expect(S.routines).toHaveLength(1)
    expect(saveOfficialRoutine({ routines: [] }, { id: 'x', ex: [] }).ok).toBe(false)
    expect(saveOfficialRoutine({}, master, { makeId: () => 'c' }).ok).toBe(true)          // a state with no routines list yet
  })
})

describe('saving an official program without starting it', () => {
  it('keeps the pinned snapshot, marks it as waiting, and changes nothing about the active plan', () => {
    const catalog = catalogOf(PROGRAM)
    const S = { programs: [], activeProgramId: null, workouts: [] }
    const out = saveGuidedProgram(S, catalog, { id: 'u1', makeId: () => 'x1', now: 5, rev: '3' })
    expect(out.ok).toBe(true)
    expect(out.program).toMatchObject({ source: 'guided-v2', catalogId: PROGRAM.id, status: 'assigned', savedAt: 5, catalogRev: '3' })
    expect(out.program.startedAt).toBeUndefined()
    expect(S.activeProgramId).toBe(null)
    const ids = [...new Set(flattenProgramSessions(PROGRAM).map(s => s.routineId))]
    expect(Object.keys(out.program.routineSnapshots).sort()).toEqual(ids.sort())
    // pinned: a later catalogue edit does not reach it
    catalog.routines[ids[0]].name = 'changed upstream'; catalog.weeks[0].sessions[0].day = 6
    expect(out.program.routineSnapshots[ids[0]].name).not.toBe('changed upstream')
    expect(out.program.weeks[0].sessions[0].day).not.toBe(6)
  })
  it('is never saved twice while alive, can be saved again once it ended, and can be started afterwards', () => {
    const catalog = catalogOf(PROGRAM)
    const S = { programs: [], activeProgramId: null, workouts: [] }
    const first = saveGuidedProgram(S, catalog, { id: 'u1', makeId: () => 'one' }).program
    expect(saveGuidedProgram(S, catalog, { id: 'u1', makeId: () => 'two' })).toMatchObject({ ok: false, reason: 'already-saved' })
    expect(S.programs).toHaveLength(1)
    expect(setGuidedProgramStatus(S, first.id, 'active')).toBe(true)
    expect(S.activeProgramId).toBe(first.id)
    expect(setGuidedProgramStatus(S, first.id, 'abandoned')).toBe(true)
    expect(saveGuidedProgram(S, catalog, { id: 'u1', makeId: () => 'three' }).ok).toBe(true)
    expect(saveGuidedProgram(S, { id: 'empty', weeks: [] }).ok).toBe(false)
  })
  it('starting a program still works exactly as before', () => {
    const S = { programs: [], activeProgramId: null, workouts: [] }
    const out = startGuidedProgram(S, catalogOf(PROGRAM), { id: 'u1', makeId: () => 'go', now: 9 })
    expect(out.ok).toBe(true)
    expect(out.program).toMatchObject({ status: 'active', startedAt: 9 }); expect(out.program.savedAt).toBeUndefined()
    expect(S.activeProgramId).toBe(out.program.id)
  })
})

describe('favourite routines are synced state', () => {
  it('toggle and merge keep a clean list with no duplicates', () => {
    const s = {}
    expect(toggleRoutineFav(s, 'a')).toBe(true); expect(toggleRoutineFav(s, 'b')).toBe(true); expect(toggleRoutineFav(s, 'a')).toBe(false)
    expect(s.favRoutines).toEqual(['b'])
    expect(mergeFavorites(s, ['b', 'c', 'c', '', null, 7, 'd'])).toBe(true)
    expect(s.favRoutines).toEqual(['b', 'c', 'd'])
    expect(mergeFavorites(s, ['c'])).toBe(false)
    expect([...favRoutinesOf(s)]).toEqual(['b', 'c', 'd'])
    expect([...favRoutinesOf(null)]).toEqual([])
  })
})

describe('the one-time move of the old per-device favourites', () => {
  let memory, S, store
  const update = fn => { fn(S) }
  const run = (uid = 'u1') => migrateLegacyFavorites({ uid, getState: () => store, update })
  beforeEach(() => {
    memory = new Map()
    vi.stubGlobal('localStorage', { getItem: k => memory.get(k) ?? null, setItem: (k, v) => memory.set(k, String(v)), removeItem: k => memory.delete(k) })
    S = { favRoutines: [] }
    store = { get S() { return S }, user: { id: 'u1' }, syncStatus: 'idle' }
  })
  afterEach(() => vi.unstubAllGlobals())

  it('merges the old list without duplicates, keeps it until the sync is confirmed, then removes it and never runs again', () => {
    memory.set('g2j_favs:u1', JSON.stringify(['a', 'b', 'a']))
    S.favRoutines = ['b', 'z']                                    // already has a favourite from another device
    expect(run()).toBe('merged')
    expect(S.favRoutines).toEqual(['b', 'z', 'a'])
    expect(memory.get('g2j_favs:u1')).toBeDefined()               // not removed yet: the server has not confirmed this state
    expect(run()).toBe('merged'); expect(S.favRoutines).toEqual(['b', 'z', 'a'])   // idempotent
    store.syncStatus = 'synced'
    expect(run()).toBe('done')
    expect(memory.get('g2j_favs:u1')).toBeUndefined()
    expect(memory.get('g2j_favs_migrated:u1')).toBe('1')
    expect(run()).toBe('none')
    memory.set('g2j_favs:u1', JSON.stringify(['late']))           // nothing is re-imported after the migration is done
    expect(run()).toBe('none'); expect(S.favRoutines).not.toContain('late')
  })
  it('a pull that replaces the state before the old list is removed cannot cost a favourite', () => {
    memory.set('g2j_favs:u1', JSON.stringify(['a']))
    expect(run()).toBe('merged')
    S = { favRoutines: [] }                                       // the server copy arrives and replaces the local one
    store.syncStatus = 'synced'
    expect(run()).toBe('done')
    expect(S.favRoutines).toEqual(['a'])
  })
  it('without a server (guest or device-only builds) it completes at once; another account on the device is untouched; no list means nothing to do', () => {
    memory.set('g2j_favs:u1', JSON.stringify(['a'])); memory.set('g2j_favs:u2', JSON.stringify(['q']))
    store.user = null
    expect(run('u1')).toBe('done'); expect(S.favRoutines).toEqual(['a'])
    expect(memory.get('g2j_favs:u2')).toBeDefined()
    expect(run('u3')).toBe('none')
    memory.set('g2j_favs:u4', '{not json')
    expect(run('u4')).toBe('none')
  })
})
