// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Premium Training Programs on the client: /api/premium wrappers, a small store and an offline copy of the catalogue (same shape as lib/guided-api.js).
// Offline the last catalogue this account received is shown; a program already running never depends on it (its definition is pinned in the member's own state).
import { create } from 'zustand'
import { api } from './api.js'

const CACHE = uid => 'premium_catalog:' + (uid || 'anon')
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode / full */ } }
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export const usePremium = create((set, get) => ({
  status: 'idle', offline: false, error: null, enabled: true, programs: [], canEdit: false, canAuthor: false, uid: null,
  async load(uid, force = false) {
    const st = get()
    if (!force && (st.status === 'loading' || (st.status === 'ready' && st.uid === uid))) return
    const cached = read(CACHE(uid))
    set({ status: cached ? 'ready' : 'loading', uid, ...(cached ? { programs: cached.programs, enabled: cached.enabled !== false, offline: false } : {}) })
    try {
      const r = await api('/api/premium')
      write(CACHE(r.uid || uid), { programs: r.programs || [], enabled: r.enabled !== false })
      set({ status: 'ready', offline: false, error: null, enabled: r.enabled !== false, programs: r.programs || [], canEdit: !!r.canEdit, canAuthor: !!r.canAuthor, uid: r.uid || uid })
    } catch (e) {
      // 403 feature_off: the gym switched the catalogue off for members — a clean "unavailable", not an error screen.
      if (e?.data?.code === 'feature_off' || /desactivada/i.test(e?.message || '')) set({ status: 'ready', enabled: false, programs: [], offline: false, error: null })
      else if (cached) set({ status: 'ready', offline: true })
      else set({ status: 'error', error: e.message, offline: typeof navigator !== 'undefined' && navigator.onLine === false })
    }
  },
  /** The full program (with its definition) for the sheet and the editor. */
  async detail(id) { const r = await api('/api/premium/program?id=' + encodeURIComponent(id)); return r.program },
  /** Best effort: lets staff see how many members started a program. Never blocks the member. */
  started(programId) { post('/api/premium/started', { programId }).catch(() => {}) },
  async save(program, dryRun = false) { const r = await post('/api/premium/save', { program, dryRun }); if (!dryRun) await get().load(get().uid, true); return r },
  async duplicate(id, catalog = false) { const r = await post('/api/premium/duplicate', { id, catalog }); await get().load(get().uid, true); return r.program },
  async setStatus(id, status) { await post('/api/premium/status', { id, status }); await get().load(get().uid, true) },
  async feature(id, patch) { await post('/api/premium/feature', { id, ...patch }); await get().load(get().uid, true) },
  async reorder(ids) { await post('/api/premium/reorder', { ids }); await get().load(get().uid, true) },
  async promote(id) { await post('/api/premium/promote', { id }); await get().load(get().uid, true) },
  async remove(id) { await post('/api/premium/delete', { id }); await get().load(get().uid, true) },
  async history(id) { const r = await api('/api/premium/history?id=' + encodeURIComponent(id)); return r.versions || [] },
  async restore(id, at) { const r = await post('/api/premium/restore', { id, at }); await get().load(get().uid, true); return r },
}))
