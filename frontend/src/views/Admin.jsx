import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { t } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import AdminCoach from './AdminCoach.jsx'
import { EXDB, BODYPARTS, equipmentOf } from '../lib/exercises.js'
import { Thumb } from '../components/Media.jsx'
import { GOALS } from '../lib/starter.js'
import { MUSCLES, MUSCLE_LABEL } from '../lib/muscle-priority.js'

// Same labels the member-facing quick-plan sheet (sheets.jsx) uses, so "hypertrophy" means the
// same rep range whether a member or an admin set it up.
const GOAL_LABEL = { hypertrophy: 'Build muscle', toning: 'Tone up', fatloss: 'Lose fat', power: 'Power', plyometrics: 'Plyometrics', longevity: 'Health & longevity' }

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Uses the same t()/locale packs as the rest of the app — an owner running this in Spanish
// should see Spanish here too, not just on the member-facing screens.

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }
// Same computation as api/coach/payload.js's ageFrom — duplicated for the same reason payload.js
// duplicates other frontend logic: this admin page and the api server share no build step.
const ageFrom = birthDate => {
  if (!birthDate) return null
  const b = new Date(birthDate)
  if (Number.isNaN(b.getTime())) return null
  const now = new Date()
  let age = now.getFullYear() - b.getFullYear()
  if (now.getMonth() < b.getMonth() || (now.getMonth() === b.getMonth() && now.getDate() < b.getDate())) age--
  return age >= 0 && age < 130 ? age : null
}

function ProfileEditForm({ d, onSaved, close }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState(d.user.name)
  const [birthDate, setBirthDate] = useState(d.birthDate || '')
  const [body, setBody] = useState(d.body || 'male')
  const [height, setHeight] = useState(d.height ?? '')
  const [primary, setPrimary] = useState(d.priorityMuscles || [])
  const [secondary, setSecondary] = useState(d.secondaryMuscles || [])
  const [busy, setBusy] = useState(false)
  const togglePrimary = m => {
    setPrimary(v => v.includes(m) ? v.filter(x => x !== m) : v.length < 2 ? [...v, m] : v)
    setSecondary(v => v.filter(x => x !== m))
  }
  const toggleSecondary = m => {
    setSecondary(v => v.includes(m) ? v.filter(x => x !== m) : v.length < 3 ? [...v, m] : v)
    setPrimary(v => v.filter(x => x !== m))
  }
  const save = () => {
    const n = name.trim()
    if (!n) { toast(t('Name required')); return }
    setBusy(true)
    api('/api/admin/user/profile', {
      method: 'POST',
      body: JSON.stringify({
        id: d.user.id, name: n, birthDate: birthDate || null, body, height: height === '' ? null : Number(height),
        priorityMuscles: primary, secondaryMuscles: secondary
      })
    }).then(() => { toast(t('Profile saved')); onSaved(); close() }).catch(e => { toast(e.message); setBusy(false) })
  }
  return <>
    <h3>{t('Edit profile — {0}', d.user.name)}</h3>
    <div className="dim small" style={{ margin: '6px 0 4px' }}>{t('Name')}</div>
    <input className="input" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Date of birth')}</div>
    <input type="date" className="input" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setBirthDate(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Sex')}</div>
    <Segmented options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} value={body} onChange={setBody} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Height (cm)')}</div>
    <input type="number" inputMode="decimal" className="input" min="0" max="250" value={height} onChange={e => setHeight(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('What do you want to prioritize? (up to 2)')}</div>
    <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
      {MUSCLES.map(m => <button key={m} className={'chip' + (primary.includes(m) ? ' on' : '')} onClick={() => togglePrimary(m)}>{t(MUSCLE_LABEL[m])}</button>)}
    </div>
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Anything else? (up to 3)')}</div>
    <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
      {MUSCLES.map(m => <button key={m} className={'chip' + (secondary.includes(m) ? ' on' : '')} disabled={primary.includes(m)}
        style={primary.includes(m) ? { opacity: .35 } : undefined} onClick={() => toggleSecondary(m)}>{t(MUSCLE_LABEL[m])}</button>)}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy} onClick={save}>{t('Save')}</Button>
  </>
}

