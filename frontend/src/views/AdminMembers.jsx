import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { UserDetail, rel } from './Admin.jsx'

// The full member list and search/filter, split out of Admin.jsx's own scroll — it was the
// one section that kept growing without bound (every member, forever), pushing the dashboard's
// actual controls further down every time the gym signed someone new up. Reached from the
// "Members" nav card instead.
export default function AdminMembers() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')   // all | active | inactive | disabled

  const loadUsers = () => api('/api/admin/users').then(d => setUsers(d.users)).catch(e => toast(e.message || t('Failed to load')))
  useEffect(() => { if (!user?.admin) return; loadUsers(); const iv = setInterval(loadUsers, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
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
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Members')}</h1>
        <div className="sub">{users ? t('{0} users · {1} active this week', users.length, activeCount) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={loadUsers} aria-label={t('refresh')}>↻</button>
    </div>

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
