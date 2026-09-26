// Copyright (C) 2026 2J Fitness Center
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

export const useGuided = create((set, get) => ({
  status: 'idle', offline: false, error: null,
  routines: [], collections: [], mine: [], canEdit: false, canAssign: false, uid: null, favorites: [],
  async load(uid, force = false) {
    const st = get()
    if (!force && (st.status === 'loading' || (st.status === 'ready' && st.uid === uid))) return
    // Paint the device copy first (instant, and the only option offline), then refresh.
    const cached = read(CACHE(uid))
    set({ status: cached ? 'ready' : 'loading', uid, favorites: read(FAVS(uid)) || [], ...(cached ? { routines: cached.routines, collections: cached.collections, offline: false } : {}) })
    try {
      const r = await api('/api/guided')
      const data = { routines: r.routines || [], collections: r.collections || [] }
      // Only what a member sees is kept on the device (never a trainer's own routines).
      write(CACHE(r.uid || uid), data)
      set({ status: 'ready', offline: false, error: null, ...data, mine: r.mine || [], canEdit: !!r.canEdit, canAssign: !!r.canAssign, uid: r.uid || uid })
    } catch (e) {
      if (cached) set({ status: 'ready', offline: true })
      else set({ status: 'error', error: e.message, offline: typeof navigator !== 'undefined' && navigator.onLine === false })
    }
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
  async setActive(id, active) { await post('/api/guided/active', { id, active }); await get().load(get().uid, true) },
  async remove(id) { await post('/api/guided/delete', { id }); await get().load(get().uid, true) },
  async curate(id, patch) { await post('/api/guided/curate', { id, ...patch }); await get().load(get().uid, true) },
  async saveCollection(collection) { await post('/api/guided/collection', { collection }); await get().load(get().uid, true) },
}))

export const favSet = favorites => new Set(favorites || [])
