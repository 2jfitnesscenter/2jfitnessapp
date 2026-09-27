import { useEffect, useRef, useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { Button } from './ui.jsx'
import CommunityShareCard from './CommunityShareCard.jsx'
import { capturePng, sharePng } from '../lib/share-image.js'
import InternalShareActions from './InternalShareActions.jsx'
import { useStore } from '../store/useStore.js'

export default function SocialShareSheet({ data, shareTarget, close }) {
  const cardRef = useRef(null)
  const toast = useUI(s => s.toast)
  const user = useStore(s => s.user)
  const [busy, setBusy] = useState(false)
  const [showHelp, setShowHelp] = useState(false)
  useEffect(() => {
    const key = `community-share-help:v1:${user?.id || 'guest'}`
    if (!localStorage.getItem(key)) setShowHelp(true)
  }, [user?.id])
  const dismissHelp = () => { localStorage.setItem(`community-share-help:v1:${user?.id || 'guest'}`, '1'); setShowHelp(false) }
  const share = async () => {
    if (busy || !cardRef.current) return
    setBusy(true)
    try { await sharePng(await capturePng(cardRef.current), `2J-${data.kind}-${Date.now()}.png`, data.title, data.subtitle); close() }
    catch (e) { if (e?.name !== 'AbortError') toast(e.message || t('Could not export image')) }
    finally { setBusy(false) }
  }
  return <div className="social-share-sheet">
    <header className="row between"><div><h3>{t('Share')}</h3><div className="small muted">{t('A private-ready 2J card')}</div></div><button className="iconbtn" aria-label={t('Close')} onClick={close}><span aria-hidden="true">×</span></button></header>
    <div className="community-share-preview"><CommunityShareCard data={data} cardRef={cardRef} /></div>
    <div className="small muted" style={{ margin: '12px 0' }}>{t('This card contains only the details shown above.')}</div>
    {showHelp && <div className="share-first-use"><Icon name="lock" /><span>{t('Your training stays private until you choose a destination. Community and chat recheck your privacy settings.')}</span><button onClick={dismissHelp}>{t('Got it')}</button></div>}
    {shareTarget && <InternalShareActions target={shareTarget} />}
    <Button variant="primary" disabled={busy} icon="upload" onClick={share}>{t('Share image')}</Button>
  </div>
}
