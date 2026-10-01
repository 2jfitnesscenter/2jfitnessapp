// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Multi-week plans are snapshots over the existing guided-routine catalogue. Workouts and history
// remain the existing S.workouts / Workout V2 records; no parallel player or sync queue is added.

const copy = value => JSON.parse(JSON.stringify(value))

export function flattenProgramSessions(program) {
  return (program?.weeks || []).flatMap((week, weekIndex) => (week.sessions || []).map((session, dayIndex) => ({
    ...session,
    weekIndex,
    dayIndex,
    sessionId: `${weekIndex + 1}:${session.day}:${dayIndex}`,
  })))
}

export function validateGuidedProgram(program, routineIds) {
  const issues = []
  const sessions = flattenProgramSessions(program)
  if (!program?.id || !/^[a-z0-9-]+$/.test(program.id)) issues.push('stable-id')
  if (!program?.name || !program?.description) issues.push('metadata')
  if (!Number.isInteger(program?.weeksCount) || program.weeksCount !== program.weeks?.length) issues.push('weeks-count')
  if (!Number.isInteger(program?.sessionsPerWeek) || program.sessionsPerWeek < 1) issues.push('sessions-per-week')
  if (!sessions.length) issues.push('empty')
  for (const s of sessions) {
    if (!Number.isInteger(s.day) || s.day < 0 || s.day > 6) issues.push(`day:${s.sessionId}`)
    if (!routineIds.has(s.routineId)) issues.push(`routine:${s.routineId}`)
  }
  return [...new Set(issues)]
}

export function programProgress(program, workouts = []) {
  const sessions = flattenProgramSessions(program)
  const done = new Set(workouts.filter(w => w?.src2j?.program?.programId === program?.id)
    .map(w => w.src2j.program.sessionId).filter(Boolean))
  const completed = sessions.filter(s => done.has(s.sessionId)).length
  const next = sessions.find(s => !done.has(s.sessionId)) || null
  return { total: sessions.length, completed, percent: sessions.length ? Math.round(completed * 100 / sessions.length) : 0, next, done }
}

export function startGuidedProgram(S, catalog, { id, makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`, now = Date.now(), replaceActive = false } = {}) {
  if (S.active) return { ok: false, reason: 'workout-in-progress' }
  const current = (S.programs || []).find(p => p.id === S.activeProgramId && !['paused', 'abandoned', 'completed'].includes(p.status))
  if (current && !replaceActive) return { ok: false, reason: current.source === 'guided-v2' && current.catalogId === catalog?.id ? 'already-active' : 'active-program-conflict' }
  if (!catalog || !flattenProgramSessions(catalog).length) return { ok: false, reason: 'invalid-program' }
  const userKey = String(id || 'local').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 32) || 'local'
  const program = {
    id: `g2jp-${userKey}-${makeId()}`,
    source: 'guided-v2', schemaVersion: 1, catalogId: catalog.id,
    name: catalog.name, emoji: 'sparkles', status: 'active', startedAt: now,
    meta: { goal: catalog.goal, level: catalog.level, restrictions: [] },
    weeks: copy(catalog.weeks),
    // Pin each official routine version to the member's existing program snapshot so a later
    // catalogue edit cannot silently alter a plan already in progress.
    routineSnapshots: Object.fromEntries([...new Set(flattenProgramSessions(catalog).map(s => s.routineId))]
      .map(rid => [rid, copy(catalog.routines?.[rid])]).filter(([, routine]) => routine)),
  }
  if (Object.keys(program.routineSnapshots).length !== new Set(flattenProgramSessions(catalog).map(s => s.routineId)).size)
    return { ok: false, reason: 'routine-snapshot-missing' }
  if (current && current.source === 'guided-v2') current.status = 'paused'
  S.programs = [...(S.programs || []), program]
  S.activeProgramId = program.id
  return { ok: true, program }
}

export function setGuidedProgramStatus(S, id, status) {
  if (!['active', 'paused', 'abandoned', 'completed'].includes(status)) return false
  const program = (S.programs || []).find(p => p.id === id && p.source === 'guided-v2')
  if (!program) return false
  if (status === 'active' && S.activeProgramId && S.activeProgramId !== id) return false
  program.status = status
  program.updatedAt = Date.now()
  if (status === 'active') S.activeProgramId = id
  else if (S.activeProgramId === id) S.activeProgramId = null
  return true
}

export function completeGuidedProgramSession(S, workout) {
  const ref = workout?.src2j?.program
  const program = (S.programs || []).find(p => p.id === ref?.programId && p.source === 'guided-v2')
  if (!program || !ref?.sessionId) return false
  const sessions = flattenProgramSessions(program)
  const completed = new Set((S.workouts || []).filter(w => w?.src2j?.program?.programId === program.id)
    .map(w => w.src2j.program.sessionId).filter(Boolean))
  if (sessions.length && sessions.every(s => completed.has(s.sessionId))) {
    program.status = 'completed'
    program.completedAt = workout.end || Date.now()
    if (S.activeProgramId === program.id) S.activeProgramId = null
  }
  return true
}
