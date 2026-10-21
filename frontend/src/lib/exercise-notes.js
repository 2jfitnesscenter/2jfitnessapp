// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The shared exercise note (api/lib/exercise-notes.js): ONE text per member + exercise, the same value for the member and the staff who may reach them.
// A tiny module cache keyed by member ('' = the signed-in user) so every card of a workout shows the same notes from a single request.
import { useEffect, useState } from 'react'
import { api } from './api.js'

export const NOTE_MAX = 500
const stores = new Map()   // key -> { notes, loading, subs:Set }
const keyOf = memberId => memberId || ''
const storeFor = key => { if (!stores.has(key)) stores.set(key, { notes: null, loading: null, subs: new Set() }); return stores.get(key) }
const emit = st => st.subs.forEach(f => f())

export function loadNotes(memberId, { force = false } = {}) {
  const st = storeFor(keyOf(memberId))
  if (st.loading && !force) return st.loading
  st.loading = api('/api/exercise-notes' + (memberId ? '?memberId=' + encodeURIComponent(memberId) : ''))
    .then(r => { st.notes = r.notes || {}; emit(st); return st.notes })
    .catch(e => { st.loading = null; throw e })
  return st.loading
}

/** Create / edit (text) or delete (empty text). Resolves with the saved note or null. */
export async function saveNote(memberId, exerciseId, text) {
  const r = await api('/api/exercise-notes', { method: 'POST', body: JSON.stringify({ exerciseId, text, ...(memberId ? { memberId } : {}) }) })
  const st = storeFor(keyOf(memberId))
  st.notes = { ...(st.notes || {}) }
  if (r.note) st.notes[exerciseId] = r.note; else delete st.notes[exerciseId]
  emit(st)
  return r.note
}

export function useExerciseNote(memberId, exerciseId) {
  const st = storeFor(keyOf(memberId))
  const [, tick] = useState(0)
  useEffect(() => {
    const f = () => tick(n => n + 1)
    st.subs.add(f)
    if (!st.notes) loadNotes(memberId).catch(() => {})
    return () => { st.subs.delete(f) }
  }, [memberId])
  return { note: st.notes?.[exerciseId] || null, ready: !!st.notes }
}

export const forgetExerciseNotes = () => stores.clear()
