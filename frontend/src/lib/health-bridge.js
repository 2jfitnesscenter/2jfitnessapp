// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Health native bridge, web side (docs/HEALTH_NATIVE_BRIDGE.md). A native shell (Android Health
// Connect / iOS HealthKit) exposes a READ-ONLY feature-detected object; everything here works
// without one and does nothing in a normal browser or the installed PWA.
//
//   window.TwoJNative.health = {
//     platform?: 'android' | 'ios',
//     isAvailable(): Promise<{ available, reason? }>,
//     requestPermissions(): Promise<{ granted: string[] }>      // 'workouts' | 'activeCalories' | 'heartRate'
//     readWorkouts({ start, end }): Promise<Session[]>          // per-workout aggregates, never raw samples
//   }
//   (a Capacitor plugin named TwoJHealth with the same three methods is accepted too)
//
// Privacy by construction: off by default; the person turns it on and can turn it off; consent and
// last-sync live on THIS device only (the OS permission belongs to the device) — no server endpoint,
// no token, no new sync queue. What is read goes through the existing mappers into `w.fitness` and
// then travels exactly like any other workout field (Sync V2). Everything the shell hands over is
// re-validated and whitelisted here: a bad or oversized answer is dropped, never stored.
import { mapHealthConnectSession, mapHealthKitWorkout, matchAll, attachFitness } from './fitness.js'

export const DEFAULT_DAYS = 30
export const MAX_DAYS = 90
export const MAX_SESSIONS = 500
const MAX_SESSION_MS = 24 * 3600e3
const FUTURE_SLACK_MS = 5 * 60e3
export const PERMISSIONS = ['workouts', 'activeCalories', 'heartRate']

const KEY = uid => 'health_bridge_v1:' + (uid || 'anon')
const read = k => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true } catch { return false } }

/* ------------------------------------------------------------------ detection --- */

const isBridge = b => !!b && ['isAvailable', 'requestPermissions', 'readWorkouts'].every(m => typeof b[m] === 'function')
/** The native health bridge of this shell, or null (browser, installed PWA, a shell without health). */
export function getBridge(root = globalThis) {
  const native = root?.TwoJNative?.health
  if (isBridge(native)) return native
  return capacitorBridge(root?.Capacitor)
}

/**
 * The Android Capacitor plugin (TwoJHealth, android/app/src/main/java/.../health): a Capacitor call can
 * only resolve with an object, so readWorkouts answers { sessions } and is unwrapped here to the contract's
 * array. Works in the bundled app and in a shell that loads the 2J PWA by URL (the bridge is injected
 * either way): through Capacitor.Plugins when present, otherwise through nativePromise.
 */
function capacitorBridge(cap) {
  if (!cap || (typeof cap.isNativePlatform === 'function' && !cap.isNativePlatform())) return null
  const plugin = cap.Plugins?.TwoJHealth
  let call = null
  if (isBridge(plugin)) call = (m, o) => plugin[m](o)
  else if (typeof cap.nativePromise === 'function' && typeof cap.isPluginAvailable === 'function' && cap.isPluginAvailable('TwoJHealth')) call = (m, o) => cap.nativePromise('TwoJHealth', m, o || {})
  if (!call) return null
  return {
    platform: typeof cap.getPlatform === 'function' && cap.getPlatform() === 'ios' ? 'ios' : 'android',
    isAvailable: () => call('isAvailable'),
    requestPermissions: () => call('requestPermissions'),
    readWorkouts: async q => { const r = await call('readWorkouts', q); return Array.isArray(r) ? r : r?.sessions },
  }
}
export const platformLabel = bridge => bridge?.platform === 'ios' ? 'Apple Health' : bridge?.platform === 'android' ? 'Health Connect' : 'Health'

/* -------------------------------------------------------------------- consent --- */

export const bridgeState = uid => {
  if (!uid) return { enabled: false, at: null, lastSync: null, granted: [] }
  const s = read(KEY(uid))
  const granted = Array.isArray(s?.granted) ? s.granted.filter(g => PERMISSIONS.includes(g)) : []
  return s?.enabled === true && granted.includes('workouts')
    ? { enabled: true, at: +s.at || null, lastSync: +s.lastSync || null, granted }
    : { enabled: false, at: null, lastSync: null, granted: [] }
}
/** Turning it off forgets this device's consent; data already linked to workouts stays (the person's own). */
export const disconnectBridge = uid => { if (uid) { try { localStorage.removeItem(KEY(uid)) } catch { /* private mode */ } } }

/* ------------------------------------------------------------------ validation --- */

const num = (v, lo, hi) => { const n = Number(v); return Number.isFinite(n) && n >= lo && n <= hi ? n : null }
const text = (v, n = 120) => typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : null
const ms = v => { const t = typeof v === 'number' ? v : Date.parse(v); return Number.isFinite(t) ? t : null }

/**
 * One session from the shell → the exact input a mapper takes, with only the fields the contract
 * names and sane bounds; anything else (raw heart-rate arrays, sample lists, extra metadata) is
 * dropped. Returns null for a session that is not a real, finished, plausible workout.
 */
