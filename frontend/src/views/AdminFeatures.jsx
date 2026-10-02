// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { FEATURE_GROUPS, allowedByAdmin } from '../lib/features.js'
import { Switch } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import './experience.css'

// "App features": the admin decides WHICH modules exist for the gym. A module switched off disappears for every member
// (and from their own Settings); one left on can still be hidden by each member. Nothing is deleted either way.
export default function AdminFeatures() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const loadFeatures = useStore(s => s.loadFeatures)
  useStore(s => s.features)
  const toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(null)
  if (!user?.admin) return null

  const toggle = async (key, on) => {
    setBusy(key)
    try { await api('/api/admin/features', { method: 'POST', body: JSON.stringify({ features: { [key]: on } }) }); await loadFeatures() }
    catch (e) { toast(e.message || t('Failed to load')) } finally { setBusy(null) }
  }
  return <main className="narrow">
    <header className="hdr"><button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div><h1>{t('App features')}</h1><div className="sub">{t('Switch off what your gym does not use. Members can still hide the rest for themselves.')}</div></div></header>
    {FEATURE_GROUPS.map(g => <section key={g.title}>
      <h4 className="sec">{t(g.title)}</h4>
      <div className="ux-list">{g.keys.map(f => { const on = allowedByAdmin(f.key); return <div key={f.key} className={'ux-card' + (on ? ' on' : '')}>
        <span className="ux-ico"><Icon name={f.icon} /></span>
        <div className="ux-txt"><div className="ux-t">{t(f.label)}</div><div className="ux-s">{t(f.sub)}</div></div>
        <Switch checked={on} disabled={busy === f.key} onChange={v => toggle(f.key, v)} />
      </div> })}</div>
    </section>)}
    <p className="ux-foot">{t('Changes reach every member the next time the app opens. Turning a feature off hides it; no data is deleted.')}</p>
  </main>
}
