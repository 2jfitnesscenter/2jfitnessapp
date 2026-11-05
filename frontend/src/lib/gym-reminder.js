// Gym arrival reminder (opt-in, OFF by default).
//
// Privacy rules this module keeps:
// - The gym location lives only in this browser's localStorage under a device-local key. It is
//   not member state (S), so it is never sent with the sync payload or to any API.
// - Coordinates are read from the browser only when the app is open and visible, at most once
//   every MIN_CHECK_MS, and only while the feature is on. Nothing here calls fetch or the API.
// - Nothing returned from the check contains coordinates, and nothing is logged.
// - The browser cannot watch location in the background, so this only fires when 2J is opened.

export const GYM_REMINDER_KEY = '2j:gym-reminder:v1'
export const GYM_RADIUS_M = 150
export const MIN_CHECK_MS = 30 * 60 * 1000
const EARTH_M = 6371000

const DEFAULTS = Object.freeze({ on: false, lat: null, lng: null, radius: GYM_RADIUS_M, lastCheckAt: 0, nudgedDay: null })

// Parses the stored settings. Anything malformed falls back to "off", never to a guess.
export function readGymReminder(storage) {
  try {
    const raw = storage?.getItem(GYM_REMINDER_KEY)
    if (!raw) return { ...DEFAULTS }
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || v.on !== true) return { ...DEFAULTS }
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return { ...DEFAULTS }
    return {
      on: true,
      lat: v.lat,
      lng: v.lng,
      radius: Number.isFinite(v.radius) && v.radius > 0 ? v.radius : GYM_RADIUS_M,
      lastCheckAt: Number.isFinite(v.lastCheckAt) ? v.lastCheckAt : 0,
      nudgedDay: typeof v.nudgedDay === 'string' ? v.nudgedDay : null,
    }
  } catch { return { ...DEFAULTS } }
}

export function writeGymReminder(storage, settings) {
  try { storage?.setItem(GYM_REMINDER_KEY, JSON.stringify(settings)); return true } catch { return false }
}

// Turning the feature off removes the stored location from this device.
export function clearGymReminder(storage) {
  try { storage?.removeItem(GYM_REMINDER_KEY) } catch { /* private mode */ }
}

// Great-circle distance in metres.
export function distanceMeters(a, b) {
  const rad = d => d * Math.PI / 180
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function isNearGym(position, settings) {
  if (!position || !settings?.on) return false
  return distanceMeters(position, settings) <= settings.radius
}

// Resolves the browser position as { lat, lng } only. Rejects with the browser error code
// (1 = permission denied, 2 = unavailable, 3 = timeout), or 0 when geolocation is missing.
export function getBrowserPosition() {
  return new Promise((resolve, reject) => {
    const geo = typeof navigator !== 'undefined' ? navigator.geolocation : null
    if (!geo?.getCurrentPosition) { reject({ code: 0 }); return }
    geo.getCurrentPosition(
      p => resolve({ lat: p.coords.latitude, lng: p.coords.longitude }),
      err => reject({ code: err?.code || 2 }),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 10 * 60 * 1000 }
    )
  })
}

/*
 * One check, called when the app becomes visible. Returns a status word only.
 * - 'off' / 'throttled' / 'in_workout' / 'already': no browser location is requested.
 * - 'nudge': the user is at the gym and gets the message once that day.
 * - 'far', 'no_permission', 'unavailable': nothing is shown and nothing is stored.
 */
export async function checkGymReminder({ storage, now = Date.now(), today, inWorkout = false, getPosition = getBrowserPosition, notify }) {
  const settings = readGymReminder(storage)
  if (!settings.on) return 'off'
  if (inWorkout) return 'in_workout'
  if (settings.nudgedDay === today) return 'already'
  if (now - settings.lastCheckAt < MIN_CHECK_MS) return 'throttled'
  // Record the attempt before asking, so a denied or slow request is not retried in a loop.
  writeGymReminder(storage, { ...settings, lastCheckAt: now })
  let position
  try { position = await getPosition() }
  catch (e) { return e?.code === 1 ? 'no_permission' : 'unavailable' }
  if (!isNearGym(position, settings)) return 'far'
  writeGymReminder(storage, { ...settings, lastCheckAt: now, nudgedDay: today })
  try { notify?.() } catch { /* a notice failure must not break the app */ }
  return 'nudge'
}
