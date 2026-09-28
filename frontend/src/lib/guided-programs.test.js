import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { completeGuidedProgramSession, flattenProgramSessions, programProgress, setGuidedProgramStatus, startGuidedProgram, validateGuidedProgram } from './guided-programs.js'

const here = dirname(fileURLToPath(import.meta.url))
const official = JSON.parse(readFileSync(join(here, '..', '..', '..', 'api', 'lib', 'guided-programs-official.json'), 'utf8'))
const routines = JSON.parse(readFileSync(join(here, '..', '..', '..', 'api', 'lib', 'guided-official.json'), 'utf8')).routines
const byId = Object.fromEntries(routines.map(r => [r.id, r]))
const catalog = p => {
  const routineIds = [...new Set((p.weeks || []).flatMap(w => w.sessions.map(s => s.routineId)))]
  return { ...p, routineIds, routines: Object.fromEntries(routineIds.map(id => [id, byId[id]])) }
}

describe('Guided Programs V2 data and lifecycle', () => {
  it('has unique, fully referenced plans with the declared duration and cadence', () => {
    expect(official.programs).toHaveLength(13)
    expect(new Set(official.programs.map(p => p.id)).size).toBe(official.programs.length)
    const ids = new Set(routines.map(r => r.id))
    for (const p of official.programs) {
      expect(validateGuidedProgram(p, ids), p.id).toEqual([])
      expect(p.weeks.every(week => week.sessions.length === p.sessionsPerWeek), p.id).toBe(true)
      expect(p.weeks.every(week => new Set(week.sessions.map(s => s.day)).size === week.sessions.length), p.id).toBe(true)
    }
    expect(official.programs.some(p => p.weeksCount >= 4 && p.sessionsPerWeek >= 2)).toBe(true)
  })

  it('every official plan snapshots its actual routines and completes only from its own session history', () => {
    for (const source of official.programs) {
      const p = catalog(source)
      const s = { active: null, programs: [], activeProgramId: null, workouts: [] }
      const started = startGuidedProgram(s, p, { id: 'qa', makeId: () => source.id })
      expect(started.ok, source.id).toBe(true)
      const sessions = flattenProgramSessions(started.program)
      expect(Object.keys(started.program.routineSnapshots).sort()).toEqual([...new Set(sessions.map(x => x.routineId))].sort())
      expect(programProgress(started.program, s.workouts)).toMatchObject({ total: sessions.length, completed: 0, percent: 0 })
      s.workouts = sessions.map((x, i) => ({ id: `${source.id}-${i}`, end: i + 1, src2j: { program: { programId: started.program.id, sessionId: x.sessionId } } }))
      expect(programProgress(started.program, s.workouts)).toMatchObject({ total: sessions.length, completed: sessions.length, percent: 100, next: null })
      expect(completeGuidedProgramSession(s, s.workouts.at(-1))).toBe(true)
      expect(started.program.status).toBe('completed')
      expect(s.activeProgramId).toBeNull()
    }
  })

  it('starts as a synced program snapshot and preserves existing plan data', () => {
    const p = catalog(official.programs[0])
    const s = { active: null, routines: [{ id: 'member-routine' }], programs: [{ id: 'manual', routineIds: ['member-routine'] }], activeProgramId: null }
    const existing = JSON.stringify([s.routines, s.programs])
    const result = startGuidedProgram(s, p, { id: 'member-1', makeId: () => 'new-id', now: 42 })
    expect(result.ok).toBe(true)
    expect(result.program).toMatchObject({ id: 'g2jp-member-1-new-id', source: 'guided-v2', schemaVersion: 1, status: 'active', startedAt: 42 })
    expect(Object.keys(result.program.routineSnapshots)).toEqual(expect.arrayContaining(p.routineIds))
    expect(JSON.stringify([s.routines, s.programs.slice(0, 1)])).toBe(existing)
    expect(s.activeProgramId).toBe(result.program.id)
  })

  it('prevents silent program replacement and handles pause/resume/abandon without deleting history', () => {
    const p = catalog(official.programs[0])
    const first = { id: 'g2jp-first', source: 'guided-v2', catalogId: p.id, status: 'active', weeks: p.weeks }
    const s = { active: null, programs: [first], activeProgramId: first.id, workouts: [{ id: 'old' }] }
    expect(startGuidedProgram(s, p, { id: 'm', makeId: () => 'b' })).toMatchObject({ ok: false, reason: 'already-active' })
    expect(startGuidedProgram(s, catalog(official.programs[1]), { id: 'm', makeId: () => 'b' })).toMatchObject({ ok: false, reason: 'active-program-conflict' })
    expect(setGuidedProgramStatus(s, first.id, 'paused')).toBe(true)
    expect(s.activeProgramId).toBeNull()
    expect(setGuidedProgramStatus(s, first.id, 'active')).toBe(true)
    expect(setGuidedProgramStatus(s, first.id, 'abandoned')).toBe(true)
    expect(s.programs).toHaveLength(1)
    expect(s.workouts).toEqual([{ id: 'old' }])
  })

  it('tracks completed sessions from ordinary workout history and picks the next unfinished day', () => {
    const p = catalog(official.programs[0])
    const [first, second] = flattenProgramSessions(p)
    const saved = { ...p, id: 'g2jp-1', source: 'guided-v2', schemaVersion: 1 }
    const progress = programProgress(saved, [{ id: 'w1', src2j: { program: { programId: saved.id, sessionId: second.sessionId } } }])
    expect(progress).toMatchObject({ total: flattenProgramSessions(p).length, completed: 1 })
    expect(progress.next.sessionId).toBe(first.sessionId)
    expect(progress.percent).toBeGreaterThan(0)
  })

  it('marks completion only after every planned session exists in history', () => {
    const p = catalog(official.programs[0])
    const saved = { ...p, id: 'g2jp-2', source: 'guided-v2', weeks: [{ sessions: [{ day: 1, routineId: 'r' }] }] }
    const workout = { src2j: { program: { programId: saved.id, sessionId: '1:1:0' } }, end: 10 }
    const s = { programs: [saved], activeProgramId: saved.id, workouts: [workout] }
    expect(completeGuidedProgramSession(s, workout)).toBe(true)
    expect(saved).toMatchObject({ status: 'completed', completedAt: 10 })
    expect(s.activeProgramId).toBeNull()
  })
})
