// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Gestión del centro: the small pure helpers behind the console (Hoy · Miembros · Entrenadores). The data comes from /api/center/*, which composes
// assignments, the derived workout summary and the Coach follow-up engine; nothing is recomputed here beyond how a row is labelled and filtered.
// "Last activity" is the last WORKOUT (lastWorkoutAt). Syncing is not training, and the console never calls it "active".
import { api } from './api.js'

export const fetchCenterToday = (days = 7) => api('/api/center/today?days=' + encodeURIComponent(days))
export const fetchCenterMembers = () => api('/api/center/members')
export const fetchCenterTrainers = () => api('/api/center/trainers')

export const TABS = ['today', 'members', 'trainers']
const DAY = 86400000
const dayMs = iso => Date.parse(String(iso).slice(0, 10) + 'T12:00:00Z')
export const daysBetween = (fromIso, toIso) => Math.round((dayMs(toIso) - dayMs(fromIso)) / DAY)
export const NEW_DAYS = 14

/**
 * What to say about a member at a glance: disabled · training (right now) · new (joined recently, nothing logged yet) · never (old enough, nothing logged) ·
 * idle (no workout for `idleDays` or more) · ok.
 */
export function memberStatus(u, today, idleDays = 7) {
  if (u.disabled) return 'disabled'
  if (u.activeNow) return 'training'
  if (!u.lastWorkoutAt) return u.created && daysBetween(u.created, today) < NEW_DAYS ? 'new' : 'never'
  return daysBetween(u.lastWorkoutAt, today) >= idleDays ? 'idle' : 'ok'
}

export const STATUS_FILTERS = ['all', 'training', 'idle', 'new', 'disabled']
const matchesStatus = (u, status, today, idleDays) => {
  if (status === 'all') return true
  const s = memberStatus(u, today, idleDays)
  if (status === 'idle') return s === 'idle' || s === 'never'
  return s === status
}

/** The Members list: text (name or trainer), status chip, trainer ('' all · 'none' unassigned · a trainer id) and role ('' all · member · trainer · admin). Stable order: name. */
export function filterMembers(users, { q = '', status = 'all', trainer = '', role = '', today, idleDays = 7 } = {}) {
  const s = q.trim().toLowerCase()
  return users.filter(u => {
    if (s && !String(u.name || '').toLowerCase().includes(s) && !(u.assignedTrainers || []).some(t => String(t.name).toLowerCase().includes(s))) return false
    if (trainer === 'none' ? (u.assignedTrainers || []).length > 0 : trainer && !(u.assignedTrainers || []).some(t => t.id === trainer)) return false
    if (role && u.role !== role) return false
    return matchesStatus(u, status, today, idleDays)
  }).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')))
}

/** Counts for the filter chips, over the list as it stands before the status filter is applied. */
export function statusCounts(users, today, idleDays = 7) {
  const out = { all: users.length, training: 0, idle: 0, new: 0, disabled: 0 }
  for (const u of users) { const s = memberStatus(u, today, idleDays); if (s === 'training') out.training++; else if (s === 'idle' || s === 'never') out.idle++; else if (s === 'new') out.new++; else if (s === 'disabled') out.disabled++ }
  return out
}
