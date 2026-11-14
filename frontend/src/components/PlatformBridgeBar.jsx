// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// F9b · Discreet strip for members who arrive from 2J Home (H-72, H-79.1): "Back to Home" for an SSO session (it does not sign out of Búnker)
// and the "fee pending" notice. Renders nothing unless the server has the bridge on, so the app is unchanged for everyone else.
import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { BACK_TO_HOME, loadBridgeView } from '../lib/platform-notices.js'

export default function PlatformBridgeBar({ load = loadBridgeView }) {
  const [view, setView] = useState(null)
  useEffect(() => {
    let alive = true
    load().then(v => { if (alive) setView(v) })
    return () => { alive = false }
  }, [load])
  if (!view) return null
  return (
    <div className="narrow" role="region" aria-label={t('2J Home')} style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', padding: '8px 16px', fontSize: 14, color: 'var(--label-2)' }}>
      {view.notice ? <p role="status" style={{ margin: 0 }}>{t(view.notice)}</p> : <span />}
      {view.back ? <a className="btn ghost" href={view.back} rel="noreferrer">{t(BACK_TO_HOME)}</a> : null}
    </div>
  )
}
