import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../components/Icon.jsx'
import { Button, Section } from '../components/ui.jsx'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { authorizeSharedDevice, listSharedDevices, revokeSharedDevice, resetStaffPin, setOwnStaffPin, api } from '../lib/api.js'
import { t } from '../lib/i18n.js'

function PinFields({ submit, busy, action }) {
  const [pin, setPin] = useState(''), [confirm, setConfirm] = useState('')
  return <>
    <input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder={t('6–8 digit PIN')} aria-label={t('6–8 digit PIN')} />
    <input className="input" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={confirm} onChange={e => setConfirm(e.target.value.replace(/\D/g, '').slice(0, 8))} placeholder={t('Confirm PIN')} aria-label={t('Confirm PIN')} />
    <Button variant="primary" disabled={busy || !/^\d{6,8}$/.test(pin) || pin !== confirm} onClick={() => submit(pin)}>{busy ? t('Checking…') : action}</Button>
  </>
}

export default function SharedStaffSettings() {
  const nav = useNavigate(), user = useStore(s => s.user), toast = useUI(s => s.toast)
  const [busy, setBusy] = useState(false), [devices, setDevices] = useState([]), [staff, setStaff] = useState([])
  const [targetId, setTargetId] = useState(''), [label, setLabel] = useState('')
  const refresh = async () => {
    if (!user?.admin) return
    try { const [{ devices }, roster] = await Promise.all([listSharedDevices(), api('/api/admin/users')]); setDevices(devices || []); setStaff((roster.users || []).filter(x => x.trainer || x.admin)) } catch { /* role guard remains authoritative */ }
  }
  useEffect(() => { refresh() }, [user?.id])
  const withBusy = async (work, success) => {
    setBusy(true)
    try { await work(); await refresh(); toast(t(success)) }
    catch (e) { toast(e.message || t('Could not complete this security action')) }
    finally { setBusy(false) }
  }
  const setOwnPin = pin => withBusy(async () => {
    const result = await setOwnStaffPin(pin)
    if (result.requiresRelogin) await useStore.getState().lockSharedSession()
  }, 'PIN saved. Existing shared sessions were signed out.')
  const authorize = () => withBusy(() => authorizeSharedDevice(label), 'This computer is now authorized for staff PIN access.')
  const resetPin = pin => withBusy(() => resetStaffPin(targetId, pin), 'PIN reset. Existing sessions were signed out.')
  const revoke = device => {
    if (!window.confirm(t('Revoke access for {0}?', device.label))) return
    withBusy(() => revokeSharedDevice(device.id), 'Shared device revoked.')
  }
  if (!user?.trainer) return <div className="narrow"><div className="card">{t('This page is only available to trainers and admins.')}</div></div>
  return <div className="narrow">
    <div className="hdr"><button className="back" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button><h1>{t('Shared staff access')}</h1></div>
    <Section footer={t('A PIN works only on a computer authorized by an admin. Passkey remains the recovery and security key.')}>
      <div className="card" style={{ display: 'grid', gap: 10 }}>
        <b>{t('Your trainer PIN')}</b>
        <div className="muted small">{t('Choose 6–8 digits. Simple sequences are not allowed. Confirm with your passkey to save or change it.')}</div>
        <PinFields submit={setOwnPin} busy={busy} action={t('Save PIN with passkey')} />
      </div>
    </Section>
    {user.admin && <>
      <h3 className="set-grp">{t('Shared computers')}<span>{t('Only an admin can authorize or revoke access')}</span></h3>
      <Section>
        <div className="card" style={{ display: 'grid', gap: 10 }}>
          <b>{t('Authorize this computer')}</b>
          <input className="input" value={label} maxLength={60} onChange={e => setLabel(e.target.value)} placeholder={t('Device name (optional)')} />
          <Button variant="primary" disabled={busy} onClick={authorize}>{t('Authorize with passkey')}</Button>
        </div>
        {(devices || []).map(device => <div className="card" key={device.id} style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
          <Icon name="lock" />
          <div style={{ flex: 1, minWidth: 0 }}><b>{device.label}</b><div className="muted small">{t('Authorized {0}', new Date(device.authorizedAt).toLocaleDateString())} · {device.active ? t('Active') : t('Revoked')}</div><div className="muted small">{device.lastUsedAt ? t('Last used {0}', new Date(device.lastUsedAt).toLocaleString()) : t('Not used yet')}</div></div>
          {device.active && <button type="button" className="danger small" disabled={busy} onClick={() => revoke(device)}>{t('Revoke')}</button>}
        </div>)}
      </Section>
      {!!staff.length && <>
        <h3 className="set-grp">{t('Reset a trainer PIN')}<span>{t('Passkey required; active sessions are revoked')}</span></h3>
        <Section><div className="card" style={{ display: 'grid', gap: 10 }}>
          <select className="input" value={targetId} onChange={e => setTargetId(e.target.value)} aria-label={t('Choose trainer')}>
            <option value="">{t('Choose trainer')}</option>
            {staff.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
          <PinFields submit={resetPin} busy={busy || !targetId} action={t('Reset PIN with passkey')} />
        </div></Section>
      </>}
    </>}
  </div>
}
