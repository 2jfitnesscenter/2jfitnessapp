// "Repeat today": start the same routine again from a finished workout in History.
// Only the routine (its current exercises and prescriptions) is reused. Nothing about the
// old workout is copied, and nothing in the member's plan, week or routines is changed.

// Returns the routine id to start again, or null when the workout cannot be repeated
// (freestyle workout, or its routine has since been deleted).
export function repeatableRoutineId(state, w) {
  if (!w || !w.routineId) return null
  const routines = Array.isArray(state?.routines) ? state.routines : []
  return routines.some(r => r.id === w.routineId) ? w.routineId : null
}
