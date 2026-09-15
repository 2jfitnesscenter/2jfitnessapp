// Talking to /api/whoop/* — same shape as lib/strava-api.js.
import { api } from './api.js'

export const connectWhoop = () => { window.location.href = '/api/whoop/authorize' }
export const disconnectWhoop = () => api('/api/whoop/disconnect', { method: 'POST', body: '{}' })
export const fetchWhoopRecovery = () => api('/api/whoop/recovery')
export const fetchWhoopSleep = () => api('/api/whoop/sleep')
