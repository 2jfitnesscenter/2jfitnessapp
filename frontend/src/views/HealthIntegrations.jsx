// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { connectWhoop, disconnectWhoop, fetchWhoopWorkouts } from '../lib/whoop-api.js'
import { mapWhoopWorkout, matchAll, attachFitness, fitnessSources } from '../lib/fitness.js'
import { bleSupported } from '../lib/ble-hr.js'
import { getBridge, bridgeState, connectBridge, readBridge, applyMatches, disconnectBridge, platformLabel, shouldShowManualHealthConnectHelp } from '../lib/health-bridge.js'
import { importFromApp, confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Section, Row, Button } from '../components/ui.jsx'

// Fitness integrations V1 — only what really works from this web app today, and how each watch
// reaches 2J. Health Connect (Android) and HealthKit (iPhone) cannot be read from a browser or an
// installed PWA; they appear here as an explanation, never as a button that does nothing.
const countBy = (S, source) => (S.workouts || []).filter(w => fitnessSources(w).some(r => r.source === source) || (source === 'apple' && w.hrZones)).length

function AmbiguousSheet({ items, close, ownerId }) {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const [left, setLeft] = useState(items)
  const choose = (item, wid) => {
    if (ownerId != null && useStore.getState().user?.id !== ownerId) { close(); return }
    if (wid) update(s => { const w = s.workouts.find(x => x.id === wid); if (w) attachFitness(w, item.rec) })
    const next = left.filter(x => x !== item)
    setLeft(next)
    if (!next.length) close()
  }
  return <>
    <h3>{t('Which workout was it?')}</h3>
    <div className="muted small" style={{ marginBottom: 10 }}>{t('These activities overlap more than one workout, or only partly. Choose, or skip — nothing is linked on a guess.')}</div>
    {left.map((item, i) => <div key={i} className="card">
      <div className="small"><b>{new Date(item.rec.start).toLocaleString()}</b> · {item.rec.origin || ''} {item.rec.calories ? '· ' + item.rec.calories + ' kcal' : ''}</div>
      <div className="list" style={{ marginTop: 8 }}>
        {item.candidates.map(c => { const w = S.workouts.find(x => x.id === c.id); return w && <div key={c.id} className="item" onClick={() => choose(item, c.id)}>
          <div className="grow"><div className="tt">{w.name}</div><div className="ss">{fmtDate(w.d, true)} · {t('{0}% overlap', Math.round(c.ofLonger * 100))}</div></div>
          <Icon name="chevronRight" className="chev" /></div> })}
      </div>
      <Button variant="ghost" className="dim" onClick={() => choose(item, null)}>{t('Skip this one')}</Button>
    </div>)}
  </>
}

