import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { Section, Row } from '../components/ui.jsx'
import { connectStrava, disconnectStrava } from '../lib/strava-api.js'
import { connectWhoop, disconnectWhoop } from '../lib/whoop-api.js'
import { confirmSheet } from '../sheets.jsx'

// A full-page redirect to Strava/Whoop and back — by the time this remounts, App.jsx's own boot()
// has already re-fetched /api/me, so `user.strava`/`user.whoop` are already current. This screen
// only needs to read the ?strava=/?whoop= query param to say what just happened.
export default function ConnectedApps() {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [params, setParams] = useSearchParams()
  const config = useStore(s => s.config)

  useEffect(() => {
    const strava = params.get('strava')
    const whoop = params.get('whoop')
    if (strava === 'connected') toast(t('Strava connected'))
    else if (strava === 'error') toast(t('Could not connect Strava'))
    if (whoop === 'connected') toast(t('Whoop connected'))
    else if (whoop === 'error') toast(t('Could not connect Whoop'))
    if (strava || whoop) setParams({}, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const disconnect = (fn, label) => confirmSheet({
    title: t('Disconnect {0}?', label), confirmText: t('Disconnect'), danger: true,
    onConfirm: () => fn().then(() => window.location.reload()).catch(e => toast(e.message))
  })

  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Connected apps')}</h1></div></div>

    {config?.strava && <Section title="Strava">
      <Row icon="upload" iconTint="var(--orange)" title="Strava"
        subtitle={t('Sends every finished workout to your Strava feed')}
        accessory="chevron" onClick={user?.strava ? () => disconnect(disconnectStrava, 'Strava') : connectStrava}>
        <span className={'tag ' + (user?.strava ? 'good' : 'bad')}>{user?.strava ? t('Connected') : t('Not connected')}</span>
      </Row>
    </Section>}

    {config?.whoop && <Section title="Whoop">
      <Row icon="heart" iconTint="var(--purple)" title="Whoop"
        subtitle={t('Shows your daily recovery score on Home')}
        accessory="chevron" onClick={user?.whoop ? () => disconnect(disconnectWhoop, 'Whoop') : connectWhoop}>
        <span className={'tag ' + (user?.whoop ? 'good' : 'bad')}>{user?.whoop ? t('Connected') : t('Not connected')}</span>
      </Row>
    </Section>}

    {!config?.strava && !config?.whoop && (
      <div className="muted small">{t('Nothing to connect yet — ask the gym owner to set this up first.')}</div>
    )}
  </div>
}
