// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// "Entrena con 2J" on the client: /api/guided wrappers, a small store, an offline copy of the
// catalogue, and favourites.
//
// Offline: the last catalogue this account received is kept on the device, so the library opens
// without a connection, and a routine that is shown can be started (its exercises travel inside
// it; the session is local like any other). A catalogue never fetched cannot be shown offline.
// Favourites are a per-device, per-account convenience in V1 (never Sync V2): documented choice.
import { create } from 'zustand'
import { api } from './api.js'

const CACHE = uid => 'g2j_catalog:' + (uid || 'anon')
const FAVS = uid => 'g2j_favs:' + (uid || 'anon')
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode / full */ } }
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const hydratePrograms = (programs = [], routines = []) => {
  const byId = Object.fromEntries(routines.map(routine => [routine.id, routine]))
  return programs.map(program => {
    const ids = program.routineIds || [...new Set((program.weeks || []).flatMap(week => (week.sessions || []).map(session => session.routineId)))]
    return { ...program, routineIds: ids, routines: Object.fromEntries(ids.map(id => [id, byId[id]]).filter(([, routine]) => routine)) }
  })
}

export const useGuided = create((set, get) => ({
  status: 'idle', offline: false, error: null, rev: null,
  routines: [], programs: [], collections: [], mine: [], canEdit: false, canAssign: false, uid: null, favorites: [],
  async load(uid, force = false) {
    const st = get()
    if (!force && (st.status === 'loading' || (st.status === 'ready' && st.uid === uid))) return
    // Paint the device copy first (instant, and the only option offline), then refresh.
    const cached = read(CACHE(uid))
    set({ status: cached ? 'ready' : 'loading', uid, favorites: read(FAVS(uid)) || [], ...(cached ? { routines: cached.routines, programs: hydratePrograms(cached.programs, cached.routines), collections: cached.collections, offline: false } : {}) })
    try {
      const r = await api('/api/guided')
      const data = { routines: r.routines || [], programs: r.programs || [], collections: r.collections || [] }
      // Only what a member sees is kept on the device (never a trainer's own routines).
      write(CACHE(r.uid || uid), data)
      const programs = hydratePrograms(data.programs, data.routines)
      set({ status: 'ready', offline: false, error: null, rev: r.rev ?? null, ...data, programs, mine: r.mine || [], canEdit: !!r.canEdit, canAssign: !!r.canAssign, uid: r.uid || uid })
    } catch (e) {
      if (cached) set({ status: 'ready', offline: true })
      else set({ status: 'error', error: e.message, offline: typeof navigator !== 'undefined' && navigator.onLine === false })
    }
  },
  // /api/config carries the catalogue revision: an admin's publish refreshes an open library without a reload.
  notifyRev(rev) {
    const st = get()
    if (rev == null || st.status !== 'ready' || st.rev == null || String(st.rev) === String(rev)) return
    st.load(st.uid, true)
  },
  toggleFavorite(id) {
    const favs = new Set(get().favorites)
    if (favs.has(id)) favs.delete(id); else favs.add(id)
    const list = [...favs]
    write(FAVS(get().uid), list)
    set({ favorites: list })
    return favs.has(id)
  },
  async save(routine) { const r = await post('/api/guided/save', { routine }); await get().load(get().uid, true); return r },
  async duplicate(id) { const r = await post('/api/guided/duplicate', { id }); await get().load(get().uid, true); return r.routine },
  async setStatus(id, status) { await post('/api/guided/status', { id, status }); await get().load(get().uid, true) },
  async reorder(kind, ids) { await post('/api/guided/reorder', { kind, ids }); await get().load(get().uid, true) },
  async duplicateOfficial(id) { const r = await post('/api/guided/duplicate', { id, official: true }); await get().load(get().uid, true); return r.routine },
  async saveProgram(program, dryRun = false) { const r = await post('/api/guided/program/save', { program, dryRun }); if (!dryRun) await get().load(get().uid, true); return r },
  async duplicateProgram(id) { const r = await post('/api/guided/program/duplicate', { id }); await get().load(get().uid, true); return r.program },
  async removeProgram(id) { await post('/api/guided/program/delete', { id }); await get().load(get().uid, true) },
  async removeCollection(id) { await post('/api/guided/collection/delete', { id }); await get().load(get().uid, true) },
  async setActive(id, active) { await post('/api/guided/active', { id, active }); await get().load(get().uid, true) },
  async remove(id) { await post('/api/guided/delete', { id }); await get().load(get().uid, true) },
  async curate(id, patch) { await post('/api/guided/curate', { id, ...patch }); await get().load(get().uid, true) },
  async curateProgram(id, patch) { await post('/api/guided/program/curate', { id, ...patch }); await get().load(get().uid, true) },
  async saveCollection(collection) { await post('/api/guided/collection', { collection }); await get().load(get().uid, true) },
}))

export const favSet = favorites => new Set(favorites || [])
