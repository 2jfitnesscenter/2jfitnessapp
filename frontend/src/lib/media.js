// User-uploaded photos (routine/program covers, wherever else needs one later) — the one place
// this app stores a user-provided file. See api/server.js's saveUploadedImage/GET
// /api/social/media: DATA is a private volume nginx never sees, so uploads are served back
// through the api itself rather than through the static img/gif dirs exercise media uses.
import { api } from './api.js'

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
