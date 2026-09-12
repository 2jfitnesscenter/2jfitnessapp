// Talking to /api/strava/* — same shape as lib/friends-api.js. Connecting is a full-page
// redirect (Strava's own consent screen), not a fetch — there's nothing to await.
import { api } from './api.js'

export const connectStrava = () => { window.location.href = '/api/strava/authorize' }
export const disconnectStrava = () => api('/api/strava/disconnect', { method: 'POST', body: '{}' })
// Fire-and-forget right after a workout finishes (sheets.jsx) — the endpoint itself no-ops
// (200) when not connected, so the caller never needs to know the connection state first.
export const sendWorkoutToStrava = w => api('/api/strava/activities', {
  method: 'POST', body: JSON.stringify({ name: w.name, start: w.start, end: w.end, vol: w.vol })
})
