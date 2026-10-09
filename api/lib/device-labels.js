// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* A coarse, human label for the device a passkey or a session was made on: "Android · Chrome", "iOS · Safari", "Windows · Edge".
 * It is read once from the User-Agent header and only these two words are kept — never the raw header, a version, a model or an IP —
 * so the label can tell a person which of their devices is which without becoming a fingerprint. */

export function platformOf(userAgent) {
  const ua = String(userAgent || '')
  const platform = /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Android/.test(ua) ? 'Android'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Windows/.test(ua) ? 'Windows'
    : /Macintosh|Mac OS X/.test(ua) ? 'macOS'
    : /Linux|X11/.test(ua) ? 'Linux'
    : 'Web'
  // Order matters: Edge and the Android/iOS wrappers carry "Chrome" or "Safari" too.
  const browser = /EdgA?\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /Firefox|FxiOS/.test(ua) ? 'Firefox'
    : /CriOS|Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : /Capacitor|; wv\)/.test(ua) ? 'App'
    : null
  return { platform, browser }
}

export const deviceLabel = userAgent => {
  const { platform, browser } = platformOf(userAgent)
  return browser ? `${platform} · ${browser}` : platform
}

/** Free text a person typed as a name: no markup or control characters, 1–40 characters, or null when nothing is left. */
export function cleanName(value, max = 40) {
  const s = String(value ?? '').replace(/[<>\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
  return s || null
}
