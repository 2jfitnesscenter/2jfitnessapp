// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9o · A strong action answered `passkey_required` with `staffStepUp: true` (a linked staff session of 2J Hub, closed list): instead of
// Búnker's own passkey, the person confirms it in 2J Hub Admin. The server fixes what is confirmed; this sheet only sends the same action
// and body it was about to send, then opens the address the server returns (2J Hub Admin). Nothing is decided here.
import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { STAFF_STEPUP_TEXT, STAFF_STEPUP_TITLE, startStaffStepUp } from '../lib/staff-stepup.js'

export function StaffStepUpSheet({ action, body, close }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  async function go() {
    setBusy(true); setError(null)
    try { window.location.assign(await startStaffStepUp(action, body)) }
    catch (e) { setError(e.message); setBusy(false) }
  }
  return (
    <div role="dialog" aria-label={t(STAFF_STEPUP_TITLE)} style={{ display: 'grid', gap: 12 }}>
      <h2 style={{ margin: 0 }}>{t(STAFF_STEPUP_TITLE)}</h2>
      <p style={{ margin: 0 }}>{t(STAFF_STEPUP_TEXT)}</p>
      {error ? <p role="alert" style={{ margin: 0 }}>{error}</p> : null}
      <button type="button" className="btn" onClick={go} disabled={busy}>{t(STAFF_STEPUP_TITLE)}</button>
      <button type="button" className="btn ghost" onClick={close} disabled={busy}>{t('Close')}</button>
    </div>
  )
}
