/** Day-plan markers keep the existing string value contract and add no separate planner state. */
export const movedDayValue = (target, routineId) => `moved:${target}:${routineId}`

export function parseMovedDay(value) {
  const match = /^moved:(\d{4}-\d{2}-\d{2}):(.+)$/.exec(String(value || ''))
  return match ? { to: match[1], routineId: match[2] } : null
}

export function dayPlanRoutineId(value) {
  if (typeof value !== 'string') return null
  return parseMovedDay(value)?.routineId || (value === 'rest' ? null : value || null)
}

export const isMovedDayPlan = value => !!parseMovedDay(value)

// A short reason for a skipped planned day ("sick", "travelling", ...), kept beside dayPlan as S.dayNotes[iso].
// A day with a note is an explained skip: the missed-session nudge leaves it alone.
export const DAY_NOTE_MAX = 80
export function normalizeDayNote(value) {
  const text = String(value ?? '').trim().slice(0, DAY_NOTE_MAX).trim()
  return text || null
}
export const dayNoteOf = (S, iso) => normalizeDayNote(S?.dayNotes?.[iso])
/** Next dayNotes map: an empty or whitespace-only value removes the note. */
export function setDayNote(dayNotes, iso, value) {
  const next = { ...(dayNotes || {}) }
  const note = normalizeDayNote(value)
  if (note) next[iso] = note
  else delete next[iso]
  return next
}
