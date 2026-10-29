/** Add existing routines to a member program without duplicating ids or changing source routines. */
export function mergeRoutineIds(current = [], incoming = []) {
  return [...new Set([...current, ...incoming].filter(id => typeof id === 'string' && id.length > 0))]
}
