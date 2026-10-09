// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Settings → Security: the person's own passkeys, devices and recent security activity. One screen, one account: the server scopes every call
// to the signed-in person, asks for a fresh passkey confirmation (step-up) before adding or removing a passkey, and never removes the last one.
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button, Section, Row } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, dateLocale } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import { webauthnOK } from '../lib/api.js'
import { listPasskeys, addPasskey, renamePasskey, revokePasskey, fetchSecurityEvents, EVENT_LABEL } from '../lib/security-api.js'

export const when = iso => {
  const d = iso ? new Date(iso) : null
  return d && !Number.isNaN(+d) ? d.toLocaleString(dateLocale(), { dateStyle: 'medium', timeStyle: 'short' }) : null
}
const cancelled = e => e && (e.name === 'NotAllowedError' || e.name === 'AbortError')

export function PasskeyRow({ p, index, only, onChanged }) {
  const toast = useUI(s => s.toast)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(p.name || '')
  const [busy, setBusy] = useState(false)
  const label = p.name || t('Passkey {0}', index + 1)
  const details = [p.createdAt ? t('Added {0}', when(p.createdAt)) : t('Added before dates were recorded'),
    p.lastUsedAt ? t('Last used {0}', when(p.lastUsedAt)) : t('No sign-in recorded yet')].join(' · ')
  const save = async () => {
    setBusy(true)
    try { await renamePasskey(p.id, name); setEditing(false); await onChanged() } catch (e) { toast(e.message || t('Could not rename this passkey')) } finally { setBusy(false) }
  }
  const remove = () => confirmSheet({
    title: t('Remove this passkey?'), message: t('Whoever holds it will no longer be able to sign in with it. You will confirm with another passkey first.'),
    confirmText: t('Remove'), danger: true,
    onConfirm: async () => {
      try { await revokePasskey(p.id); toast(t('Passkey removed')); await onChanged() }
      catch (e) { if (!cancelled(e)) toast(e.data?.code === 'last_passkey' ? t('This is your only passkey — add another before removing it.') : e.message || t('Could not remove this passkey')) }
    },
  })
  return <div className="lrow sec-pk" data-passkey={p.id}>
    <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name="key" /></span>
    <span className="lrow-m">
      {editing
        ? <span className="row" style={{ gap: 6 }}>
          <input className="input" id={'pk-name-' + p.id} aria-label={t('Passkey name')} value={name} maxLength={40} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') save() }} />
          <Button variant="primary" size="sm" disabled={busy || !name.trim()} onClick={save}>{t('Save')}</Button>
        </span>
        : <span className="lrow-t">{label}{p.legacy && <i className="set-pill" title={t('Made before names and dates were recorded')}>{t('Earlier')}</i>}</span>}
      <span className="lrow-s">{details}</span>
    </span>
    {!editing && <span className="sec-acts">
      <button className="iconbtn" aria-label={t('Rename {0}', label)} onClick={() => { setName(p.name || ''); setEditing(true) }}><Icon name="pencil" /></button>
      <button className="iconbtn" aria-label={t('Remove {0}', label)} disabled={only} title={only ? t('This is your only passkey — add another before removing it.') : undefined} onClick={remove}><Icon name="trash" /></button>
    </span>}
  </div>
}

export function PasskeysSection() {
  const toast = useUI(s => s.toast)
  const [list, setList] = useState(null)
  const [max, setMax] = useState(10)
  const [busy, setBusy] = useState(false)
  const load = async () => { try { const r = await listPasskeys(); setList(r.passkeys || []); setMax(r.max || 10) } catch (e) { setList([]); toast(e.message || t('Could not load your passkeys')) } }
  useEffect(() => { load() }, [])
  const add = async () => {
    setBusy(true)
    try { await addPasskey(); toast(t('Passkey added')); await load() }
    catch (e) { if (!cancelled(e)) toast(e.data?.code === 'passkey_limit' ? t('You have reached the maximum number of passkeys.') : e.message || t('Could not add a passkey')) }
    finally { setBusy(false) }
  }
  return <Section title={t('Your passkeys')} footer={t('A passkey is how you sign in. Keep one on each device you use — and at least two, so losing a device never locks you out.')}>
    {list === null && <div className="card muted small">{t('Loading…')}</div>}
    {list && list.map((p, i) => <PasskeyRow key={p.id} p={p} index={i} only={list.length <= 1} onChanged={load} />)}
    {list && <div style={{ padding: '10px 14px' }}>
      <Button variant="primary" icon="plus" disabled={busy || list.length >= max || !webauthnOK()} onClick={add}>{busy ? t('Waiting for your device…') : t('Add a passkey')}</Button>
      {list.length >= max && <div className="muted small" style={{ marginTop: 6 }}>{t('You have reached the maximum number of passkeys.')}</div>}
    </div>}
  </Section>
}

export function ActivitySection() {
  const [events, setEvents] = useState(null)
  useEffect(() => { fetchSecurityEvents().then(setEvents).catch(() => setEvents([])) }, [])
  return <Section title={t('Recent security activity')} footer={t('Only what happened to your account: no passwords, keys or locations are recorded.')}>
    {events === null && <div className="card muted small">{t('Loading…')}</div>}
    {events && !events.length && <div className="card muted small">{t('Nothing to show yet.')}</div>}
    {events && events.slice(0, 12).map(e => <Row key={e.id} icon="shield" title={t(EVENT_LABEL[e.event] || e.event)}
      subtitle={[when(e.at), e.byOther ? t('by staff') : null, e.meta?.platform, e.event === 'login_ok' && e.meta?.uv === false ? t('without device verification') : null].filter(Boolean).join(' · ')} />)}
  </Section>
}

export default function SecuritySettings() {
  const nav = useNavigate(), user = useStore(s => s.user)
  if (!user) return <div className="narrow"><div className="card">{t('Sign in to manage your security.')}</div></div>
  if (user.authLevel === 'pin') return <div className="narrow"><div className="card">{t('Passkeys and devices are managed after signing in with a passkey.')}</div></div>
  return <div className="narrow">
    <div className="hdr"><button className="back" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{t('Security')}</h1></div>
    <PasskeysSection />
    <ActivitySection />
  </div>
}
