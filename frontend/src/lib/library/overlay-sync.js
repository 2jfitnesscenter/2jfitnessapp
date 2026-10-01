// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The admin's Exercise Library corrections on this device: applied from /api/config, kept in
// localStorage so an offline start sees the same library, and replaced as soon as the server
// answers with a newer revision. A malformed or stale copy is ignored, never trusted blindly.
import { applyLibraryOverlay, overlayRevisionOf, libraryOverlay, spanishNameOverrides } from './core.js'
import { setNameOverrides } from '../i18n.js'

const KEY = 'lib_overlay_v1'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || 'null') } catch { return null } }
const write = o => { try { localStorage.setItem(KEY, JSON.stringify(o)) } catch { /* private mode / full */ } }

function apply(raw) {
  const clean = applyLibraryOverlay(raw)
  setNameOverrides({ ...spanishNameOverrides() })
  return clean
}

/** Apply the overlay carried by a /api/config answer; returns true when the library changed. */
export function applyConfigOverlay(config) {
  const raw = config && config.libraryOverlay
  if (!raw || typeof raw !== 'object') return false
  const have = libraryOverlay()
  if (have && have.rev === raw.rev && overlayRevisionOf() > 0) return false
  write(raw); apply(raw)
  return true
}

/** At start-up, before (or without) the network: the last overlay this device received. */
export function restoreCachedOverlay() {
  const raw = read()
  if (!raw || typeof raw !== 'object') return false
  apply(raw)
  return true
}

/** The admin's own, full overlay (curatorial notes included): applied here, cached without the notes. */
export function applyAdminOverlay(raw) {
  if (!raw || typeof raw !== 'object') return false
  const entries = {}
  for (const [id, e] of Object.entries(raw.entries || {})) { const { note: _n, ...rest } = e; if (Object.keys(rest).length) entries[id] = rest }
  write({ v: raw.v, rev: raw.rev, entries, variants: raw.variants || [] })
  apply(raw)
  return true
}
