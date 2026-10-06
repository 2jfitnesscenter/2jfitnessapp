import { useCallback, useEffect, useRef } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { t } from '../lib/i18n.js'
import { api } from '../lib/api.js'

const IDLE_MS = 15 * 60_000

export default function SharedStaffSessionGuard() {
  const user = useStore(s => s.user)
  const lockSharedSession = useStore(s => s.lockSharedSession)
  const locking = useRef(false)
  const lockNow = useCallback(async () => {
    if (locking.current) return
    locking.current = true
    if (user?.id) { try { sessionStorage.removeItem(`gym_shared_last_activity:${user.id}`) } catch { /* private mode */ } }
    const ui = useUI.getState()
    ui.closeAll(); ui.stopRest(); ui.stopWork()
    ui.setChatUnread(0); ui.setFriendUnread(0); ui.setNotificationUnread(0)
    await lockSharedSession()
  }, [lockSharedSession, user?.id])
  useEffect(() => {
    if (user?.authLevel !== 'pin') return
    locking.current = false
    let timer
    let lastHeartbeat = 0
    const activityKey = `gym_shared_last_activity:${user.id}`
    const elapsed = () => {
      try { return Date.now() - Number(sessionStorage.getItem(activityKey) || Date.now()) } catch { return 0 }
    }
    const schedule = () => {
      clearTimeout(timer)
      const remaining = IDLE_MS - elapsed()
      if (remaining <= 0) lockNow()
      else timer = setTimeout(lockNow, remaining)
    }
    const activity = () => {
      if (locking.current) return
      try { sessionStorage.setItem(activityKey, String(Date.now())) } catch { /* in-memory timer still works */ }
      schedule()
      if (Date.now() - lastHeartbeat >= 45_000) {
        lastHeartbeat = Date.now()
        api('/api/shared-device/heartbeat', { method: 'POST', body: '{}' }).catch(() => {})
      }
    }
    const checkElapsed = () => schedule()
    let hasActivity = false
    try { hasActivity = !!sessionStorage.getItem(activityKey) } catch { /* session storage may be unavailable */ }
    if (!hasActivity) { try { sessionStorage.setItem(activityKey, String(Date.now())) } catch { /* private mode */ } }
    schedule()
    const activityEvents = ['pointerdown', 'keydown', 'touchstart', 'mousemove', 'wheel']
    activityEvents.forEach(event => document.addEventListener(event, activity, { passive: true }))
    document.addEventListener('visibilitychange', checkElapsed)
    window.addEventListener('2j:shared-session-invalid', lockNow)
    return () => {
      clearTimeout(timer)
      activityEvents.forEach(event => document.removeEventListener(event, activity))
      document.removeEventListener('visibilitychange', checkElapsed)
      window.removeEventListener('2j:shared-session-invalid', lockNow)
    }
  }, [user?.id, user?.authLevel, lockNow])

  if (user?.authLevel !== 'pin') return null
  return <div className="shared-staff-session-bar" role="status">
    <span><Icon name="person" /> {t('Shared access')} · {user.name}</span>
    <button type="button" onClick={lockNow}>{t('Switch trainer')}</button>
  </div>
}
