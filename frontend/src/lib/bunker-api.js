// Thin wrappers over api/bunker/routes.js. Two trust levels never send the normal session
// cookie's worth of auth — the kiosk itself isn't signed in as anyone — so every bunker-token
// or admin-token call carries it explicitly as a Bearer header instead of relying on
// lib/api.js's cookie-based api(). Every admin-* wrapper takes an optional `adminToken`: pass
// one from the kiosk's own admin-code overlay, or omit it to fall back to the normal cookie
// session (a trainer/admin's own phone at /admin/bunker) — either way the same server route.
import { api } from './api.js'

const bearer = token => ({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } })
const jsonHeaders = { headers: { 'Content-Type': 'application/json' } }
const adminHeaders = adminToken => (adminToken ? bearer(adminToken) : jsonHeaders)
// Every plain fetch() below goes through this — fetch only ever REJECTS on a network failure,
// never on a 4xx/5xx with a JSON body, so without this an expired admin token or session would
// resolve "successfully" into {error: '...'} and whatever field the caller expected next
// (sessions, members, …) would silently be undefined instead of the call failing loudly.
const okJson = r => r.json().then(d => {
  if (!r.ok) throw Object.assign(new Error(d.error || 'error'), { status: r.status, data: d })
  return d
})

/* ---------- a member's own phone (normal session) ---------- */
export const fetchBunkerPin = () => api('/api/bunker/pin').then(r => r.pin)
export const resetBunkerPin = () => api('/api/bunker/pin/reset', { method: 'POST', body: '{}' }).then(r => r.pin)
export const fetchBunkerAdminCode = () => api('/api/bunker/admin-code').then(r => r.code)
export const fetchBunkerLaunchLink = () => api('/api/bunker/launch-link').then(r => r.key)
// One-shot handoff of the phone's own S.active onto the server, for the kiosk to pick up — see
// api/bunker/routes.js's own doc comment on the endpoint. A 409 (someone else's session already
// in progress) throws with e.status===409 and e.data.existing carrying that session, so the
// caller can ask "discard it?" before retrying with force:true.
export const handoffToBunker = (active, force) =>
  api('/api/bunker/handoff', { method: 'POST', body: JSON.stringify({ active, force: !!force }) })

/* ---------- the shared kiosk screen (no cookie session) ---------- */
export const fetchBunkerBoard = () => fetch('/api/bunker/board').then(okJson).then(r => r.sessions)
export const fetchBunkerSnapshot = () => fetch('/api/bunker/board').then(okJson).then(r => ({
  sessions: Array.isArray(r.sessions) ? r.sessions : [],
  todayPrs: Array.isArray(r.todayPrs) ? r.todayPrs : [],
}))
export const fetchBunkerSettings = () => fetch('/api/bunker/settings').then(okJson)
export const bunkerCheckin = pin =>
  fetch('/api/bunker/checkin', { method: 'POST', ...jsonHeaders, body: JSON.stringify({ pin }) }).then(okJson)
export const verifyBunkerLaunch = token =>
  fetch('/api/bunker/verify-launch', { method: 'POST', ...jsonHeaders, body: JSON.stringify({ token }) }).then(okJson).then(r => r.ok)
export const fetchBunkerSession = token =>
  fetch('/api/bunker/session', bearer(token)).then(okJson)
export const postBunkerActive = (token, payload) =>
  fetch('/api/bunker/active', { ...bearer(token), method: 'POST', body: JSON.stringify(payload) }).then(okJson)
export const postBunkerRest = (token, sec) =>
  fetch('/api/bunker/rest', { ...bearer(token), method: 'POST', body: JSON.stringify({ sec }) }).then(okJson)
export const postBunkerFinish = (token, workout) =>
  fetch('/api/bunker/finish', { ...bearer(token), method: 'POST', body: JSON.stringify({ workout }) }).then(okJson)

/* ---------- room admin ---------- */
export const bunkerAdminCheckin = code =>
  fetch('/api/bunker/admin-checkin', { method: 'POST', ...jsonHeaders, body: JSON.stringify({ code }) }).then(okJson)
export const fetchBunkerAdminSessions = adminToken =>
  fetch('/api/bunker/admin/sessions', adminHeaders(adminToken)).then(okJson).then(r => r.sessions)
export const closeBunkerSession = (uid, adminToken) =>
  fetch('/api/bunker/admin/close', { ...adminHeaders(adminToken), method: 'POST', body: JSON.stringify({ uid }) }).then(okJson)
export const pauseBunkerSession = (uid, paused, adminToken) =>
  fetch('/api/bunker/admin/pause', { ...adminHeaders(adminToken), method: 'POST', body: JSON.stringify({ uid, paused }) }).then(okJson)
export const fetchBunkerAdminSession = (uid, adminToken) =>
  fetch('/api/bunker/admin/session?uid=' + encodeURIComponent(uid), adminHeaders(adminToken)).then(okJson)
export const postBunkerAdminEditSet = (payload, adminToken) =>
  fetch('/api/bunker/admin/edit-set', { ...adminHeaders(adminToken), method: 'POST', body: JSON.stringify(payload) }).then(okJson)
export const fetchBunkerMembers = adminToken =>
  fetch('/api/bunker/admin/members', adminHeaders(adminToken)).then(okJson).then(r => r.members)
export const resetBunkerMemberPin = (uid, adminToken) =>
  fetch('/api/bunker/admin/pin-reset', { ...adminHeaders(adminToken), method: 'POST', body: JSON.stringify({ uid }) }).then(okJson).then(r => r.pin)
export const resetBunkerRoomKey = adminToken =>
  fetch('/api/bunker/admin/room-key/reset', { ...adminHeaders(adminToken), method: 'POST' }).then(okJson).then(r => r.key)
export const saveBunkerSettings = (patch, adminToken) =>
  fetch('/api/bunker/admin/settings', { ...adminHeaders(adminToken), method: 'POST', body: JSON.stringify(patch) }).then(okJson)
