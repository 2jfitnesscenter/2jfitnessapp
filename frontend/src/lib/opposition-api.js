// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Oposiciones on the client: /api/opposition wrappers, a small store and an offline copy of the profile catalogue (same shape as lib/premium-api.js).
// Offline the last catalogue this account received is shown; a plan already running never depends on it (its profile is pinned in the member's own state).
import { create } from 'zustand'
import { api } from './api.js'

const CACHE = uid => 'opposition_catalog:' + (uid || 'anon')
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* private mode / full */ } }
const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export const useOpposition = create((set, get) => ({
  status: 'idle', offline: false, error: null, enabled: true, profiles: [], canEdit: false, uid: null,
  async load(uid, force = false) {
    const st = get()
    if (!force && (st.status === 'loading' || (st.status === 'ready' && st.uid === uid))) return
    const cached = read(CACHE(uid))
    set({ status: cached ? 'ready' : 'loading', uid, ...(cached ? { profiles: cached.profiles, enabled: cached.enabled !== false, offline: false } : {}) })
    try {
      const r = await api('/api/opposition')
      write(CACHE(uid), { profiles: r.profiles || [], enabled: r.enabled !== false })
      set({ status: 'ready', offline: false, error: null, enabled: r.enabled !== false, profiles: r.profiles || [], canEdit: !!r.canEdit, uid })
    } catch (e) {
      if (e?.data?.code === 'feature_off' || /desactivada/i.test(e?.message || '')) set({ status: 'ready', enabled: false, profiles: [], offline: false, error: null })
      else if (cached) set({ status: 'ready', offline: true })
      else set({ status: 'error', error: e.message, offline: typeof navigator !== 'undefined' && navigator.onLine === false })
    }
  },
  /** The full profile (every test and scale) the wizard and the editor work with. */
  async detail(id) { const r = await api('/api/opposition/profile?id=' + encodeURIComponent(id)); return r.profile },
  /** A pinned older version, while the server still keeps it (administrators). */
  async version(id, version) { const r = await api(`/api/opposition/version?id=${encodeURIComponent(id)}&version=${version}`); return r.profile },
  started(profileId) { post('/api/opposition/started', { profileId }).catch(() => {}) },
  async save(profile, dryRun = false) { const r = await post('/api/opposition/save', { profile, dryRun }); if (!dryRun) await get().load(get().uid, true); return r },
  async setStatus(id, status) { await post('/api/opposition/status', { id, status }); await get().load(get().uid, true) },
  async remove(id) { await post('/api/opposition/delete', { id }); await get().load(get().uid, true) },
  async history(id) { const r = await api('/api/opposition/history?id=' + encodeURIComponent(id)); return r.versions || [] },
}))
