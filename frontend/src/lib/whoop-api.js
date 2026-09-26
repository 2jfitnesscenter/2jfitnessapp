// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Talking to /api/whoop/* — same shape as lib/strava-api.js.
import { api } from './api.js'

export const connectWhoop = () => { window.location.href = '/api/whoop/authorize' }
export const disconnectWhoop = () => api('/api/whoop/disconnect', { method: 'POST', body: '{}' })
export const fetchWhoopRecovery = () => api('/api/whoop/recovery')
export const fetchWhoopSleep = () => api('/api/whoop/sleep')
// Recent WHOOP workouts (read-only) for lib/fitness.js to map and match — Health V2 / Fitness V1.
export const fetchWhoopWorkouts = (days = 30) => api('/api/whoop/workouts?days=' + days)
