import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUI } from '../../store/useUI.js'
import { t } from '../../lib/i18n.js'
import { fetchTrainerMembers } from '../../lib/trainer-api.js'
import { mediaUrl } from '../../lib/media.js'
import { Avatar } from '../../components/ui.jsx'
import Icon from '../../components/Icon.jsx'

// Entry point of the desktop trainer panel — a grid of every member, wide enough to browse at
// a glance on a real screen instead of a scrolling mobile list. Deliberately just {id, name,
// avatar} per card (GET /api/trainer/members) — the same reduced-blast-radius member list the
// existing Social "assign to a member" picker already uses, not the admin's full detail view.
export default function TrainerClients() {
  const nav = useNavigate()
  const toast = useUI(s => s.toast)
  const [members, setMembers] = useState(null)
  const [q, setQ] = useState('')

  useEffect(() => { fetchTrainerMembers().then(setMembers).catch(e => toast(e.message)) }, [])

  const filtered = (members || []).filter(m => m.name.toLowerCase().includes(q.trim().toLowerCase()))

  return <div id="trainer-app">
    <div className="trainer-topbar">
      <div style={{ flex: 1 }}>
        <h1>{t('Trainer panel')}</h1>
        <div className="sub">{t('Build and assign routines for your members.')}</div>
      </div>
      <a className="trainer-back" href="#/admin/bunker" style={{ marginRight: 10 }}><Icon name="dumbbell" />{t('Room admin')}</a>
      <a className="trainer-back" href="#/home"><Icon name="chevronLeft" />{t('Back to the app')}</a>
    </div>

    <input className="input" style={{ marginBottom: 18, maxWidth: 320 }} placeholder={t('Search a member…')}
      value={q} onChange={e => setQ(e.target.value)} />

    {members === null ? null : filtered.length ? (
      <div className="client-grid">
        {filtered.map(m => (
          <button key={m.id} className="client-card" onClick={() => nav('/trainer/' + m.id)}>
            <Avatar name={m.name} size={64} image={m.avatar ? mediaUrl(m.avatar) : null} />
            <div className="name capitalize">{m.name}</div>
          </button>
        ))}
      </div>
    ) : (
      <div className="empty"><div className="ico"><Icon name="users" /></div>{t('No members found.')}</div>
    )}
  </div>
}
