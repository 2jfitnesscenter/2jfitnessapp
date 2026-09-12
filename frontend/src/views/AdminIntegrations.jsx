import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button, TextField } from '../components/ui.jsx'

// One Client ID/Secret per platform, registered once by the gym owner on that platform's own
// developer portal — every member who connects later authorizes that same app to their own
// individual account (see api/strava/oauth.js and api/whoop/oauth.js). Deliberately as small as
// AdminCoach.jsx's ApiKeySheet: there's no provider choice, no runtime to test, just a secret.
function CredentialsSheet({ close, onDone, label, savePath }) {
  const toast = useUI(s => s.toast)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api(savePath, { method: 'POST', body: JSON.stringify({ clientId: clientId.trim(), clientSecret: clientSecret.trim() }) })
      toast(t('Saved'))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }
  return <>
    <h3>{t('{0} credentials', label)}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {t('From your own {0} developer app. The secret is stored encrypted on this server and never shown again.', label)}
    </div>
    <TextField placeholder="Client ID" value={clientId} onChange={e => setClientId(e.target.value)} />
    <div style={{ height: 8 }} />
    <TextField placeholder="Client Secret" type="password" value={clientSecret} onChange={e => setClientSecret(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !clientId.trim() || !clientSecret.trim()} onClick={save}>{t('Save')}</Button>
  </>
}

function IntegrationCard({ label, statusPath, savePath, clearPath }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const load = () => api(statusPath).then(setD).catch(() => setD({ configured: false }))
  useEffect(() => { load() }, [])
  const clear = () => api(clearPath, { method: 'POST', body: '{}' }).then(() => { toast(t('Removed')); load() }).catch(e => toast(e.message))
  if (!d) return null
  return <div className="card">
    <div className="row between" style={{ marginBottom: 6 }}>
      <h2 style={{ margin: 0 }}>{label}</h2>
      <span className={'tag ' + (d.configured ? 'good' : 'bad')}>{d.configured ? t('Configured') : t('Not configured')}</span>
    </div>
    {d.configured ? <>
      <div className="small muted" style={{ marginBottom: 8 }}>Client ID: {d.clientId}</div>
      <Button size="sm" danger onClick={clear}>{t('Remove')}</Button>
    </> : (
      <Button size="sm" variant="primary" icon="key" onClick={() => openSheet(close => <CredentialsSheet close={close} onDone={load} label={label} savePath={savePath} />)}>
        {t('Add credentials')}
      </Button>
    )}
  </div>
}

export default function AdminIntegrations() {
  return <>
    <IntegrationCard label="Strava" statusPath="/api/admin/strava/config" savePath="/api/admin/strava/config" clearPath="/api/admin/strava/config/clear" />
    <IntegrationCard label="Whoop" statusPath="/api/admin/whoop/config" savePath="/api/admin/whoop/config" clearPath="/api/admin/whoop/config/clear" />
  </>
}
