import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { rankAttention } from '../lib/attention.js'
import Icon from '../components/Icon.jsx'
import { Surface, Pill, ListSkeleton, EmptyState } from '../components/v2.jsx'
import { Button, Avatar } from '../components/ui.jsx'
import { UserDetail } from './Admin.jsx'
import { alertText } from './AdminFollowUp.jsx'

/* "What needs my attention today" — staff view over the follow-up data the server already exposes (admin-only, like the rest of /api/admin/user*).
   Urgent first, then upcoming reviews and inactivity, then everyone who is on track. Only blocks with members are drawn. */
async function loadRows(users) {
  const rows = []
  const queue = [...users]
  const worker = async () => {
    while (queue.length) {
      const u = queue.shift()
      try { const r = await api('/api/admin/user/followup?id=' + encodeURIComponent(u.id)); rows.push({ user: u, ...r }) } catch { /* one member failing never hides the others */ }
    }
  }
  await Promise.all(Array.from({ length: 5 }, worker))
  return rows
}

function Row({ r, openUser, nav }) {
  return <Surface className="v3-att-row">
    <div className="v3-att-top">
      <Avatar name={r.user.name} size={40} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div className="tt capitalize">{r.user.name}</div>
        <div className="small dim">
          {r.lastWorkout ? t('Last workout {0}', fmtDate(r.lastWorkout)) : t('No workouts yet')}
          {r.perWeek != null && ' · ' + (r.plannedPerWeek ? t('{0} of {1} per week', r.perWeek, r.plannedPerWeek) : t('{0} per week', r.perWeek))}
        </div>
      </div>
      {r.reviewIn != null && <Pill tone={r.reviewIn < 0 ? 'gold' : undefined}>{r.reviewIn < 0 ? t('Review overdue by {0} days', -r.reviewIn) : r.reviewIn === 0 ? t('Review today') : t('Review in {0} days', r.reviewIn)}</Pill>}
    </div>
    {r.alerts.length > 0 && <ul className="v3-att-alerts">{r.alerts.map((a, i) => <li key={i}>{alertText(a)}</li>)}</ul>}
    <div className="v3-att-acts">
      <Button size="sm" variant="tinted" icon="clipboard" onClick={() => nav('/trainer/' + r.user.id)}>{t('Plan')}</Button>
      <Button size="sm" icon="chartLine" onClick={() => openUser(r.user.id)}>{t('Follow-up')}</Button>
    </div>
  </Surface>
}

export default function AdminAttention() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [rank, setRank] = useState(null)
  const load = () => api('/api/admin/users').then(async d => {
    const members = (d.users || []).filter(u => !u.disabled && !u.admin && !u.trainer)
    setRank(rankAttention(await loadRows(members)))
  }).catch(e => toast(e.message || t('Failed to load')))
  useEffect(() => { if (user?.admin) load() }, [])
  if (!user?.admin) return null
  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={load} close={close} />)
  const none = rank && !rank.urgent.length && !rank.soon.length
  return <div className="narrow v3-att">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Needs attention')}</h1><div className="sub">{t('Who to look at today')}</div></div>
    </div>
    {!rank ? <ListSkeleton rows={3} /> : <>
      {rank.urgent.length > 0 && <><h4 className="sec">{t('Urgent')}<span className="v2-badge">{rank.urgent.length}</span></h4>{rank.urgent.map(r => <Row key={r.user.id} r={r} openUser={openUser} nav={nav} />)}</>}
      {rank.soon.length > 0 && <><h4 className="sec">{t('Coming up')}<span className="v2-badge">{rank.soon.length}</span></h4>{rank.soon.map(r => <Row key={r.user.id} r={r} openUser={openUser} nav={nav} />)}</>}
      {none && <EmptyState icon="checkCircle" title={t('Everyone is on track')}><div className="muted small">{t('No alerts and no reviews due this week.')}</div></EmptyState>}
      {rank.onTrack.length > 0 && <p className="small dim" style={{ textAlign: 'center', marginTop: 16 }}>{t('{0} members on track', rank.onTrack.length)}</p>}
    </>}
  </div>
}