function StarterPlanSheet({ u, onApplied, close }) {
  const toast = useUI(s => s.toast)
  const [goal, setGoal] = useState('longevity')
  const [days, setDays] = useState(3)
  const [busy, setBusy] = useState(false)
  const apply = () => {
    setBusy(true)
    api('/api/admin/user/apply-starter-plan', { method: 'POST', body: JSON.stringify({ id: u.id, goal, days }) })
      .then(() => { toast(t('Starter plan added')); onApplied(); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }
  return <>
    <h3>{t('Load the PPL starter plan for {0}?', u.name)}</h3>
    <div className="muted small" style={{ margin: '6px 0 10px' }}>{t('Adds Push/Pull/Legs routines on top of whatever they already have.')}</div>
    <div className="dim small" style={{ marginBottom: 6 }}>{t('What are you training for?')}</div>
    <div className="sect-b">
      {GOALS.map(g => <button key={g} className="lrow tap" onClick={() => setGoal(g)}>
        <span className="lrow-m"><span className="lrow-t">{t(GOAL_LABEL[g])}</span></span>
        {goal === g && <Icon name="check" className="lrow-k" />}
      </button>)}
    </div>
    <div className="dim small" style={{ margin: '14px 0 6px' }}>{t('How many days a week?')}</div>
    <Segmented options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={days} onChange={setDays} />
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="sparkles" disabled={busy} onClick={apply}>{t('Load plan')}</Button>
  </>
}

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('User disabled') : t('User enabled')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const applyStarterPlan = () => openSheet(close2 => <StarterPlanSheet u={u} onApplied={load} close={close2} />)
  const age = ageFrom(d.birthDate)
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">{t('admin')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      {u.invitedBy && <span className="tag">{t('invite {0}', u.invitedBy)}</span>}
      <span className="tag">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '—')}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Age')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{age ?? '—'}</div></div>
      <div className="tile"><div className="l">{t('Sex')}</div><div className="v capitalize" style={{ fontSize: '1.1rem' }}>{t(d.body === 'female' ? 'Female' : 'Male')}</div></div>
      <div className="tile"><div className="l">{t('Height')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.height ? d.height + ' cm' : '—'}</div></div>
      <div className="tile"><div className="l">{t('Weight')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.latestWeight ? fmtNum(d.latestWeight.w) + ' ' + d.unit : '—'}</div></div>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!!(d.priorityMuscles?.length || d.secondaryMuscles?.length) && <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 0' }}>
      {(d.priorityMuscles || []).map(m => <span key={m} className="tag acc">{t(MUSCLE_LABEL[m])}</span>)}
      {(d.secondaryMuscles || []).map(m => <span key={m} className="tag">{t(MUSCLE_LABEL[m])}</span>)}
    </div>}
    <div className="row" style={{ gap: 8, margin: '12px 0 4px' }}>
      <Button style={{ flex: 1 }} icon="pencil" onClick={() => openSheet(close2 => <ProfileEditForm d={d} onSaved={load} close={close2} />)}>{t('Edit profile')}</Button>
      {!d.routines.length && <Button style={{ flex: 1 }} icon="sparkles" onClick={applyStarterPlan}>{t('Load PPL plan')}</Button>}
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '4px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {t('{0} sets', setsDone(w))}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(t('Code {0} created & copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast(t('Code revoked')); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Invite codes')}</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{t('Generate')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('{0} unused · {1} redeemed', open.length, used.length)}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(t('Copied {0}', i.code)) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label={t('revoke')}><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || t('used')}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">{t('No codes yet — generate one to invite someone.')}</div>}
  </div>
}

