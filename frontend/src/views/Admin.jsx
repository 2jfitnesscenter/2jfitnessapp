import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented } from '../components/ui.jsx'
import AdminCoach from './AdminCoach.jsx'
import { EXDB, BODYPARTS, equipmentOf } from '../lib/exercises.js'
import { Thumb } from '../components/Media.jsx'

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Deliberately English-only — it isn't part of the translated end-user surface, so it stays
// out of the per-language string packs.

const rel = ts => {
  if (!ts) return 'never'
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  return Math.floor(s / 86400) + 'd ago'
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
  const [busy, setBusy] = useState(false)
  const save = () => {
    const n = name.trim()
    if (!n) { toast('Name required'); return }
    setBusy(true)
    api('/api/admin/user/profile', {
      method: 'POST',
      body: JSON.stringify({ id: d.user.id, name: n, birthDate: birthDate || null, body, height: height === '' ? null : Number(height) })
    }).then(() => { toast('Profile saved'); onSaved(); close() }).catch(e => { toast(e.message); setBusy(false) })
  }
  return <>
    <h3>Edit profile — {d.user.name}</h3>
    <div className="dim small" style={{ margin: '6px 0 4px' }}>Name</div>
    <input className="input" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>Date of birth</div>
    <input type="date" className="input" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setBirthDate(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>Sex</div>
    <Segmented options={[{ value: 'male', label: 'Male' }, { value: 'female', label: 'Female' }]} value={body} onChange={setBody} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>Height (cm)</div>
    <input type="number" inputMode="decimal" className="input" min="0" max="250" value={height} onChange={e => setHeight(e.target.value)} />
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy} onClick={save}>Save</Button>
  </>
}

function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="muted small">Loading…</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? 'User disabled' : 'User enabled'); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const applyStarterPlan = () => confirmSheet({
    title: 'Load the PPL starter plan for ' + u.name + '?',
    message: 'Adds Push/Pull/Legs routines (Mon/Wed/Fri) on top of whatever they already have.',
    confirmText: 'Load plan',
    onConfirm: () => api('/api/admin/user/apply-starter-plan', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(() => { toast('Starter plan added'); load() }).catch(e => toast(e.message))
  })
  const age = ageFrom(d.birthDate)
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">admin</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>disabled</span>}
      {u.invitedBy && <span className="tag">invite {u.invitedBy}</span>}
      <span className="tag">joined {u.created ? fmtDate(u.created.slice(0, 10)) : '—'}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">Age</div><div className="v" style={{ fontSize: '1.1rem' }}>{age ?? '—'}</div></div>
      <div className="tile"><div className="l">Sex</div><div className="v capitalize" style={{ fontSize: '1.1rem' }}>{d.body}</div></div>
      <div className="tile"><div className="l">Height</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.height ? d.height + ' cm' : '—'}</div></div>
      <div className="tile"><div className="l">Weight</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.latestWeight ? fmtNum(d.latestWeight.w) + ' ' + d.unit : '—'}</div></div>
      <div className="tile"><div className="l">Workouts</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">Weigh-ins</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">Routines</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">Last sync</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    <div className="row" style={{ gap: 8, margin: '12px 0 4px' }}>
      <Button style={{ flex: 1 }} icon="pencil" onClick={() => openSheet(close2 => <ProfileEditForm d={d} onSaved={load} close={close2} />)}>Edit profile</Button>
      {!d.routines.length && <Button style={{ flex: 1 }} icon="sparkles" onClick={applyStarterPlan}>Load PPL plan</Button>}
    </div>
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '4px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: 'Disable ' + u.name + '?', message: 'They are signed out everywhere and can no longer sync or log in until re-enabled.', confirmText: 'Disable', danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? 'Enable account' : 'Disable account'}</button>}
    <h4 className="sec">Workout history</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {setsDone(w)} sets{w.prs?.length ? ' · ' + w.prs.length + ' PR' : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">No workouts logged.</div>}
  </>
}

