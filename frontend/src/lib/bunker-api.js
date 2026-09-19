// Thin wrappers over api/bunker/routes.js. Two of these (checkin, board) never send the
// normal session cookie's worth of auth — the kiosk itself isn't signed in as anyone — so
// every bunker-token call carries it explicitly as a Bearer header instead of relying on
// lib/api.js's cookie-based api().
import { api } from './api.js'

const bearer = token => ({ headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token } })

/* ---------- a member's own phone (normal session) ---------- */
export const fetchBunkerPin = () => api('/api/bunker/pin').then(r => r.pin)
export const resetBunkerPin = () => api('/api/bunker/pin/reset', { method: 'POST', body: '{}' }).then(r => r.pin)
export const fetchBunkerAdminCode = () => api('/api/bunker/admin-code').then(r => r.code)

/* ---------- the shared kiosk screen (no cookie session) ---------- */
export const fetchBunkerBoard = () => fetch('/api/bunker/board').then(r => r.json()).then(r => r.sessions)
export const fetchBunkerSettings = () => fetch('/api/bunker/settings').then(r => r.json())
export const bunkerCheckin = pin =>
  fetch('/api/bunker/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) })
    .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'PIN incorrecto'); return d })
export const fetchBunkerSession = token =>
  fetch('/api/bunker/session', bearer(token)).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d })
export const postBunkerActive = (token, payload) =>
  fetch('/api/bunker/active', { ...bearer(token), method: 'POST', body: JSON.stringify(payload) }).then(r => r.json())
export const postBunkerRest = (token, sec) =>
  fetch('/api/bunker/rest', { ...bearer(token), method: 'POST', body: JSON.stringify({ sec }) }).then(r => r.json())
export const postBunkerFinish = (token, workout) =>
  fetch('/api/bunker/finish', { ...bearer(token), method: 'POST', body: JSON.stringify({ workout }) }).then(r => r.json())

/* ---------- room admin (a trainer's phone via normal session, or the kiosk overlay via its own admin token) ---------- */
export const bunkerAdminCheckin = code =>
  fetch('/api/bunker/admin-checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) })
    .then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'código incorrecto'); return d })
export const fetchBunkerAdminSessions = adminToken =>
  fetch('/api/bunker/admin/sessions', adminToken ? bearer(adminToken) : undefined).then(r => r.json()).then(r => r.sessions)
export const closeBunkerSession = (uid, adminToken) =>
  fetch('/api/bunker/admin/close', { ...(adminToken ? bearer(adminToken) : { headers: { 'Content-Type': 'application/json' } }), method: 'POST', body: JSON.stringify({ uid }) }).then(r => r.json())
export const saveBunkerSettings = (patch, adminToken) =>
  fetch('/api/bunker/admin/settings', { ...(adminToken ? bearer(adminToken) : { headers: { 'Content-Type': 'application/json' } }), method: 'POST', body: JSON.stringify(patch) }).then(r => r.json())
