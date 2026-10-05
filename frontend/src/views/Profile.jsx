// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo, useRef, useState } from 'react'
import { rankSnapshot } from '../lib/mi2j.js'
import { Carnet } from './Mi2J.jsx'
import { useNavigate } from 'react-router-dom'
import { useStore, hasData } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { streakWeeks } from '../lib/history.js'
import { fmtDate, todayISO } from '../lib/format.js'
import { webauthnOK, passkeyLogin, passkeyRegister } from '../lib/api.js'
import { updateUsername, updateAvatar } from '../lib/friends-api.js'
import { resizeImageFile, mediaUrl } from '../lib/media.js'
import { globalRank, TIER_COLOR, rankLabel, rankEmblemUrl } from '../lib/rank.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE } from '../lib/mobile.js'
import { MUSCLE_LABEL } from '../lib/muscle-priority.js'
import { t } from '../lib/i18n.js'
import './experience.css'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button, TextField, Avatar } from '../components/ui.jsx'
import { uxOn } from '../lib/features.js'
import StaffBadge from '../components/StaffBadge.jsx'
import { bunkerPinSheet } from '../sheets.jsx'
import { fetchBunkerLaunchLink } from '../lib/bunker-api.js'

// A quiet "more" group: the secondary parts of the profile stay one tap away instead of making a long form.
function Disclosure({ icon, title, sub, children }) {
  const [open, setOpen] = useState(false)
  return <div className="disc">
    <button type="button" className="disc-h" aria-expanded={open} onClick={() => setOpen(o => !o)}>
      <span className="lrow-i" style={{ '--tint': 'var(--acc)' }}><Icon name={icon} /></span>
      <span className="grow"><span className="ttl">{title}</span>{sub && <span className="muted small">{sub}</span>}</span>
      <Icon name={open ? 'chevronUp' : 'chevronDown'} className="chev" />
    </button>
    {open && <div className="disc-b">{children}</div>}
  </div>
}