/* ============================ exercise blacklist ============================ */
// Gym-wide: equipment this location doesn't have, or movements the owner would rather not
// offer, hidden from every member's search/picker everywhere in the app. Not a deletion — the
// 1324-exercise catalogue itself never changes, and a hidden id still resolves fine for
// anyone who already has it logged or in a routine (see lib/exercises.js).
function ExerciseLibrarySheet({ initialHidden, close }) {
  const toast = useUI(s => s.toast)
  const [hidden, setHidden] = useState(initialHidden)   // owns its own copy so toggles repaint immediately
  const [q, setQ] = useState('')
  const [bp, setBp] = useState('')
  const [shown, setShown] = useState(60)
  const ql = q.toLowerCase().trim()
  const base = EXDB.filter(e => (!bp || e.bp === bp) && (!ql || e.n.toLowerCase().includes(ql)))
  const toggle = (id, hide) => {
    const next = new Set(hidden); hide ? next.add(id) : next.delete(id); setHidden(next)   // optimistic
    api('/api/admin/exercises/hidden', { method: 'POST', body: JSON.stringify({ id, hidden: hide }) })
      .catch(e => { toast(e.message); setHidden(hidden) })   // roll back on failure
  }
  return <>
    <h3>{t('Exercise library')}</h3>
    <div className="dim small" style={{ marginBottom: 10 }}>{t('{0} of {1} hidden from members. Hiding one doesn’t delete it — anyone who already has it stays unaffected.', hidden.size, EXDB.length)}</div>
    <div className="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', EXDB.length)} value={q} onChange={e => { setQ(e.target.value); setShown(60) }} />
    </div>
    <div className="chips" style={{ margin: '10px 0' }}>
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(60) }}>{t('All')}</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(60) }} style={{ textTransform: 'capitalize' }}>{t(b)}</button>)}
    </div>
    <div className="list">
      {base.slice(0, shown).map(e => {
        const isHidden = hidden.has(e.id)
        return <div key={e.id} className="item" onClick={() => toggle(e.id, !isHidden)} style={isHidden ? { opacity: .5 } : null}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt capitalize">{e.n}</div><div className="ss capitalize">{t(e.bp)} · {t(e.eq)}</div></div>
          <span className={'tag' + (isHidden ? '' : ' acc')}>{isHidden ? t('Hidden') : t('Visible')}</span>
        </div>
      })}
    </div>
    {base.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 60)}>{t('Show more')}</Button></>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => close(hidden)}>{t('Done')}</Button>
  </>
}

function ExerciseLibraryCard() {
  const openSheet = useUI(s => s.openSheet)
  const [hidden, setHidden] = useState(null)   // Set of ids, once loaded
  useEffect(() => { api('/api/admin/exercises/hidden').then(d => setHidden(new Set(d.hidden))).catch(() => setHidden(new Set())) }, [])
  if (hidden === null) return null
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>{t('Exercise library')}</h2>
      <Button size="sm" onClick={() => openSheet(closeFn => <ExerciseLibrarySheet initialHidden={hidden} close={h => { setHidden(h); closeFn() }} />)}>{t('Manage')}</Button></div>
    <div className="small muted" style={{ marginTop: 6 }}>{hidden.size
      ? t('{0} of {1} hidden from members.', hidden.size, EXDB.length)
      : t('{0} of {1} hidden from members — full catalogue is visible.', hidden.size, EXDB.length)}</div>
  </div>
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')   // all | active | inactive | disabled

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || t('Failed to load')))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  // poll every 15s so the "training now" section stays live without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length
  const ql = q.toLowerCase().trim()
  const shown = (users || []).filter(u => {
    if (ql && !u.name.toLowerCase().includes(ql)) return false
    if (filter === 'active') return u.lastSync && Date.now() - u.lastSync < 7 * 86400000
    if (filter === 'inactive') return !u.disabled && (!u.lastSync || Date.now() - u.lastSync >= 7 * 86400000)
    if (filter === 'disabled') return u.disabled
    return true
  })
  const FILTERS = [['all', t('All')], ['active', t('Active 7d')], ['inactive', t('Inactive')], ['disabled', t('Disabled')]]

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin')}</h1>
        <div className="sub">{users ? t('{0} users · {1} active this week', users.length, activeCount) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites() }} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{t('{0} · ex {1}/{2} · {3}/{4} sets', u.live.name, u.live.exIdx, u.live.exTotal, u.live.setsDone, u.live.setsTotal)}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <AdminCoach />

    <ExerciseLibraryCard />

    <InvitesCard invites={invites} reload={loadInvites} />

    <h4 className="sec">{t('Users')}</h4>
    <div className="search" style={{ marginBottom: 10 }}>
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} users…', users ? users.length : '')} value={q} onChange={e => setQ(e.target.value)} />
    </div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {FILTERS.map(([v, label]) =>
        <button key={v} className={'chip' + (filter === v ? ' on' : '')} onClick={() => setFilter(v)}>{label}</button>)}
    </div>
    <div className="list">
      {shown.map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>{t('admin')}</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>{t('off')}</span>}</div>
          <div className="ss">{u.live ? t('training now · {0}', u.live.name) : t('{0} workouts', u.workouts) + (u.lastWorkout ? ' · ' + t('last {0}', fmtDate(u.lastWorkout)) : '') + ' · ' + t('synced {0}', rel(u.lastSync))}</div></div>
        {u.hasPush && <Icon name="bell" title={t('push enabled')} style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !users.length && <div className="empty">{t('No users yet.')}</div>}
      {users && users.length > 0 && !shown.length && <div className="empty">{t('No users match.')}</div>}
    </div>
  </div>
}