export default function HealthIntegrations() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const [busy, setBusy] = useState(false)
  const [whoopNeedsReconnect, setWhoopNeedsReconnect] = useState(false)
  const [showManualHealthConnectHelp, setShowManualHealthConnectHelp] = useState(false)

  const importWhoop = async () => {
    setBusy(true)
    try {
      const r = await fetchWhoopWorkouts(30)
      if (r.needsReconnect) { setWhoopNeedsReconnect(true); return }
      if (!r.connected) { toast(t('WHOOP is not connected')); return }
      const recs = (r.workouts || []).map(x => mapWhoopWorkout(x)).filter(Boolean)
      const res = matchAll(useStore.getState().S.workouts, recs)
      if (res.match.length) update(s => { res.match.forEach(({ rec, workoutId }) => { const w = s.workouts.find(x => x.id === workoutId); if (w) attachFitness(w, rec) }) })
      toast(t('{0} linked · {1} already linked · {2} without a matching workout', res.match.length, res.linked.length, res.none.length))
      if (res.ambiguous.length) useUI.getState().openSheet(close => <AmbiguousSheet items={res.ambiguous} close={close} />)
    } catch (e) { toast(e.status === 429 ? t('Wait a moment before importing again') : t('Could not reach WHOOP — try again when you are online')) }
    finally { setBusy(false) }
  }
  const whoopConnected = !!user?.whoop

  // Native bridge (Health Connect / Apple Health inside a 2J shell). `bridge` is null in a browser
  // or the installed PWA, and then none of this renders: the screen stays as it was.
  const bridge = getBridge()
  const bstate = bridgeState(user?.id)
  const connectNative = async () => {
    const ownerId = user?.id
    setShowManualHealthConnectHelp(false)
    setBusy(true)
    try {
      const r = await connectBridge({ uid: ownerId, bridge })
      if (useStore.getState().user?.id !== ownerId) return
      if (r.status === 'connected') toast(t('Connected. Nothing is read until you sync.'))
      else if (r.status === 'denied') {
        setShowManualHealthConnectHelp(shouldShowManualHealthConnectHelp(bridge, r.status))
        toast(t('Permission not granted. Nothing was read.'))
      }
      else toast(t('Health is not available on this device'))
    } finally { setBusy(false) }
  }
  const syncNative = async () => {
    const ownerId = user?.id
    setShowManualHealthConnectHelp(false)
    setBusy(true)
    try {
      const res = await readBridge({ uid: ownerId, workouts: useStore.getState().S.workouts, bridge })
      // Do not attach one account's health records to another account if the shell read resolves
      // after an auth switch.
      if (useStore.getState().user?.id !== ownerId) return
      if (res.status !== 'ok') {
        if (res.status === 'denied') setShowManualHealthConnectHelp(shouldShowManualHealthConnectHelp(bridge, res.status))
        toast(res.status === 'off' ? t('Connect first') : res.status === 'denied' ? t('Permission not granted. Nothing was read.') : t('Could not read your health data'))
        return
      }
      let attached = 0
      if (res.match.length) update(s => { attached = applyMatches(s, res) })
      toast(t('{0} linked · {1} already linked · {2} without a matching workout', attached, res.linked.length, res.none.length))
      if (res.ambiguous.length) useUI.getState().openSheet(close => <AmbiguousSheet items={res.ambiguous} close={close} ownerId={ownerId} />)
    } finally { setBusy(false) }
  }
  const disconnectNative = () => confirmSheet({
    title: t('Turn off {0}?', t(platformLabel(bridge))), message: t('2J stops reading it on this device. Workouts already linked keep their data. To revoke access completely, use your phone’s Health settings.'),
    confirmText: t('Turn off'), danger: true, onConfirm: () => disconnectBridge(user?.id) })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/health')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Fitness integrations')}</h1><div className="sub">{t('Calories and heart rate from your watch, linked to your 2J workouts')}</div></div>
    </div>

    {bridge && user?.id && <Section title={t(platformLabel(bridge)) + ' · ' + t('automatic')} footer={t('Read-only and off until you turn it on. 2J reads only each workout’s duration, calories and heart-rate average and maximum — never the raw heart-rate stream — and keeps it with your workouts, private to you.')}>
      {bstate.enabled ? <>
        <Row icon="download" iconTint="var(--red)" title={busy ? t('Importing…') : t('Sync workouts (30 days)')}
          subtitle={bstate.lastSync ? t('Last sync {0}', new Date(bstate.lastSync).toLocaleString()) : t('Not synced yet')} accessory="chevron" onClick={busy ? undefined : syncNative} />
        <Row icon="xmark" iconTint="var(--grey)" title={t('Turn off {0}', t(platformLabel(bridge)))} onClick={disconnectNative} />
      </> : <Row icon="heart" iconTint="var(--red)" title={t('Connect {0}', t(platformLabel(bridge)))}
        subtitle={t('You choose what to allow in the next screen')} accessory="chevron" onClick={busy ? undefined : connectNative} />}
      {showManualHealthConnectHelp && bridge.platform === 'android' && <div role="status" className="muted small" style={{ padding: '10px 14px 14px', lineHeight: 1.45 }}>
        {t('To allow access manually, open Settings → Health Connect → App access → 2J Fitness. The wording may vary by Android version.')}
      </div>}
    </Section>}

    <Section title={t('Apple Health (iPhone, Apple Watch)')} footer={t('Export from the Health app (profile → Export All Health Data) and import the file here. Workouts recorded by Apple Watch — or by apps that write to Health, like Zepp — bring their calories and heart rate; they are linked to a 2J workout only when the times clearly match. The file comes from an iPhone; you can upload it from any device, but this is a manual file import, not an Android integration.')}>
      <Row icon="upload" iconTint="var(--red)" title={t('Import Apple Health export')}
        subtitle={t('{0} workouts with Apple Health data', countBy(S, 'apple'))} accessory="chevron" onClick={() => fileRef.current?.click()} />
    </Section>
    <input ref={fileRef} type="file" accept=".xml,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    {config?.whoop && <Section title="WHOOP" footer={t('Read-only. Disconnecting keeps the data already linked to your workouts.')}>
      {whoopConnected ? <>
        {whoopNeedsReconnect
          ? <Row icon="reset" iconTint="var(--purple)" title={t('Reconnect WHOOP to import workouts')} subtitle={t('Your connection predates workout access.')} accessory="chevron" onClick={connectWhoop} />
          : <Row icon="download" iconTint="var(--purple)" title={busy ? t('Importing…') : t('Import WHOOP workouts (30 days)')}
            subtitle={t('{0} workouts with WHOOP data', countBy(S, 'whoop'))} accessory="chevron" onClick={busy ? undefined : importWhoop} />}
        <Row icon="xmark" iconTint="var(--grey)" title={t('Disconnect WHOOP')} onClick={() => confirmSheet({
          title: t('Disconnect {0}?', 'WHOOP'), message: t('Workouts already linked keep their data. You can reconnect any time.'), confirmText: t('Disconnect'), danger: true,
          onConfirm: () => disconnectWhoop().then(() => window.location.reload()).catch(e => toast(e.message)) })} />
      </> : <Row icon="heart" iconTint="var(--purple)" title={t('Connect WHOOP')} subtitle={t('Recovery, sleep and workout calories, heart rate and zones')} accessory="chevron" onClick={connectWhoop} />}
    </Section>}

    <Section title={t('Bluetooth heart-rate sensor')} footer={bleSupported()
      ? t('Experimental. Connect a chest strap or armband from the workout screen; 2J shows your live heart rate and saves the session average, maximum and zones — never the raw stream or the device.')
      : t('Not available in this browser. Web Bluetooth works in Chrome on Android and computers; iPhone and iPad do not support it.')}>
      <Row icon="heart" iconTint="var(--red)" title={t('Heart-rate sensor')}
        value={bleSupported() ? t('Compatible') : t('Not compatible')} />
    </Section>

    {config?.strava && <Section title={t('Strava (optional)')} footer={t('2J sends each finished workout to Strava. It does not read activities from Strava, so it is never needed for calories or heart rate.')}>
      <Row icon="upload" iconTint="var(--orange)" title="Strava" value={user?.strava ? t('Connected') : t('Not connected')} accessory="chevron" onClick={() => nav('/connected-apps')} />
    </Section>}

    <Section title={t('How your watch reaches 2J')}>
      <div className="hi-how">
        <p><b>Apple Watch</b> → {t('Apple Health')} → {t('export file today; automatic with the future 2J iPhone app')}.</p>
        <p><b>Zepp / Amazfit</b> → {t('on iPhone: Apple Health (enable it in Zepp); on Android: Health Connect, which a web app cannot read — it needs the future 2J Android app')}.</p>
        <p><b>Samsung, Fitbit, Garmin…</b> → Health Connect ({t('Android, future 2J app')}) {t('or Apple Health on iPhone')}.</p>
        <p><b>WHOOP</b> → {t('connected directly, works today')}.</p>
      </div>
    </Section>
    <div style={{ height: 20 }} />
  </div>
}
