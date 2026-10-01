// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { statusOf, filterAdmin, countByStatus, moveId, programTotals, nextDay, duplicateWeek, emptyProgram, STATUSES, PURPOSES } from './studio.js'
import { qualityIndex, countsOf, filterQuality, oddName, QUALITY_FILTERS } from './library-quality.js'
import { isDeprecated, aliasesOf } from './library/core.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const json = p => JSON.parse(readFileSync(join(root, p), 'utf8'))
const SEED = json('api/lib/guided-official.json')
const PROGRAMS = json('api/lib/guided-programs-official.json')
const BLOCKS = json('api/lib/blocks-official.json')

describe('Studio helpers (publication state, filtering, ordering)', () => {
  it('a draft is never active, a hidden routine is withdrawn, everything else is active', () => {
    expect(statusOf({ draft: true, active: false })).toBe('draft')
    expect(statusOf({ active: false })).toBe('hidden')
    expect(statusOf({ active: true })).toBe('active')
    expect(statusOf({})).toBe('active')
    expect(STATUSES).toEqual(['draft', 'active', 'hidden'])
  })
  it('filters by text, status, type and featured, and counts by status', () => {
    const list = [{ id: 'a', name: 'Tabata one', category: 'tabata' }, { id: 'b', name: 'Mobility hips', category: 'mobility', draft: true, featured: 1 }, { id: 'c', name: 'Stretch', category: 'mobility', active: false }]
    expect(filterAdmin(list, { q: 'HIPS' }).map(x => x.id)).toEqual(['b'])
    expect(filterAdmin(list, { status: 'hidden' }).map(x => x.id)).toEqual(['c'])
    expect(filterAdmin(list, { category: 'mobility' })).toHaveLength(2)
    expect(filterAdmin(list, { featured: true }).map(x => x.id)).toEqual(['b'])
    expect(filterAdmin(list, { q: 'tabata' }, x => x.name.toUpperCase()).map(x => x.id)).toEqual(['a'])
    expect(countByStatus(list)).toEqual({ draft: 1, active: 1, hidden: 1 })
  })
  it('moveId swaps with the neighbour and stops at the ends', () => {
    expect(moveId(['a', 'b', 'c'], 'b', -1)).toEqual(['b', 'a', 'c'])
    expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'c', 'b'])
    const ends = ['a', 'b']
    expect(moveId(ends, 'a', -1)).toBe(ends)
    expect(moveId(ends, 'b', 1)).toBe(ends)
    expect(moveId(ends, 'zzz', 1)).toBe(ends)
  })
  it('program totals count sessions and minutes and report the first missing routine', () => {
    const by = new Map([['x', { estimatedMinutes: 10 }], ['y', { estimatedMinutes: 25 }]])
    const p = { weeks: [{ sessions: [{ day: 1, routineId: 'x' }, { day: 3, routineId: 'y' }] }, { sessions: [{ day: 2, routineId: 'gone' }] }] }
    expect(programTotals(p, by)).toEqual({ sessions: 3, minutes: 35, missing: 'gone', weeks: 2 })
    expect(programTotals(emptyProgram(), by)).toMatchObject({ sessions: 0, weeks: 1, missing: null })
  })
  it('next day prefers Monday, Wednesday, Friday; a full week has none; copying a week duplicates its sessions', () => {
    expect(nextDay({ sessions: [] })).toBe(1)
    expect(nextDay({ sessions: [{ day: 1 }] })).toBe(3)
    expect(nextDay({ sessions: [0, 1, 2, 3, 4, 5, 6].map(day => ({ day })) })).toBeNull()
    const weeks = [{ sessions: [{ day: 1, routineId: 'a' }] }, { sessions: [] }]
    const next = duplicateWeek(weeks, 0)
    expect(next).toHaveLength(3)
    expect(next[1]).toEqual(next[0])
    expect(next[1]).not.toBe(next[0])
  })
})