function InvitesCard({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast('Code ' + invite.code + ' created & copied'); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast('Code revoked'); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Invite codes</h2>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">Generate</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{open.length} unused · {used.length} redeemed</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast('Copied ' + i.code) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label="revoke"><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || 'used'}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">No codes yet — generate one to invite someone.</div>}
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
    <h3>Exercise library</h3>
    <div className="dim small" style={{ marginBottom: 10 }}>{hidden.size} of {EXDB.length} hidden from members. Hiding one doesn't delete it — anyone who already has it stays unaffected.</div>
    <div className="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={'Search ' + EXDB.length + ' exercises…'} value={q} onChange={e => { setQ(e.target.value); setShown(60) }} />
    </div>
    <div className="chips" style={{ margin: '10px 0' }}>
      <button className={'chip nocap' + (!bp ? ' on' : '')} onClick={() => { setBp(''); setShown(60) }}>All</button>
      {BODYPARTS.map(b => <button key={b} className={'chip' + (bp === b ? ' on' : '')} onClick={() => { setBp(b); setShown(60) }} style={{ textTransform: 'capitalize' }}>{b}</button>)}
    </div>
    <div className="list">
      {base.slice(0, shown).map(e => {
        const isHidden = hidden.has(e.id)
        return <div key={e.id} className="item" onClick={() => toggle(e.id, !isHidden)} style={isHidden ? { opacity: .5 } : null}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt capitalize">{e.n}</div><div className="ss capitalize">{e.bp} · {e.eq}</div></div>
          <span className={'tag' + (isHidden ? '' : ' acc')}>{isHidden ? 'Hidden' : 'Visible'}</span>
        </div>
      })}
    </div>
    {base.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 60)}>Show more</Button></>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => close(hidden)}>Done</Button>
  </>
}

function ExerciseLibraryCard() {
  const openSheet = useUI(s => s.openSheet)
  const [hidden, setHidden] = useState(null)   // Set of ids, once loaded
  useEffect(() => { api('/api/admin/exercises/hidden').then(d => setHidden(new Set(d.hidden))).catch(() => setHidden(new Set())) }, [])
  if (hidden === null) return null
  return <div className="card">
    <div className="row between"><h2 style={{ margin: 0 }}>Exercise library</h2>
      <Button size="sm" onClick={() => openSheet(closeFn => <ExerciseLibrarySheet initialHidden={hidden} close={h => { setHidden(h); closeFn() }} />)}>Manage</Button></div>
    <div className="small muted" style={{ marginTop: 6 }}>{hidden.size} of {EXDB.length} hidden from members{hidden.size ? '' : ' — full catalogue is visible'}.</div>
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

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || 'Failed to load'))
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

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label="Back"><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>Admin</h1>
        <div className="sub">{users ? users.length + ' users · ' + activeCount + ' active this week' : 'Loading…'}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites() }} aria-label="refresh">↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">Users</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">Training now</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">Active 7d</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">Disabled</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />Training now</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{u.live.name} · ex {u.live.exIdx}/{u.live.exTotal} · {u.live.setsDone}/{u.live.setsTotal} sets</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    <AdminCoach />

    <ExerciseLibraryCard />

    <InvitesCard invites={invites} reload={loadInvites} />

    <h4 className="sec">Users</h4>
    <div className="search" style={{ marginBottom: 10 }}>
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={'Search ' + (users ? users.length : '') + ' users…'} value={q} onChange={e => setQ(e.target.value)} />
    </div>
    <div className="chips" style={{ marginBottom: 10 }}>
      {[['all', 'All'], ['active', 'Active 7d'], ['inactive', 'Inactive'], ['disabled', 'Disabled']].map(([v, label]) =>
        <button key={v} className={'chip' + (filter === v ? ' on' : '')} onClick={() => setFilter(v)}>{label}</button>)}
    </div>
    <div className="list">
      {shown.map(u => <div key={u.id} className="item" onClick={() => openUser(u.id)} style={u.disabled ? { opacity: .55 } : null}>
        <div className="grow"><div className="tt">{u.live && <Icon name="dot" style={{ fontSize: 9, color: 'var(--green)', display: 'inline-block', marginRight: 5 }} />}{u.name} {u.admin && <span className="tag acc" style={{ marginLeft: 4 }}>admin</span>}{u.disabled && <span className="tag" style={{ marginLeft: 4, color: 'var(--red)' }}>off</span>}</div>
          <div className="ss">{u.live ? 'training now · ' + u.live.name : u.workouts + ' workouts' + (u.lastWorkout ? ' · last ' + fmtDate(u.lastWorkout) : '') + ' · synced ' + rel(u.lastSync)}</div></div>
        {u.hasPush && <Icon name="bell" title="push enabled" style={{ fontSize: 15, color: 'var(--label-3)' }} />}<Icon name="chevronRight" className="chev" />
      </div>)}
      {users && !users.length && <div className="empty">No users yet.</div>}
      {users && users.length > 0 && !shown.length && <div className="empty">No users match.</div>}
    </div>
  </div>
}
