import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import { Button, Avatar } from '../components/ui.jsx'
import { addFriendSheet, confirmSheet } from '../sheets.jsx'
import { fetchFriends, acceptFriendRequest, declineFriendRequest, cancelFriendRequest, removeFriend, sendFriendRequest } from '../lib/friends-api.js'

export default function Friends() {
  const [params, setParams] = useSearchParams()
  const toast = useUI(s => s.toast)
  const [data, setData] = useState(null)   // { friends, incoming, outgoing }
  const [busy, setBusy] = useState(false)

  const load = () => fetchFriends().then(setData).catch(e => toast(e.message))
  useEffect(() => { load() }, [])

  // Opening a shared invite link (?code=...) lands here and sends the request right away — the
  // link itself was the sharer's consent, the recipient's own accept step is still required.
  useEffect(() => {
    const code = params.get('code')
    if (!code) return
    setParams({}, { replace: true })
    sendFriendRequest({ code }).then(() => { toast(t('Friend request sent')); load() }).catch(e => toast(e.message))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const respond = (fn, id, okMsg) => {
    setBusy(true)
    fn(id).then(() => { toast(okMsg); load() }).catch(e => toast(e.message)).finally(() => setBusy(false))
  }

  if (!data) return <div className="narrow"><div className="hdr"><div><h1>{t('Friends')}</h1></div></div></div>

  const nothingYet = !data.friends.length && !data.incoming.length && !data.outgoing.length

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Friends')}</h1></div>
      <Button size="sm" onClick={() => addFriendSheet(load)}>{t('Add')}</Button>
    </div>

    {!!data.incoming.length && <>
      <h4 className="sec">{t('Requests')}</h4>
      <div className="list" style={{ marginBottom: 22 }}>
        {data.incoming.map(r => <div key={r.id} className="item">
          <Avatar name={r.from?.name} size={40} />
          <div className="grow"><div className="tt capitalize">{r.from?.name}</div></div>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => respond(acceptFriendRequest, r.id, t('Now you are friends'))}>{t('Accept')}</Button>
          <Button size="sm" disabled={busy} onClick={() => respond(declineFriendRequest, r.id, t('Request declined'))}>{t('Decline')}</Button>
        </div>)}
      </div>
    </>}

    {!!data.outgoing.length && <>
      <h4 className="sec">{t('Sent')}</h4>
      <div className="list" style={{ marginBottom: 22 }}>
        {data.outgoing.map(r => <div key={r.id} className="item">
          <Avatar name={r.to?.name} size={40} />
          <div className="grow"><div className="tt capitalize">{r.to?.name}</div><div className="ss">{t('Pending')}</div></div>
          <Button size="sm" disabled={busy} onClick={() => respond(cancelFriendRequest, r.id, t('Request cancelled'))}>{t('Cancel')}</Button>
        </div>)}
      </div>
    </>}

    {data.friends.length ? (
      <div className="list">
        {data.friends.map(f => <div key={f.id} className="item">
          <Avatar name={f.name} size={40} />
          <div className="grow"><div className="tt capitalize">{f.name}</div></div>
          <button className="iconbtn" aria-label={t('Remove friend')} onClick={() => confirmSheet({
            title: t('Remove {0}?', f.name), confirmText: t('Remove'), danger: true,
            onConfirm: () => respond(removeFriend, f.id, t('Friend removed'))
          })}><Icon name="xmark" /></button>
        </div>)}
      </div>
    ) : nothingYet && (
      <div className="card" style={{ textAlign: 'center' }}>
        <div style={{ color: 'var(--label-2)', marginBottom: 10 }}><Icon name="users" size={40} /></div>
        <div className="big" style={{ fontSize: 20, marginBottom: 6 }}>{t('Share activity')}</div>
        <div className="muted small" style={{ marginBottom: 14 }}>{t('Invite friends to share workouts, get inspired and stay motivated.')}</div>
        <Button variant="primary" onClick={() => addFriendSheet(load)}>{t('Invite a friend')}</Button>
      </div>
    )}
  </div>
}
