import { useEffect, useState } from 'react'
import { t } from '../lib/i18n.js'
import { fetchFriends } from '../lib/friends-api.js'
import { startDirectThread, sendShare } from '../lib/chat-api.js'
import { createSocialShare } from '../lib/social-api.js'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

export default function InternalShareActions({ target }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [friends, setFriends] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { fetchFriends().then(x => setFriends(x.friends || [])).catch(() => setFriends([])) }, [])
  const community = async () => {
    if (busy) return
    setBusy(true)
    try { await createSocialShare({ ...target, idempotencyKey: requestKey() }); toast(t('Shared with the Community')) }
    catch (e) { toast(e.message || t('This content is private in your settings')) }
    finally { setBusy(false) }
  }
  const direct = async friend => {
    if (busy) return
    setBusy(true)
    try {
      const thread = await startDirectThread(friend.id)
      await sendShare({ ...target, recipientId: friend.id, threadId: thread.id, idempotencyKey: requestKey() })
      toast(t('Shared in chat with {0}', friend.name))
    } catch (e) { toast(e.message || t('Could not share this content')) }
    finally { setBusy(false) }
  }
  if (!target?.kind || !target?.targetId) return null
  return <section className="internal-share-actions" aria-label={t('Share inside 2J')}>
    <div className="internal-share-heading"><span><Icon name="users" /></span><div><strong>{t('Share inside 2J')}</strong><small>{t('You choose where this moment goes.')}</small></div></div>
    <Button variant="tinted" disabled={busy} icon="users" onClick={community}>{t('Community')}</Button>
    <div className="internal-share-friends-label">{t('Send to a friend')}</div>
    {friends === null ? <div className="muted small">{t('Loading…')}</div> : friends.length
      ? <div className="internal-share-friends">{friends.slice(0, 8).map(friend => <button type="button" key={friend.id} disabled={busy} onClick={() => direct(friend)}><span className="internal-share-avatar"><Icon name="person" /></span><span>{friend.name}</span><Icon name="chevronRight" /></button>)}</div>
      : <div className="muted small">{t('Add a friend to share a moment in chat.')}</div>}
    <div className="internal-share-note">{t('Shared details are rechecked against your privacy settings each time they are opened.')}</div>
  </section>
}
const requestKey = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}_${Math.random().toString(36).slice(2, 16)}`
