import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import { fetchBunkerAdminSessions, closeBunkerSession, fetchBunkerSettings, saveBunkerSettings, fetchBunkerAdminCode } from '../lib/bunker-api.js'
import Icon from '../components/Icon.jsx'
import { Section, Row, Segmented, Switch, Button } from '../components/ui.jsx'

// /admin/bunker — the same room-management surface Bunker.jsx's own in-kiosk overlay offers
// (session list + room settings), reached from a trainer/admin's own phone with their normal
// cookie session instead of typing their fixed code on the shared screen. Same two API
// functions either way (lib/bunker-api.js's optional `adminToken` arg falls back to the
// cookie when omitted) — this page is just a second doorway to the identical server state.
export default function BunkerAdminPage() {
  const nav = useNavigate()
  const [sessions, setSessions] = useState([])
  const [settings, setSettings] = useState(null)
  const [code, setCode] = useState(null)

  const load = () => {
    fetchBunkerAdminSessions().then(setSessions).catch(() => {})
    fetchBunkerSettings().then(setSettings).catch(() => {})
  }
  useEffect(() => {
    load()
    fetchBunkerAdminCode().then(setCode).catch(() => {})
    const id = setInterval(load, 5000)
    return () => clearInterval(id)
  }, [])

  const close = uid => closeBunkerSession(uid).then(load)
  const patch = p => saveBunkerSettings(p).then(setSettings)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Room admin')}</h1></div>
      <button className="iconbtn" onClick={() => window.open('#/bunker', '_blank')} aria-label={t('Open the room screen')}><Icon name="expand" /></button>
    </div>

    {code && <Section title={t('Bunker admin code')} footer={t('Enter this on the Bunker screen itself to manage the room without unlocking your phone. It’s fixed — there’s no way to change it here.')}>
      <Row icon="key" iconTint="var(--orange)" title={code} />
    </Section>}

    <Section title={t('Active sessions')}>
      {sessions.length === 0 && <div className="muted small" style={{ padding: '4px 14px 10px' }}>{t('Nobody checked in yet — be the first.')}</div>}
      {sessions.map(s => (
        <Row key={s.uid} icon="person" iconTint="var(--acc)" title={s.name} subtitle={s.exName || t('Getting ready…')}>
          <button className="iconbtn" style={{ width: 32, height: 32, color: 'var(--red)' }} aria-label={t('Disconnect')} onClick={() => close(s.uid)}><Icon name="xmark" /></button>
        </Row>
      ))}
    </Section>

    {settings && <Section title={t('Settings')}>
      <Row icon="list" iconTint="var(--indigo)" title={t('Grid columns')}>
        <Segmented className="seg-inline" value={settings.columns} onChange={v => patch({ columns: v })}
          options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} />
      </Row>
      <Row icon="bell" iconTint="var(--pink)" title={t('Rest-over sound alert')}>
        <Switch checked={!!settings.soundAlerts} onChange={v => patch({ soundAlerts: v })} />
      </Row>
    </Section>}
  </div>
}