export function sanitizeSession(x, now = Date.now()) {
  if (!x || typeof x !== 'object') return null
  const android = x.startTime != null, ios = x.startDate != null
  if (android === ios) return null
  const start = ms(android ? x.startTime : x.startDate), end = ms(android ? x.endTime : x.endDate)
  if (start == null || end == null || !(end > start) || end - start > MAX_SESSION_MS || end > now + FUTURE_SLACK_MS || start < 946684800000) return null
  if (android) {
    const a = x.aggregates && typeof x.aggregates === 'object' ? x.aggregates : {}
    const id = text(x.metadata?.id, 200)
    if (!id) return null
    const clean = { startTime: start, endTime: end, exerciseType: num(x.exerciseType, 0, 1000) ?? text(x.exerciseType, 60),
      metadata: { id, dataOrigin: { packageName: text(x.metadata?.dataOrigin?.packageName, 160) } },
      aggregates: { activeCaloriesKcal: num(a.activeCaloriesKcal, 0, 20000), totalCaloriesKcal: num(a.totalCaloriesKcal, 0, 20000), hrAvg: num(a.hrAvg, 20, 260), hrMax: num(a.hrMax, 20, 260) } }
    return clean
  }
  const uuid = text(x.uuid, 200)
  if (!uuid) return null
  return { uuid, startDate: start, endDate: end, workoutActivityType: num(x.workoutActivityType, 0, 1000) ?? text(x.workoutActivityType, 60),
    sourceRevision: { source: { name: text(x.sourceRevision?.source?.name, 120), bundleIdentifier: text(x.sourceRevision?.source?.bundleIdentifier, 160) } },
    activeEnergyKcal: num(x.activeEnergyKcal, 0, 20000), hrAvg: num(x.hrAvg, 20, 260), hrMax: num(x.hrMax, 20, 260) }
}

/** Sessions → records (mapper output), de-duplicated by source + externalId, capped. */
export function recordsFrom(sessions, now = Date.now(), range = null) {
  const list = Array.isArray(sessions) ? sessions.slice(0, MAX_SESSIONS) : []
  const seen = new Set(), records = []
  let rejected = Math.max(0, (Array.isArray(sessions) ? sessions.length : 0) - list.length)
  for (const raw of list) {
    const s = sanitizeSession(raw, now)
    const start = s?.startTime ?? s?.startDate
    const end = s?.endTime ?? s?.endDate
    if (s && range && (start < range.start || end > range.end)) { rejected++; continue }
    const rec = s ? (s.startTime != null ? mapHealthConnectSession(s, now) : mapHealthKitWorkout(s, now)) : null
    if (!rec || !rec.externalId) { rejected++; continue }
    const k = rec.source + '|' + rec.externalId
    if (seen.has(k)) continue
    seen.add(k); records.push(rec)
  }
  return { records, rejected }
}

/* ------------------------------------------------------------------- the flow --- */

/** Ask the OS for read access. Only called from an explicit tap; nothing is read here. */
export async function connectBridge({ uid, bridge = getBridge(), now = Date.now() } = {}) {
  if (!uid) return { status: 'unavailable', reason: 'user_required' }
  if (!bridge) return { status: 'unavailable' }
  let avail
  try { avail = await bridge.isAvailable() } catch { return { status: 'unavailable' } }
  if (!avail?.available) return { status: 'unavailable', reason: avail?.reason || null }
  let res
  try { res = await bridge.requestPermissions() } catch { return { status: 'denied' } }
  const granted = (Array.isArray(res?.granted) ? res.granted : []).filter(g => PERMISSIONS.includes(g))
  if (!granted.includes('workouts')) return { status: 'denied' }
  if (!write(KEY(uid), { enabled: true, at: now, lastSync: null, granted })) return { status: 'error' }
  return { status: 'connected', granted }
}

/**
 * Read the last `days` days and match them to the member's workouts (pure: nothing is stored).
 * Without the person's consent nothing is even requested from the shell.
 * Result: { status, match, ambiguous, none, linked, rejected }.
 */
export async function readBridge({ uid, workouts, bridge = getBridge(), days = DEFAULT_DAYS, now = Date.now() } = {}) {
  if (!uid) return { status: 'off' }
  if (!bridge) return { status: 'unavailable' }
  if (!bridgeState(uid).enabled) return { status: 'off' }
  const span = Math.min(MAX_DAYS, Math.max(1, Math.round(Number(days) || DEFAULT_DAYS)))
  let sessions
  try { sessions = await bridge.readWorkouts({ start: new Date(now - span * 86400e3).toISOString(), end: new Date(now).toISOString() }) }
  catch (e) { return { status: e?.code === 'permission_denied' ? 'denied' : 'error' } }   // access revoked since connecting
  if (!Array.isArray(sessions)) return { status: 'error' }
  // Consent can be revoked while the native read is in flight. Discard the result and do not
  // recreate the local consent record if that happened.
  const consent = bridgeState(uid)
  if (!consent.enabled) return { status: 'off' }
  const { records: mapped, rejected } = recordsFrom(sessions, now, { start: now - span * 86400e3, end: now })
  // Native permission grants may be partial. Never retain an optional metric merely because a
  // shell accidentally returned it: the OS grant list is the authority for what may be attached.
  const records = mapped.map(rec => ({
    ...rec,
    calories: consent.granted.includes('activeCalories') ? rec.calories : null,
    caloriesKind: consent.granted.includes('activeCalories') ? rec.caloriesKind : null,
    avgHr: consent.granted.includes('heartRate') ? rec.avgHr : null,
    maxHr: consent.granted.includes('heartRate') ? rec.maxHr : null,
  }))
  const res = matchAll(workouts || [], records)
  const prev = read(KEY(uid)) || {}
  write(KEY(uid), { ...prev, enabled: true, lastSync: now })
  return { status: 'ok', ...res, rejected, read: records.length }
}

/** Attach the unambiguous matches inside an update(); ambiguous ones are left for the person to choose. */
export function applyMatches(S, res) {
  let attached = 0
  for (const { rec, workoutId } of res?.match || []) {
    const w = (S.workouts || []).find(x => x.id === workoutId)
    if (w) { attachFitness(w, rec); attached++ }
  }
  return attached
}