export default function Profile() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const { update, setUser, pullState, pushState } = useStore()
  const toast = useUI(s => s.toast)
  const chatUnread = useUI(s => s.chatUnread)
  const friendUnread = useUI(s => s.friendUnread)
  const avatarInput = useRef(null)
  const [avatarBusy, setAvatarBusy] = useState(false)
  useStore(s => s.features)   // the admin's switches arrive after the first render
  const snap = useMemo(() => rankSnapshot(S), [S.workouts, S.bodyweight, S.tests, S.body])

  const signInHere = async () => {
    try { const u = await passkeyLogin(); setUser(u); await pullState(); toast(t('Welcome back, {0}', u.name)) }
    catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Sign-in failed')) }
  }
  const registerHere = () => useUI.getState().openSheet(close => <RegisterInline close={close} setUser={setUser} pushState={pushState} pullState={pullState} toast={toast} />)
  const editUsername = () => useUI.getState().openSheet(close => (
    <EditUsername close={close} current={user?.username} onSaved={u => setUser({ ...user, username: u })} />
  ))
  // Guest mode has no account for a photo to attach to — the avatar lives on the server
  // user record (POST /api/me/avatar), same as the username, not in the per-device S state.
  const pickAvatar = () => { if (user && !avatarBusy) avatarInput.current?.click() }
  const onAvatarFile = async e => {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    setAvatarBusy(true)
    try {
      const dataUrl = await resizeImageFile(file)
      const avatar = await updateAvatar(dataUrl)
      setUser({ ...user, avatar })
    } catch (err) { toast(err.message || t('Could not read that file')) }
    finally { setAvatarBusy(false) }
  }

  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Profile')}</h1></div></div>

    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
      <button onClick={pickAvatar} aria-label={t('Change photo')} disabled={!user}
        style={{ position: 'relative', flex: 'none', border: 'none', background: 'none', padding: 0, borderRadius: '50%', opacity: avatarBusy ? .6 : 1 }}>
        <Avatar name={user?.name} size={56} image={user?.avatar ? mediaUrl(user.avatar) : null} />
        {user && <span style={{
          position: 'absolute', right: -2, bottom: -2, width: 20, height: 20, borderRadius: '50%',
          background: 'var(--acc)', color: 'var(--on-acc)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 11, border: '2px solid var(--surface)',
        }}><Icon name="pencil" /></span>}
      </button>
      {user && <input ref={avatarInput} type="file" accept="image/*" hidden onChange={onAvatarFile} />}
      <div style={{ minWidth: 0, flex: 1, overflow: 'hidden' }}>
        <div className="row capitalize" style={{ gap: 6, fontSize: 19, fontWeight: 600, letterSpacing: '-.012em', overflow: 'hidden' }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{user?.name || t('Guest')}</span>
          {user?.trainer && <StaffBadge size={16} />}
        </div>
        {user?.created && <div className="dim small">{t('joined {0}', fmtDate(user.created.slice(0, 10)))}</div>}
        {user?.username && <button className="dim small" style={{ marginTop: 2, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} onClick={editUsername}>@{user.username}</button>}
      </div>
    </div>

    {/* ---------- create/sign in — nothing to show once there's an account, or on the
         demo/mobile builds, which don't have passkey accounts at all ---------- */}
    {!MOBILE && !DEMO && !user && (
      <Section title={t('Account')}>
        {webauthnOK() ? <>
          <Row icon="sparkles" iconTint="var(--acc)" title={t('Create passkey profile')} subtitle={t('Keeps your data safe and separate per person.')} accessory="chevron" onClick={registerHere} />
          <Row icon="person" iconTint="var(--blue)" title={t('Sign in with passkey')} accessory="chevron" onClick={signInHere} />
        </> : (
          <Row icon="lock" iconTint="var(--grey)" title={t('Passkeys not supported in this browser.')} />
        )}
      </Section>
    )}
    {!user && !DEMO && !MOBILE && <p className="sect-f" style={{ marginTop: -18, marginBottom: 22 }}>{t('Guest mode — data lives only in this browser.')}</p>}

    {/* ---------- basic info — asked at registration, editable here, read by the AI Coach ---------- */}
    <Section title={t('About you')} footer={t('Sex uses the Body diagram choice in Settings. Starting weight is your first body-weight log — add or edit it from Stats.')}>
      <Row icon="calendar" iconTint="var(--pink)" title={t('Date of birth')}>
        <input type="date" className="timef" value={S.birthDate || ''} max={todayISO()}
          onChange={e => update(s => { s.birthDate = e.target.value || null })} />
      </Row>
      <Row icon="expand" iconTint="var(--mint)" title={t('Height')}>
        <input type="number" inputMode="decimal" className="timef" style={{ width: 56, textAlign: 'right' }} min="0" max="250"
          value={S.height ?? ''} onChange={e => update(s => { const n = Math.round(Number(e.target.value)); s.height = n > 0 ? n : null })} />
        <span className="muted small" style={{ marginLeft: 6 }}>cm</span>
      </Row>
    </Section>

    {/* ---------- training priorities — the two pickers live on their own screen (views/TrainingPriorities.jsx) ---------- */}
    <Section>
      <Row icon="target" iconTint="var(--acc)" title={t('Training priorities')}
        subtitle={[...(S.priorityMuscles || []), ...(S.secondaryMuscles || [])].map(m => t(MUSCLE_LABEL[m])).join(', ') || t('Optional — choose which muscles get a little more work')}
        accessory="chevron" onClick={() => nav('/profile/priorities')} />
    </Section>

    {/* Mi 2J — the member's sporting identity; the full carnet, ranks, achievements and
        records live one tap away (views/Mi2J.jsx). */}
    <button className="mi2j-entry" onClick={() => nav('/mi2j')} aria-label={t('My 2J')}>
      <div className="mi2j-entry-h"><span>{t('My 2J')}</span><Icon name="chevronRight" /></div>
      <Carnet S={S} user={user} snap={snap} compact onRanks={() => nav('/rank')} />
    </button>

    {(uxOn(S, 'bioimpedance') || uxOn(S, 'health')) && <Disclosure icon="heart" title={t('Body & health')} sub={t('Measurements and daily activity')}>
      <Section>
      {uxOn(S, 'bioimpedance') && <Row icon="figureStrength" iconTint="var(--acc)" title={t('Measurements')} subtitle={t('Body composition & tape measurements over time')} accessory="chevron" onClick={() => nav('/measurements')} />}
      {uxOn(S, 'health') && <Row icon="heart" iconTint="var(--red)" title={t('Health')} subtitle={t('Steps, sleep and heart rate from Apple Health')} accessory="chevron" onClick={() => nav('/health')} />}
      </Section>
    </Disclosure>}

    {user && (uxOn(S, 'friends') || uxOn(S, 'chat') || user.trainer) && <Disclosure icon="users" title={t('Social & connections')} sub={t('Friends, chat and your gym')}>
    {/* ---------- friends + trainer chat — need a real (non-guest) account, same reasoning as
         the Account section right above needing one ---------- */}
    <Section>
        {uxOn(S, 'friends') && <Row icon="users" iconTint="var(--blue)" title={t('Friends')} accessory="chevron" onClick={() => nav('/friends')}>
          {friendUnread > 0 && <span aria-label={t('Pending friend requests')} style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--red)', flex: 'none' }} />}
        </Row>}
        {uxOn(S, 'chat') && <Row icon="personCircle" iconTint="var(--acc)" title={t('Chat with trainers')} accessory="chevron" onClick={() => nav('/chat')}>
          {chatUnread > 0 && <span aria-label={t('Unread messages')} style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--red)', flex: 'none' }} />}
        </Row>}
        <Row icon="key" iconTint="var(--orange)" title={t('Bunker check-in PIN')} subtitle={t('Train on the gym-floor screen without your phone')} accessory="chevron" onClick={bunkerPinSheet} />
    </Section>
    </Disclosure>}

    {/* ---------- staff-only quick access to the Bunker kiosk/admin — same admin||trainer gate
         Admin.jsx's own "Room admin" nav card and App.jsx's /admin/bunker route already use ---------- */}
    {(user?.admin || user?.trainer) && (
      <Section>
        <Row icon="dumbbell" iconTint="var(--indigo)" title={t('Trainer panel')} subtitle={t('Build and assign routines for your members — best used on a computer.')} accessory="chevron" onClick={() => nav('/trainer')} />
      </Section>
    )}
    {(user?.admin || user?.trainer) && (
      <Section title={t('Bunker station')}>
        <Row icon="link" iconTint="var(--acc)" title={t('Copy launch link')}
          subtitle={t('The URL to open on the gym-floor TV/tablet')}
          onClick={() => fetchBunkerLaunchLink()
            .then(key => navigator.clipboard?.writeText(`${location.origin}/#/bunker/launch?token=${key}`))
            .then(() => toast(t('Launch link copied')))
            .catch(e => toast(e.message))} />
        <Row icon="gear" iconTint="var(--indigo)" title={t('Room remote control')} subtitle={t('Manage sessions and room settings from here')}
          accessory="chevron" onClick={() => nav('/admin/bunker')} />
      </Section>
    )}

    <div style={{ height: 20 }} />
  </div>
}

function RegisterInline({ close, setUser, pushState, pullState, toast }) {
  const nameRef = useRef(null)
  const go = async () => {
    const n = (nameRef.current.value || '').trim()
    if (!n) { toast(t('Enter a name')); return }
    try {
      const u = await passkeyRegister(n); setUser(u); close()
      if (hasData(useStore.getState().S)) { await pushState(); toast(t('Profile created — data moved into it')) }
      else { await pullState(); toast(t('Welcome, {0}', u.name)) }
    } catch (e) { if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message || t('Registration failed')) }
  }
  return <>
    <h3>{t('Create your profile')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('Pick a name, then confirm with your device.')}</div>
    <TextField ref={nameRef} placeholder={t('Your name')} maxLength={40} />
    <div style={{ height: 12 }} /><Button variant="primary" onClick={go}>{t('Create passkey')}</Button>
  </>
}

// Auto-generated at registration (slugified name + a numeric suffix on collision) — this is
// just letting someone pick a nicer one, for the "Nombre de usuario" friend-add flow.
function EditUsername({ close, current, onSaved }) {
  const toast = useUI(s => s.toast)
  const [value, setValue] = useState(current || '')
  const [busy, setBusy] = useState(false)
  const save = () => {
    const u = value.trim().toLowerCase()
    if (!/^[a-z0-9_]{3,20}$/.test(u)) { toast(t('Use 3–20 lowercase letters, numbers or underscores')); return }
    setBusy(true)
    updateUsername(u).then(({ username }) => { onSaved(username); close(); toast(t('Username updated')) })
      .catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  return <>
    <h3>{t('Username')}</h3>
    <div className="muted small" style={{ marginBottom: 14 }}>{t('This is how friends can find and add you.')}</div>
    <TextField value={value} onChange={e => setValue(e.target.value)} maxLength={20} autoCapitalize="none" placeholder={t('Username')} />
    <div style={{ height: 12 }} /><Button variant="primary" disabled={busy} onClick={save}>{t('Save')}</Button>
  </>
}
