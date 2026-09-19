import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { Button } from './ui.jsx'
import Icon from './Icon.jsx'

const DISMISS_KEY = 'gym_install_dismissed_until'
const DISMISS_DAYS = 14

const isStandalone = () => window.matchMedia && window.matchMedia('(display-mode: standalone)').matches

// A custom "Add to home screen" banner in place of the browser's own mini-infobar — captures
// the deferred `beforeinstallprompt` event and fires it from our own button instead. Skipped
// entirely for the native (Capacitor) build (MOBILE — already an installed app, nothing to
// prompt) and once `display-mode: standalone` says the PWA is already installed. A dismiss
// is remembered for two weeks (not forever — Chrome itself may re-offer the event after a
// dismissal, and someone who said "not now" on day 1 may well want it by day 20) rather than
// nagging every session.
export default function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const timer = useUI(s => s.timer)
  const work = useUI(s => s.work)

  useEffect(() => {
    if (MOBILE || isStandalone()) return
    const until = Number(localStorage.getItem(DISMISS_KEY) || 0)
    if (Date.now() < until) setDismissed(true)
    const onPrompt = e => { e.preventDefault(); setPromptEvent(e) }
    const onInstalled = () => { setPromptEvent(null); setDismissed(true) }
    window.addEventListener('beforeinstallprompt', onPrompt)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (MOBILE || !promptEvent || dismissed || timer || work) return null

  const install = async () => {
    const ev = promptEvent
    setPromptEvent(null)   // a captured prompt can only be used once
    try { ev.prompt(); await ev.userChoice } catch (e) { /* dismissed or unsupported */ }
  }
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() + DISMISS_DAYS * 86400000))
    setDismissed(true)
  }

  return (
    <div id="install-prompt">
      <span className="install-i"><Icon name="download" /></span>
      <div className="grow">
        <div className="t">{t('Install 2J Fitness App')}</div>
        <div className="s">{t('Add it to your home screen for one-tap access.')}</div>
      </div>
      <Button size="sm" variant="primary" onClick={install}>{t('Install')}</Button>
      <button className="iconbtn" style={{ width: 30, height: 30 }} aria-label={t('Dismiss')} onClick={dismiss}><Icon name="xmark" /></button>
    </div>
  )
}
