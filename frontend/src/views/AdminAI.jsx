// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'
import AdminCoach from './AdminCoach.jsx'
import AdminTrainerAI from './AdminTrainerAI.jsx'
import AdminAuxAI from './AdminAuxAI.jsx'
import './experience.css'

/* Admin → Artificial intelligence: the three AI profiles 2J already has, in one place. Each block gives its name, what it is for
   and its current state; "Configure" opens that profile's own existing controls right here (AdminCoach / AdminTrainerAI /
   AdminAuxAI — nothing is reimplemented or duplicated, and the three stay isolated from each other: own credential, own log). */

const BLOCKS = [
  { id: 'coach', icon: 'sparkles', title: 'AI Coach', url: '/api/admin/coach', Panel: AdminCoach,
    blurb: 'The coach members talk to: it builds and adjusts their plan from what they log, and always asks before changing anything.' },
  { id: 'trainer', icon: 'dumbbell', title: 'Trainer panel AI', url: '/api/admin/trainer-ai', Panel: AdminTrainerAI,
    blurb: 'Helps trainers and admins draft routines and programs with “Generate with AI” in the trainer panel.' },
  { id: 'aux', icon: 'gear', title: 'Auxiliary AI', url: '/api/admin/aux-ai', Panel: AdminAuxAI,
    blurb: 'Quiet background tasks: matching imported exercises and reading machine, body-scan and routine photos.' },
]

// One honest state per profile: off · needs a credential · needs attention (its last job failed) · working.
export function aiStatus(d) {
  if (!d) return { key: 'loading', label: 'Loading…', tint: 'var(--label-2)' }
  if (d.disabledByEnv) return { key: 'env', label: 'Disabled by the server environment', tint: 'var(--label-2)' }
  if (!d.enabled) return { key: 'off', label: 'Switched off', tint: 'var(--label-2)' }
  const ok = d.auth?.state === 'connected' || d.auth?.state === 'not-required'
  if (!ok) return { key: 'nocred', label: d.auth?.state === 'expired' ? 'Credential expired — connect again' : 'On, but no credential connected', tint: 'var(--red)' }
  if (d.lastError && (!d.lastSuccess || d.lastError.at > d.lastSuccess.at)) return { key: 'attention', label: 'On — the last job failed', tint: 'var(--orange)' }
  return { key: 'on', label: 'On and connected', tint: 'var(--green)' }
}

function Block({ b, d, open, onToggle }) {
  const st = aiStatus(d)
  const { Panel } = b
  return <section className={'ai-block' + (open ? ' open' : '')} data-ai={b.id} data-status={st.key}>
    <div className="ai-head">
      <span className="ux-ico"><Icon name={b.icon} /></span>
      <div className="ux-txt"><div className="ux-t">{t(b.title)}</div>
        <div className="ux-s">{t(b.blurb)}</div></div>
    </div>
    <div className="ai-state"><span className="ai-dot" style={{ background: st.tint }} /><span style={{ color: st.tint }}>{t(st.label)}</span>
      {d && d.jobsToday != null && <span className="dim small"> · {(d.jobsToday === 1 ? t('1 job today') : t('{0} jobs today', d.jobsToday))}</span>}</div>
    {d?.lastError && st.key !== 'on' && <div className="small ai-err" style={{ color: st.tint }}>{d.lastError.errorClass}{d.lastError.detail ? ' — ' + String(d.lastError.detail).slice(0, 160) : ''}</div>}
    <Button size="sm" variant={open ? 'tinted' : 'plain'} trailingIcon={open ? 'chevronUp' : 'chevronDown'} onClick={onToggle}>{open ? t('Hide controls') : t('Configure')}</Button>
    {open && <div className="ai-panel"><Panel /></div>}
  </section>
}

export default function AdminAI() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [data, setData] = useState({})
  const [openId, setOpenId] = useState(null)
  const load = () => BLOCKS.forEach(b => api(b.url).then(d => setData(p => ({ ...p, [b.id]: d }))).catch(e => toast(e.message || t('Failed to load'))))
  useEffect(() => { if (user?.admin) load() }, [])
  if (!user?.admin) return null
  return <main className="narrow">
    <header className="hdr"><button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div><h1>{t('Artificial intelligence')}</h1><div className="sub">{t('The three AIs of 2J, each with its own credential and limits.')}</div></div></header>
    {BLOCKS.map(b => <Block key={b.id} b={b} d={data[b.id]} open={openId === b.id}
      onToggle={() => { setOpenId(o => o === b.id ? null : b.id); if (openId === b.id) load() }} />)}
  </main>
}
