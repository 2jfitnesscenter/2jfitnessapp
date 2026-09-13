import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { beep, vibrate } from '../lib/sound.js'
import { fetchFriends } from '../lib/friends-api.js'

const POLL_MS = 15000

// Same shape as ChatWatcher.jsx, for the other half of "you got a message or a friend
// request" — an incoming request is inherently "unread" until accepted/declined (the
// GET /api/friends response itself is the read state), so this only needs to watch for
// requests that weren't there on the previous poll, no server-side read-tracking involved.
export default function FriendsWatcher() {
  const user = useStore(s => s.user)
  const setFriendUnread = useUI(s => s.setFriendUnread)
  const loc = useLocation()
  const pathRef = useRef(loc.pathname)
  useEffect(() => { pathRef.current = loc.pathname }, [loc.pathname])

  useEffect(() => {
    if (!user) { setFriendUnread(0); return }
    let stopped = false
    const seen = new Set()
    let primed = false
    const poll = () => fetchFriends().then(({ incoming }) => {
      if (stopped) return
      setFriendUnread(incoming.length)
      incoming.forEach(r => {
        if (primed && !seen.has(r.id) && pathRef.current !== '/friends') {
          beep(useStore.getState().S.sound, 740, 0.12); vibrate(30)
          useUI.getState().toast(t('New friend request: {0}', r.from?.name || '?'))
        }
        seen.add(r.id)
      })
      primed = true
    }).catch(() => {})
    poll()
    const iv = setInterval(poll, POLL_MS)
    return () => { stopped = true; clearInterval(iv) }
  }, [user, setFriendUnread])

  return null
}
