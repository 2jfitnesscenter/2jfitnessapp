// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// User-uploaded photos (routine/program covers, wherever else needs one later) — the one place
// this app stores a user-provided file. See api/server.js's saveUploadedImage/GET
// /api/social/media: DATA is a private volume nginx never sees, so uploads are served back
// through the api itself rather than through the static img/gif dirs exercise media uses.
import { api } from './api.js'
import { t } from './i18n.js'

// Downsizes a chosen photo onto an offscreen canvas (long edge capped at 960px) and hands back
// a JPEG data URL — keeps an upload small without a bigger request-body cap or any server-side
// image library.
export function resizeImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('could not read that file'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('could not read that image'))
      img.onload = () => {
        const MAX = 960
        const scale = Math.min(1, MAX / Math.max(img.width, img.height))
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.75))
      }
      img.src = reader.result
    }
    reader.readAsDataURL(file)
  })
}

// A JPEG data URL (from resizeImageFile, or fetched+re-encoded from an existing upload — see
// Social.jsx's PublishDetailsSheet) -> the stored filename.
export const uploadImage = dataUrl => api('/api/media/upload', { method: 'POST', body: JSON.stringify({ image: dataUrl }) }).then(r => r.id)

export const mediaUrl = id => id ? '/api/social/media?id=' + encodeURIComponent(id) : null

// The three AI scans are one tap for the person: the server retries, double-checks and, when the
// provider is busy, waits — all behind this one call. We start a short job and ask for it every
// couple of seconds; `consent.onPhase(phase)` lets the button say what is happening
// (reading | retrying | fallback | verifying). A failure reaching the person is final: the server
// has already spent its whole budget, so the message is plain and never mentions providers.
const SCAN_POLL_MS = 1800
const SCAN_GIVE_UP_MS = 4 * 60000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
async function runScanJob(kind, dataUrl, consent) {
  const { job } = await api('/api/scan/start', { method: 'POST', body: JSON.stringify({ kind, file: dataUrl, externalAiConsent: consent?.externalAiConsent }) })
  const started = Date.now()
  let lost = 0
  for (;;) {
    await sleep(SCAN_POLL_MS)
    let st
    try { st = await api('/api/scan/status?id=' + encodeURIComponent(job.id)); lost = 0 }
    catch (e) {
      if (e.status === 404 || e.status === 401) throw new Error(t('The scan was interrupted. Please try again.'))
      if (++lost >= 8) throw new Error(t('The connection dropped while reading. Please try again.'))   // a few network blips are ridden out
      continue
    }
    if (st.state === 'running') {
      consent?.onPhase?.(st.phase || 'reading', Date.now() - started)
      if (Date.now() - started > SCAN_GIVE_UP_MS) throw new Error(t('The scan is taking too long. Please try again in a few minutes.'))
      continue
    }
    if (st.state === 'done') return st
    throw new Error(st.error || t('The scan could not be completed. Please try again.'))
  }
}

// A bioimpedance report (photo or PDF, as a data URL) -> extracted {weight, bodyFat, muscleMass,
// waterPct, visceralFat, boneMass}, each a number or null. Read-only — this never saves anything
// itself, see components/ScanUpload.jsx.
export const scanMeasurements = (dataUrl, consent) =>
  runScanJob('measurements', dataUrl, consent).then(r => {
    // Fields the server could not confirm come back empty; `review` names them (not enumerable, so callers that only read values never see it).
    Object.defineProperty(r.values, 'review', { value: r.review || [], enumerable: false })
    return r.values
  })

// A printed/handwritten/photographed routine (photo or PDF, as a data URL) -> raw
// { name, days: [{ label, exercises: [...] }] } — exercise names exactly as printed, not yet
// matched to a library id. See lib/routine-scan.js's matchScannedRoutine() for that next step.
export const scanRoutine = (dataUrl, consent) =>
  runScanJob('routine', dataUrl, consent).then(r => r.routine)

// A photo of a single gym machine/exercise (as a data URL) -> raw { name, nameEn } — the
// exercise the AI thinks it recognises, not yet matched to a library id or checked against the
// gym-wide machine-alias table. See lib/machine-scan.js's matchScannedMachine() for that.
export const scanMachine = (dataUrl, consent) =>
  runScanJob('machine', dataUrl, consent).then(r => ({ name: r.name, nameEn: r.nameEn }))

// Gym-wide "this scanned machine already means this exercise" links (db.machineAliases on the
// server) — shared across every member, since it's the same physical equipment for all of
// them. `key` is lib/machine-scan.js's own normalised form of the recognised name.
export const fetchMachineAlias = key =>
  api('/api/exercises/alias?key=' + encodeURIComponent(key)).then(r => r.exId)
export const saveMachineAlias = (key, exId, name) =>
  api('/api/exercises/alias', { method: 'POST', body: JSON.stringify({ key, exId, name }) })

// Re-encodes an already-uploaded image as a fresh data URL — used when publishing a routine/
// program that already has its own cover set, so Social gets its own independent copy of the
// file rather than sharing one two different deletes could race on.
export const refetchAsDataUrl = id => fetch(mediaUrl(id))
  .then(r => r.blob())
  .then(blob => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('could not read the existing photo'))
    reader.onload = () => resolve(reader.result)
    reader.readAsDataURL(blob)
  }))
