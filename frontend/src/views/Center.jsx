import { Children, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { mediaUrl } from '../lib/media.js'
import { agoText, signalText } from '../lib/coach-followup.js'
import { TABS, STATUS_FILTERS, fetchCenterToday, fetchCenterMembers, fetchCenterTrainers, memberStatus, filterMembers, statusCounts, daysBetween } from '../lib/center.js'
import Icon from '../components/Icon.jsx'
import { Surface, Pill, ListSkeleton, EmptyState } from '../components/v2.jsx'
import { Avatar, Segmented, Button } from '../components/ui.jsx'
import { UserDetail } from './Admin.jsx'
import './center.css'

/* Gestión del centro V1 — Hoy · Miembros · Entrenadores. It only arranges what the app already knows: assignments, the Coach follow-up engine, the derived workout
   summary and the live presence (GET /api/center/*). Nothing is recomputed here and "active" never means "synced": activity is the last workout. */
const TAB_LABEL = { today: 'Today', members: 'Members', trainers: 'Trainers' }

function Person({ p, sub, onClick, trailing }) {
  const body = <><Avatar name={p.name} size={38} image={p.avatar ? mediaUrl(p.avatar) : null} />
    <span className="cm-who"><b className="capitalize">{p.name}</b>{sub && <small>{sub}</small>}</span>{trailing}</>
  return onClick ? <button type="button" className="cm-person" onClick={onClick}>{body}</button> : <div className="cm-person">{body}</div>
}

function Block({ icon, title, count, hint, children, empty }) {
  return <Surface as="section" className="cm-block" aria-label={t(title)}>
    <header><span className="cm-ico"><Icon name={icon} /></span><h3>{t(title)}</h3>{count != null && <Pill>{count}</Pill>}</header>
    {hint && <div className="cm-hint">{hint}</div>}
    {Children.toArray(children).length ? <div className="cm-list">{children}</div> : <p className="cm-empty">{t(empty || 'Nobody right now')}</p>}
  </Surface>
}

/* ------------------------------------------------------------------ Hoy */
export function TodayView({ d, days, onDays, openMember, goMembers }) {
  const a = d.activity
  const tiles = [['activeNow', 'Training now', 'dot'], ['trainedToday', 'Trained today', 'checkCircle'], ['trained7d', 'Trained in 7 days', 'calendar'], ['newMembers', 'New members', 'users'], ['neverTrained', 'Never trained', 'info']]
  return <>
    <div className="cm-tiles" aria-label={t('Recent activity')}>
      {tiles.map(([k, label, icon]) => <div key={k} className={'cm-tile' + (k === 'activeNow' && a[k] ? ' live' : '')}><Icon name={icon} /><b className="num">{a[k]}</b><span>{t(label)}</span></div>)}
    </div>
    <p className="cm-scope">{t(d.scope === 'all' ? '{0} members in the centre' : '{0} members assigned to you', d.members)} · {t('Activity is the last workout, not the last sync.')}</p>
    <div className="cm-grid">
      <Block icon="dot" title="Training now" count={d.activeNow.length} empty="Nobody is training right now">
        {d.activeNow.map(p => <Person key={p.id} p={p} sub={p.workout || t('Workout in progress')} onClick={() => openMember(p.id)} trailing={<Pill tone="acc">{t('Live')}</Pill>} />)}
      </Block>
      <Block icon="flag" title="Need attention" count={d.attention.count} hint={t('From the follow-up engine, with the reason.')} empty="Nobody needs attention">
        {d.attention.list.map(p => <Person key={p.id} p={p} onClick={() => openMember(p.id)} sub={p.signals[0] ? signalText(p.signals[0]) : p.unreadable ? t('Saved data could not be read.') : t('Review')}
          trailing={<span className="cm-when">{p.daysSince != null ? agoText(p.daysSince) : '—'}</span>} />)}
        {d.attention.count > d.attention.list.length && <button type="button" className="cm-more" onClick={() => goMembers('')}>{t('See all in Members')}</button>}
      </Block>
      <Block icon="calendar" title="Upcoming reviews" count={d.upcoming.count} empty="No reviews in the next 7 days">
        {d.upcoming.list.map(p => <Person key={p.id} p={p} onClick={() => openMember(p.id)} sub={p.nextReview ? fmtDate(p.nextReview) : ''} trailing={<span className="cm-when">{p.reviewIn === 0 ? t('Today') : p.reviewIn === 1 ? t('Tomorrow') : t('In {0} days', p.reviewIn)}</span>} />)}
      </Block>
      <Block icon="users" title="New members" count={d.newMembers.count} empty="No one joined recently">
        {d.newMembers.list.map(p => <Person key={p.id} p={p} onClick={() => openMember(p.id)} sub={t('Joined {0}', fmtDate(p.created))} trailing={<span className="cm-when">{p.workoutCount ? t('{0} workouts', p.workoutCount) : t('No workouts yet')}</span>} />)}
      </Block>
      <Block icon="timer" title="Not training" count={d.idle.count} empty="Everybody has trained recently"
        hint={<span className="cm-days"><span>{t('No workout for')}</span><Segmented className="seg-inline" value={days} onChange={onDays} options={[7, 14, 30].map(n => ({ value: n, label: t('{0} d', n) }))} /></span>}>
        {d.idle.list.map(p => <Person key={p.id} p={p} onClick={() => openMember(p.id)} sub={p.lastWorkoutAt ? t('Last workout {0}', fmtDate(p.lastWorkoutAt)) : t('No workouts yet')} trailing={<span className="cm-when">{p.daysSince != null ? agoText(p.daysSince) : '—'}</span>} />)}
        {d.idle.count > d.idle.list.length && <button type="button" className="cm-more" onClick={() => goMembers('idle')}>{t('See all in Members')}</button>}
      </Block>
    </div>
  </>
}

/* ------------------------------------------------------------------ Miembros */
const STATUS_LABEL = { all: 'All', training: 'Training now', idle: 'Not training', new: 'Joined recently', disabled: 'Disabled' }

function lastText(u, today) {
  if (u.assigned === false) return null
  if (u.activeNow) return u.live?.name ? t('Training now · {0}', u.live.name) : t('Training now')
  if (!u.lastWorkoutAt) return t('No workouts yet')
  const days = daysBetween(u.lastWorkoutAt, today)
  return t('Last workout {0}', agoText(days).toLowerCase())
}

export function MemberRow({ u, today, admin, onFollow, onProfile }) {
  const status = memberStatus(u, today)
  const trainers = (u.assignedTrainers || []).map(x => x.name).join(', ')
  const line = lastText(u, today)
  return <article className={'cm-member' + (status === 'disabled' ? ' off' : '') + (u.assigned === false ? ' other' : '')}>
    <Avatar name={u.name} size={42} image={u.avatar ? mediaUrl(u.avatar) : null} />
    <div className="cm-who">
      <b className="capitalize">{u.name}
        {u.role && u.role !== 'member' && <Pill>{t(u.role === 'admin' ? 'Admin' : 'Trainer')}</Pill>}
        {status === 'disabled' && <Pill>{t('Disabled')}</Pill>}
        {status === 'training' && <Pill tone="acc">{t('Live')}</Pill>}
        {status === 'new' && <Pill>{t('New member')}</Pill>}
      </b>
      {line && <small className={status === 'idle' || status === 'never' ? 'warn' : ''}>{line}</small>}
      <small>{trainers ? t('Trainer: {0}', trainers) : t('No trainer assigned')}</small>
    </div>
    {u.assigned === false ? <span className="cm-lock"><Icon name="lock" />{t('Not assigned to you')}</span>
      : <div className="cm-acts">
        <Button size="sm" variant="primary" icon="chartLine" onClick={() => onFollow(u.id)} aria-label={t('Follow-up of {0}', u.name)}>{t('Follow-up')}</Button>
        {admin && <Button size="sm" icon="person" onClick={() => onProfile(u.id)} aria-label={t('Profile of {0}', u.name)}>{t('Profile')}</Button>}
      </div>}
  </article>
}

export function MembersView({ data, today, admin, filters, setFilters, onFollow, onProfile }) {
  const { q, status, trainer, role, scope } = filters
  const list = data.users
  const counts = useMemo(() => statusCounts(list.filter(u => u.assigned !== false), today), [list, today])
  const shown = useMemo(() => filterMembers(list, { q, status, trainer, role, today }), [list, q, status, trainer, role, today])
  return <>
    <div className="cm-tools">
      <label className="search"><Icon name="search" /><input className="input" type="search" value={q} onChange={e => setFilters({ q: e.target.value })} aria-label={t('Search a member…')} placeholder={t('Search a member or a trainer…')} /></label>
      <div className="cm-selects">
        {!admin && <select className="input" aria-label={t('Which members')} value={scope} onChange={e => setFilters({ scope: e.target.value })}>
          <option value="assigned">{t('Assigned to me')}</option><option value="all">{t('Everybody')}</option></select>}
        {admin && <>
          <select className="input" aria-label={t('Trainer')} value={trainer} onChange={e => setFilters({ trainer: e.target.value })}>
            <option value="">{t('Any trainer')}</option><option value="none">{t('No trainer')}</option>{data.trainers.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
          <select className="input" aria-label={t('Role')} value={role} onChange={e => setFilters({ role: e.target.value })}>
            <option value="">{t('Any role')}</option><option value="member">{t('Members')}</option><option value="trainer">{t('Trainers')}</option><option value="admin">{t('Admins')}</option></select>
        </>}
      </div>
    </div>
    <div className="chips cm-chips">
      {STATUS_FILTERS.filter(k => k !== 'disabled' || admin || counts.disabled).map(k => <button key={k} className={'chip' + (status === k ? ' on' : '')} onClick={() => setFilters({ status: k })}>
        {t(STATUS_LABEL[k])}<em>{counts[k]}</em></button>)}
    </div>
    {shown.length ? <div className="cm-members">{shown.map(u => <MemberRow key={u.id} u={u} today={today} admin={admin} onFollow={onFollow} onProfile={onProfile} />)}</div>
      : <EmptyState icon="users" title={t(list.length ? 'No members match' : scope === 'assigned' && !admin ? 'No members assigned yet' : 'No members yet')}>
        {!admin && !list.length && scope === 'assigned' && <div className="muted small">{t('An administrator can assign members to you from their profile.')}</div>}</EmptyState>}
  </>
}

/* ------------------------------------------------------------------ Entrenadores */
export function TrainersView({ d, onOpen }) {
  const card = (p, key, who) => <Surface as="article" key={key} className="cm-trainer">
    <header>{who}</header>
    <dl>
      <div><dt>{t('Members')}</dt><dd className="num">{p.members}</dd></div>
      <div className={p.attention ? 'hot' : ''}><dt>{t('Need attention')}</dt><dd className="num">{p.attention}</dd></div>
      <div><dt>{t('Reviews soon')}</dt><dd className="num">{p.upcoming}</dd></div>
      <div><dt>{t('Trained in 7 days')}</dt><dd className="num">{p.trainedLast7d}</dd></div>
      <div><dt>{t('Training now')}</dt><dd className="num">{p.activeNow}</dd></div>
      <div><dt>{t('Last workout')}</dt><dd>{p.lastWorkoutAt ? fmtDate(p.lastWorkoutAt) : '—'}</dd></div>
    </dl>
    <Button size="sm" icon="users" onClick={() => onOpen(p.id)} disabled={!p.members}>{t('View members')}</Button>
  </Surface>
  return d.trainers.length || d.unassigned ? <div className="cm-trainers">
    {d.trainers.map(p => card(p, p.id, <><Avatar name={p.name} size={44} image={p.avatar ? mediaUrl(p.avatar) : null} /><div className="cm-who"><b className="capitalize">{p.name}</b>{p.role === 'admin' && <small>{t('Admin')}</small>}</div></>))}
    {d.unassigned && card(d.unassigned, 'none', <><span className="cm-ico"><Icon name="info" /></span><div className="cm-who"><b>{t('No trainer')}</b><small>{t('Members nobody looks after yet')}</small></div></>)}
  </div> : <EmptyState icon="users" title={t('No trainers yet')} />
}

/* ------------------------------------------------------------------ the screen */
export default function Center() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [params, setParams] = useSearchParams()
  const admin = !!user?.admin
  const tab = TABS.includes(params.get('tab')) ? params.get('tab') : 'today'
  const [days, setDays] = useState(7)
  const [today, setToday] = useState(null)
  const [members, setMembers] = useState(null)
  const [trainers, setTrainers] = useState(null)
  const [scope, setScope] = useState('assigned')
  const filters = { q: params.get('q') || '', status: params.get('status') || 'all', trainer: params.get('trainer') || '', role: params.get('role') || '', scope }
  const setFilters = patch => {
    if ('scope' in patch) { setScope(patch.scope); return }
    const next = new URLSearchParams(params); for (const [k, v] of Object.entries(patch)) { if (v && v !== 'all') next.set(k, v); else next.delete(k) }
    setParams(next, { replace: true })
  }
  const go = (nextTab, extra = {}) => { const next = new URLSearchParams(); next.set('tab', nextTab); for (const [k, v] of Object.entries(extra)) if (v) next.set(k, v); setParams(next) }

  const allowed = admin || !!user?.trainer
  const fail = e => toast(e.message || t('Failed to load'))
  useEffect(() => { if (allowed && tab === 'today') fetchCenterToday(days).then(setToday).catch(fail) }, [allowed, tab, days])
  useEffect(() => {
    if (!allowed || tab !== 'members') return undefined
    const load = () => fetchCenterMembers(admin ? undefined : scope).then(setMembers).catch(fail)
    load(); const iv = setInterval(load, 30000); return () => clearInterval(iv)
  }, [allowed, tab, scope, admin])
  useEffect(() => { if (allowed && tab === 'trainers') fetchCenterTrainers().then(setTrainers).catch(fail) }, [allowed, tab])
  if (!allowed) return null

  const openFollow = id => nav('/center/member/' + id)
  const reloadMembers = () => fetchCenterMembers(admin ? undefined : scope).then(setMembers).catch(() => {})
  const openProfile = id => openSheet(close => <UserDetail id={id} onChanged={reloadMembers} close={close} />)

  return <div className="cmx">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(admin ? '/admin' : '/trainer')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Center management')}</h1><div className="sub">{t('Who is training, who needs you, and who looks after whom')}</div></div>
    </div>
    <Segmented className="cm-tabs" value={tab} onChange={v => go(v)} options={TABS.map(k => ({ value: k, label: t(TAB_LABEL[k]) }))} />
    {tab === 'today' && (today ? <TodayView d={today} days={days} onDays={setDays} openMember={openFollow} goMembers={s => go('members', { status: s })} /> : <ListSkeleton rows={4} />)}
    {tab === 'members' && (members ? <MembersView data={members} today={members.today} admin={admin} filters={filters} setFilters={setFilters} onFollow={openFollow} onProfile={openProfile} /> : <ListSkeleton rows={5} />)}
    {tab === 'trainers' && (trainers ? <TrainersView d={trainers} onOpen={id => go('members', { trainer: id })} /> : <ListSkeleton rows={3} />)}
  </div>
}
