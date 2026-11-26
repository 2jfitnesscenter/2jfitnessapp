// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9l · The server sends the member back to /settings#data (Settings → Data), but this app's router lives in the URL hash: rewrite it before the
// app starts, or the router would take '#data' for an unknown route and land on Home.
export function settingsDeepLink(loc) {
  return loc?.pathname === '/settings' && loc.hash === '#data' ? '/#/settings#data' : null
}

/** Brings Settings → Data into view. Two frames later: the shell scrolls every new page to the top first, and the sections above must be laid out. */
export function showDataSection(hash, doc = globalThis.document, frame = globalThis.requestAnimationFrame) {
  if (hash !== '#data') return
  frame(() => frame(() => doc.getElementById('data')?.scrollIntoView?.({ block: 'start' })))
}