describe('expanded Entrena con 2J content', () => {
  const R = SEED.routines
  const byId = new Map(R.map(r => [r.id, r]))
  it('ids are unique across blocks, routines, collections and programs; counts match the seeds', () => {
    const ids = [...BLOCKS.blocks.map(b => b.id), ...R.map(r => r.id), ...SEED.collections.map(c => c.id), ...PROGRAMS.programs.map(p => p.id)]
    expect(new Set(ids).size).toBe(ids.length)
    expect(SEED.count).toBe(R.length)
    expect(R.length).toBeGreaterThanOrEqual(150)
  })
  it('no official block, routine or program refers to a deprecated exercise', () => {
    const bad = new Set()
    for (const b of BLOCKS.blocks) for (const e of b.ex) if (isDeprecated(e.id)) bad.add(b.id + ':' + e.id)
    for (const r of R) for (const e of r.ex) if (isDeprecated(e.id)) bad.add(r.id + ':' + e.id)
    expect([...bad]).toEqual([])
  })
  it('real durations from 5 to 60 minutes: every common length exists and none is a clone of another', () => {
    const minutes = new Set(R.map(r => r.estimatedMinutes))
    for (const m of [5, 10, 15, 20, 25, 30, 45, 60]) expect(minutes.has(m), m + ' min').toBe(true)
    const sig = r => r.ex.map(e => e.id + ':' + (e.sets || '') + ':' + (e.reps || e.sec || '')).join('|')
    expect(new Set(R.map(sig)).size).toBe(R.length)
  })
  it('every routine is validated, covers a known level and category, and sessions with a purpose belong to the catalogue vocabulary', () => {
    for (const r of R) {
      expect(r.validation.result, r.id).toBe('PASS')
      expect(['beginner', 'intermediate', 'advanced']).toContain(r.level)
      if (r.purpose) expect(PURPOSES).toContain(r.purpose)
    }
    for (const p of PURPOSES) expect(R.some(r => r.purpose === p), p).toBe(true)
  })
  it('warm-up, cool-down, stretching, recovery, HIIT, Tabata and cardio all have real depth', () => {
    const by = f => R.filter(f).length
    expect(by(r => r.purpose === 'warmup')).toBeGreaterThanOrEqual(6)
    expect(by(r => r.purpose === 'cooldown')).toBeGreaterThanOrEqual(4)
    expect(by(r => r.purpose === 'stretch')).toBeGreaterThanOrEqual(8)
    expect(by(r => r.purpose === 'recovery')).toBeGreaterThanOrEqual(2)
    expect(by(r => r.category === 'hiit')).toBeGreaterThanOrEqual(12)
    expect(by(r => r.category === 'tabata')).toBeGreaterThanOrEqual(10)
    expect(by(r => r.category === 'interval')).toBeGreaterThanOrEqual(10)
    expect(by(r => r.category === 'strength')).toBeGreaterThanOrEqual(40)
  })
  it('collections resolve: every id exists, none is empty, and the new themed ones are present', () => {
    for (const c of SEED.collections) {
      expect(c.routineIds.length, c.id).toBeGreaterThan(0)
      for (const id of c.routineIds) expect(byId.has(id), c.id + ' → ' + id).toBe(true)
    }
    for (const id of ['c2j-warmup', 'c2j-cooldown', 'c2j-recovery', 'c2j-finishers', 'c2j-home', 'c2j-lowimpact', 'c2j-long']) expect(SEED.collections.some(c => c.id === id), id).toBe(true)
  })
  it('programs reference active official routines and each one has a cover and equipment labels', () => {
    expect(PROGRAMS.programs.length).toBeGreaterThanOrEqual(20)
    for (const p of PROGRAMS.programs) {
      expect(p.cover && p.equipment.length, p.id).toBeTruthy()
      for (const w of p.weeks) for (const s of w.sessions) expect(byId.get(s.routineId)?.active !== false, p.id + ' → ' + s.routineId).toBe(true)
    }
  })
})

describe('Library quality index', () => {
  const rows = qualityIndex()
  it('indexes the whole library and flags what a curator should see', () => {
    expect(rows).toHaveLength(1324)
    const c = countsOf(rows)
    expect(Object.keys(c)).toEqual(QUALITY_FILTERS)
    expect(c.deprecated).toBe(rows.filter(r => isDeprecated(r.id)).length)
    expect(c.recommended + c.notRecommended).toBe(1324)
    expect(rows.filter(r => r.dep).every(r => !r.flags.has('noMovement') && !r.flags.has('duplicate'))).toBe(true)
    expect(rows.filter(r => r.flags.has('noAlias')).every(r => r.rec && !aliasesOf(r.id).length)).toBe(true)
  })
  it('filters combine with AND and the search matches names, aliases and ids', () => {
    const dep = filterQuality(rows, { filters: ['deprecated'] })
    expect(dep.length).toBeGreaterThan(0)
    expect(filterQuality(rows, { filters: ['deprecated', 'recommended'] })).toHaveLength(0)
    const some = rows.find(r => aliasesOf(r.id).length)
    expect(filterQuality(rows, { q: aliasesOf(some.id)[0] }).map(r => r.id)).toContain(some.id)
    expect(filterQuality(rows, { q: some.id }).map(r => r.id)).toContain(some.id)
  })
  it('odd names: mojibake, stubs, doubled spaces and shouting — not a parenthesis or an upstream "v. 2"', () => {
    for (const n of ['Ã©xito', 'ab', 'bench  press', 'BARBELL curl', '- row', 'curl,']) expect(oddName(n), n).toBe(true)
    for (const n of ['barbell full squat (back pov)', 'barbell rear lunge v. 2', 'cable pulldown']) expect(oddName(n), n).toBe(false)
  })
})
