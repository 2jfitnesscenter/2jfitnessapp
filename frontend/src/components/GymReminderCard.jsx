import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { useUI } from '../store/useUI.js'
import { Section, Row, Switch, Button } from './ui.jsx'
import {
  GYM_RADIUS_M, readGymReminder, writeGymReminder, clearGymReminder, getBrowserPosition,
} from '../lib/gym-reminder.js'

// The browser's localStorage, or null when the browser refuses to give it out.
const deviceStore = () => { try { return window.localStorage } catch { return null } }

// Settings card for the opt-in gym arrival reminder. The location permission is asked for only
// when the user turns the feature on (or updates the gym), never on page load.
export default function GymReminderCard() {
  const toast = useUI(s => s.toast)
  const store = deviceStore()
  const [s, setS] = useState(() => readGymReminder(store))
  const [busy, setBusy] = useState(false)

  const saveHere = async () => {
    setBusy(true)
    try {
      const p = await getBrowserPosition()
      const next = { on: true, lat: p.lat, lng: p.lng, radius: GYM_RADIUS_M, lastCheckAt: 0, nudgedDay: null }
      if (!writeGymReminder(store, next)) { toast(t('Could not save the gym location on this device')); return }
      setS(next)
      toast(t('Gym location saved on this device'))
    } catch (e) {
      toast(e?.code === 1 ? t('Location permission denied. You can allow it in your browser settings.') : t('Could not get your location'))
    } finally { setBusy(false) }
  }

  const turnOff = () => {
    clearGymReminder(store)
    setS(readGymReminder(store))
    toast(t('Gym location removed from this device'))
  }

  return (
    <Section footer={t('Off by default. It only checks when you open 2J, at most every 30 minutes, and reminds you once a day. Your gym location stays on this device: it is never sent to 2J or to anyone else. The browser cannot watch your location in the background.')}>
      <Row icon="mapPin" iconTint="var(--green)" title={t('Gym arrival reminder')}
        subtitle={s.on ? t('On. Your gym is saved on this device.') : t('Remind me to start when I open 2J at the gym')}>
        <Switch checked={s.on} disabled={busy} onChange={() => (s.on ? turnOff() : saveHere())} />
      </Row>
      {s.on && <Row icon="mapPin" iconTint="var(--green)" title={t('Update my gym location')}
        subtitle={t('Use where I am now as the gym (about {0} m)', GYM_RADIUS_M)}>
        <Button variant="plain" disabled={busy} onClick={saveHere}>{t('Use current location')}</Button>
      </Row>}
    </Section>
  )
}
