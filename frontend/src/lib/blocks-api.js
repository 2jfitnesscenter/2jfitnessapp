// Copyright (C) 2026 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Constructor V2 — the block library on the client: /api/blocks wrappers, a small cached store,
// and the protocol context the builder validates with (same validator as the server).
import { create } from 'zustand'
import { api } from './api.js'
import { EXIDX, unavailableEquipmentList } from './exercises.js'
import { nameFor, t } from './i18n.js'
import { validateAgainst2JProtocol, MESSAGES, DEFAULT_REASON, FOCUS_LABEL, GOAL_LABEL, LEVEL_LABEL, RESTRICTION_LABEL, format } from './protocol/index.js'

export const lookup = id => EXIDX[id] || null
export const protoCtx = (extra = {}) => ({ lookup, nameOf: id => (EXIDX[id] ? nameFor(EXIDX[id]) : id), unavailableEq: unavailableEquipmentList(), ...extra })

/** Validate with the builder's context; messages rendered in the UI language. */
export function validate(target, extra) {
  return validateAgainst2JProtocol(target, protoCtx(extra))
}
const paramLabel = p => {
  if (typeof p !== 'string') return p
  if (FOCUS_LABEL[p]) return t(FOCUS_LABEL[p]).toLowerCase()
  if (GOAL_LABEL[p]) return t(GOAL_LABEL[p]).toLowerCase()
  if (LEVEL_LABEL[p]) return t(LEVEL_LABEL[p]).toLowerCase()
  if (RESTRICTION_LABEL[p]) return t(RESTRICTION_LABEL[p]).toLowerCase()
  return p
}
const cap = s => s ? s.charAt(0).toUpperCase() + s.slice(1) : s
export const issueText = i => cap(t(MESSAGES[i.code] || i.code, ...(i.params || []).map(paramLabel)))
export const reasonText = i => i.reasonGiven ? i.reason : (DEFAULT_REASON[i.code] ? t(DEFAULT_REASON[i.code]) : '')
export const fmt = format

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })

export const useBlocks = create((set, get) => ({
  status: 'idle', blocks: [], favorites: [], canEditOfficial: false, uid: null, error: null,
  async load(force = false) {
    if (!force && (get().status === 'ready' || get().status === 'loading')) return
    set({ status: 'loading', error: null })
    try {
      const r = await api('/api/blocks')
      set({ status: 'ready', blocks: r.blocks || [], favorites: r.favorites || [], canEditOfficial: !!r.canEditOfficial, uid: r.uid || null })
    } catch (e) { set({ status: 'error', error: e.message }) }
  },
  upsertLocal(b) { set(s => ({ blocks: s.blocks.some(x => x.id === b.id) ? s.blocks.map(x => x.id === b.id ? b : x) : [...s.blocks, b] })) },
  async save(block) {
    const r = await post('/api/blocks/save', { block })
    get().upsertLocal(r.block)
    return r
  },
  async duplicate(id) { const r = await post('/api/blocks/duplicate', { id }); get().upsertLocal(r.block); return r.block },
  async setActive(id, active) { const r = await post('/api/blocks/active', { id, active }); get().upsertLocal(r.block); return r.block },
  async remove(id) { await post('/api/blocks/delete', { id }); set(s => ({ blocks: s.blocks.filter(b => b.id !== id), favorites: s.favorites.filter(f => f !== id) })) },
  async favorite(id, on) {
    set(s => ({ favorites: on ? [...new Set([...s.favorites, id])] : s.favorites.filter(f => f !== id) }))
    try { const r = await post('/api/blocks/favorite', { id, on }); set({ favorites: r.favorites }) } catch (e) { get().load(true); throw e }
  },
}))

// "Recientes": the last blocks this trainer inserted, kept per device only (a convenience).
const RECENT_KEY = 'cx_recent_blocks'
export function recentBlocks() { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') } catch { return [] } }
export function pushRecent(id) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recentBlocks().filter(x => x !== id)].slice(0, 8))) } catch { /* private mode */ }
}
