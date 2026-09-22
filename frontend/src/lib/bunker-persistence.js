export function loadPendingFinish(storage, key) {
  try {
    const value = JSON.parse(storage.getItem(key) || 'null')
    return value && value.id && Array.isArray(value.entries) ? value : null
  } catch {
    return null
  }
}

export function stagePendingFinish(storage, key, workout) {
  try { storage.setItem(key, JSON.stringify(workout)) } catch { /* caller retains it in memory */ }
  return workout
}

// Finish is idempotent server-side by workout id. Keep the exact payload until the response is
// confirmed, so a lost request or response can be retried without rebuilding or duplicating it.
export async function retryPendingFinish({ storage, key, workout: inMemory, drainActive, send }) {
  const workout = inMemory || loadPendingFinish(storage, key)
  if (await drainActive() === false) return { pending: true, completed: false }
  if (!workout) return { pending: false, completed: false }
  try {
    await send(workout)
    try { storage.removeItem(key) } catch { /* already confirmed server-side */ }
    return { pending: false, completed: true }
  } catch {
    return { pending: true, completed: false }
  }
}
