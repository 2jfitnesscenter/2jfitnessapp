import { useEffect, useRef, useState } from 'react'
import GymProfile from '../components/GymProfile.jsx'
import { useNavigate } from 'react-router-dom'
import { useStore, DEF } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { ACCENTS, todayISO, localTZ } from '../lib/format.js'
import { effortOf } from '../lib/history.js'
import { pushSupported, enablePush, disablePush, sendTestPush } from '../lib/push.js'
import { t, nameFor, LANGS, INSTR_LANGS } from '../lib/i18n.js'
import { exOr } from '../lib/exercises.js'
import { DEMO } from '../lib/demo.js'
import { MOBILE, shareExport, syncReminder, syncBioimpedanceReminder } from '../lib/mobile.js'
import { daysSinceBioimpedance } from '../lib/measurements.js'
import { loadStarterPlan, confirmSheet, importFromApp, platesSheet } from '../sheets.jsx'
import { ZONES } from '../lib/training-zones.js'
import { ZONE_ORDER, ZONE_META } from '../lib/rp-volume.js'
import { coachAvailable, hasConsent } from '../lib/coach.js'
import { uxOn } from '../lib/features.js'
import { forgetCoach } from '../lib/coach-api.js'
import { RankGuideSheet } from './Rank.jsx'
import { ChangelogSheet } from './Changelog.jsx'
import { LegalSheet } from './Legal.jsx'
import DeleteAccountSheet from '../components/DeleteAccountSheet.jsx'
import { api } from '../lib/api.js'
import './experience.css'
import Icon from '../components/Icon.jsx'
import { Section, Row as RowBase, SelectRow as SelectRowBase, Switch, Segmented, Button, Avatar } from '../components/ui.jsx'
import PrivacySummary from '../components/PrivacySummary.jsx'
import { bridgeState } from '../lib/health-bridge.js'
import { openAccent } from '../components/AccentSheet.jsx'

// One-screen design trial (see the owner's ask for a less "colorful template" look): every row
// here gets Row's muted `softIcon` badge instead of the solid-fill one the rest of the app still
// uses, so the two styles can be compared side by side before deciding whether to roll it out
// everywhere. Revert by changing these back to `= RowBase` / `= SelectRowBase`.
const Row = props => <RowBase {...props} softIcon />
const SelectRow = props => <SelectRowBase {...props} softIcon />

export default function Settings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const config = useStore(s => s.config)
  useStore(s => s.features)   // the admin's switches arrive after the first render
  const { update, replaceStateOnServer, signOut, signOutAll, resetDemo } = useStore()
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const importRef = useRef(null)
  const [adv, setAdv] = useState(false)

  const doExport = async () => {
    const json = JSON.stringify(S, null, 2)
    const name = '2jfitness-backup-' + todayISO() + '.json'
    // WKWebView can't download blob URLs — the native build hands the file to the share sheet.
    if (MOBILE) {
      try { await shareExport(json, name); toast(t('Backup exported')) } catch (e) { /* share sheet dismissed */ }
      return
    }
    const blob = new Blob([json], { type: 'application/json' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click(); URL.revokeObjectURL(a.href)
    toast(t('Backup exported'))
  }
  const doImport = ev => {
    const f = ev.target.files[0]; if (!f) return
    const rd = new FileReader()
    rd.onload = () => {
      try {
        const data = JSON.parse(rd.result)
        if (!data.workouts || !data.routines) throw new Error('not a 2J Fitness Center backup')
        confirmSheet({ title: t('Import backup?'), message: t('This replaces all current data with the backup file.'), confirmText: t('Import'), danger: true, onConfirm: () => { replaceStateOnServer(Object.assign(JSON.parse(JSON.stringify(DEF)), data)); toast(t('Backup imported')) } })
      } catch (e) { toast(t('Import failed: {0}', e.message)) }
    }
    rd.readAsText(f)
  }
  // Everything the server holds about this member, as one JSON file (GET /api/me/export).
  const exportMyData = async () => {
    try {
      const data = await api('/api/me/export')
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = '2jfitness-account-' + todayISO() + '.json'; a.click(); URL.revokeObjectURL(a.href)
      toast(t('Your data was exported'))
    } catch (e) { toast(t('Could not export your data')) }
  }
  // Ends the profile's sessions on every device — this one included, so on success it lands in
  // the same place as the plain sign-out above (home, local data cleared). On failure nothing
  // local is touched: still signed in here, and say so rather than leaving a half-signed-out app.
  const signOutEverywhere = () => confirmSheet({
    title: t('Sign out everywhere?'),
    message: t('Signs this profile out on every device, including this one. Your passkeys keep working — sign in with them again anytime.'),
    confirmText: t('Sign out everywhere'), danger: true,
    onConfirm: async () => {
      try { await signOutAll(); nav('/home'); toast(t('Signed out on all devices')) }
      catch (e) { toast(t('Could not sign out everywhere — you are still signed in.')) }
    },
  })

  const signedIn = !!user && !MOBILE && !DEMO
  const healthOn = uxOn(S, 'health')
  const connectedApps = !!(user && (config?.strava || config?.whoop))
  const bioOn = uxOn(S, 'bioimpedance')
  const bridge = user ? bridgeState(user.id) : null
  const roleLabel = user?.admin ? t('Admin') : user?.trainer ? t('Trainer') : null

  return <div className="narrow set-v3">
    <div className="hdr">
      <div><h1>{t('Settings')}</h1></div>
    </div>

    {/* ---------- 1. account: who you are, your session, your account (guests create/sign in from Perfil; the demo/mobile builds have their own message) ---------- */}
    {(MOBILE || DEMO || user) && <h3 className="set-grp">{t('Account')}<span>{t('Your profile and your session')}</span></h3>}
    {signedIn && (
      <button type="button" className="set-hero tap" onClick={() => nav('/profile')} aria-label={t('Your profile')}>
        <Avatar name={user.name} size={52} />
        <span className="set-hero-m">
          <b className="capitalize">{user.name}</b>
          <small>{t('Signed in with passkey — data syncs to this profile.')}</small>
          {roleLabel && <i className="set-pill">{roleLabel}</i>}
        </span>
        <Icon name="chevronRight" className="lrow-c" />
      </button>
    )}
    {(MOBILE || DEMO || user) && (
      <Section>
        {MOBILE ? <>
          <Row icon="lock" iconTint="var(--acc)" title={t('All data stays on this phone')} subtitle={t('No account, no cloud — back it up anytime with Export below.')} />
        </> : DEMO ? <>
          <Row icon="sparkles" iconTint="var(--acc)" title={t('You’re in the demo')} subtitle={t('Example data, stored only in this browser — change anything you like.')} />
          <Row icon="reset" iconTint="var(--blue)" title={t('Reset demo data')} accessory="chevron"
            onClick={() => confirmSheet({ title: t('Reset demo data?'), message: t('Puts the example plan, workouts and weigh-ins back the way they started.'), confirmText: t('Reset'), onConfirm: () => { resetDemo(); nav('/home'); toast(t('Demo data reset')) } })} />
        </> : <>
          {user.admin && <Row icon="wrench" iconTint="var(--indigo)" title={t('Admin dashboard')} accessory="chevron" onClick={() => nav('/admin')} />}
          <Row icon="signOut" iconTint="var(--red)" title={t('Sign out')} danger onClick={() => confirmSheet({ title: t('Sign out?'), message: t('Your data is synced to your profile first, then cleared from this device.'), confirmText: t('Sign out'), danger: true, onConfirm: () => { signOut(); nav('/home') } })} />
          {!user.admin && !user.trainer && <Row icon="trash" iconTint="var(--red)" title={t('Delete my account')} subtitle={t('Permanently deletes your profile and everything linked to it')} danger onClick={() => useUI.getState().openSheet(close => <DeleteAccountSheet close={close} />)} />}
        </>}
      </Section>
    )}

    {/* ---------- 2. appearance ---------- */}
    <h3 className="set-grp">{t('Appearance')}<span>{t('How 2J looks and what you see')}</span></h3>
    <Section footer={DEMO || MOBILE ? undefined : t('synced with your profile')}>
      <SelectRow
        icon="globe" iconTint="var(--blue)" title={t('Language')}
        value={S.lang || 'es'} onChange={v => update(s => { s.lang = v })}
        options={Object.entries(LANGS).map(([k, name]) => ({
          value: k, label: name,
          subtitle: INSTR_LANGS.includes(k) ? null : t("Exercise instructions aren't available in this language yet — they stay in English."),
        }))}
      />
      <Row icon="moon" iconTint="var(--indigo)" title={t('Theme')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'system', label: t('Auto') }, { value: 'dark', icon: 'moon', label: t('Dark') }, { value: 'light', icon: 'sun', label: t('Light') }]}
          value={S.theme === 'light' || S.theme === 'dark' ? S.theme : 'system'}
          onChange={v => update(s => { s.theme = v })}
        />
      </Row>
      {/* Scales every font-size in the app (App.jsx's applyPrefs sets --text-scale from this). Stacked (title above, control below): 4 labels do not fit next to a
          title, and at the top step the title itself wraps. */}
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingTop: 13, paddingBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="lrow-i soft" style={{ '--tint': 'var(--blue)' }}><Icon name="textSize" /></span>
          <span className="lrow-t">{t('Text size')}</span>
        </div>
        <Segmented
          options={[
            { value: 0.9, label: t('Small') },
            { value: 1, label: t('Default') },
            { value: 1.15, label: t('Large') },
            { value: 1.3, label: t('Extra large') }
          ]}
          value={S.textScale || 1}
          onChange={v => update(s => { s.textScale = v })}
        />
      </div>
      {/* Liquid glass is part of the look for everyone now (App.jsx applies it; no switch, no dials). */}
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Accent color')} accessory="chevron" onClick={openAccent}>
        <span className="v3-accent-dot-cur" style={{ '--dot': ACCENTS[S.accent || 'lime'] || ACCENTS.lime }} role="img" aria-label={S.accent || 'lime'} />
      </Row>
      {/* Drives the muscle map illustration and, as "sex", is also sent to the AI Coach (api/coach/payload.js) — set here, not asked again in the intake. */}
      <Row icon="figureStrength" iconTint="var(--teal)" title={t('Body diagram')}>
        <Segmented
          className="seg-inline"
          options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]}
          value={S.body === 'female' ? 'female' : 'male'}
          onChange={v => update(s => { s.body = v })}
        />
      </Row>
      <Row icon="shield" iconTint="var(--acc)" title={t('Ranks')} subtitle={t('How ranks work, what you need, how many there are')} accessory="chevron"
        onClick={() => useUI.getState().openSheet(() => <RankGuideSheet />)} />
    </Section>
    <Section footer={t('Your gym may switch some features off for everyone; the rest is yours to show or hide. Nothing is deleted.')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Personalise my experience')}
        subtitle={S.ux ? t('Your choices are saved — change them any time') : t('Choose what you want to see: simple or complete')}
        accessory="chevron" onClick={() => nav('/settings/experience')} />
    </Section>

    {/* ---------- 3. training ---------- */}
    <h3 className="set-grp">{t('Training')}<span>{t('Your gym, your sessions, your numbers')}</span></h3>
    <Section>
      <GymProfile editable />
      <Row icon="scale" iconTint="var(--teal)" title={t('Weight unit')}>
        <Segmented className="seg-inline"
          options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
          value={S.unit} onChange={v => update(s => { s.unit = v })} />
      </Row>
      {/* Which of Library's three tabs (Plan.jsx) opens first — stacked, since the three labels are too wide to share the row with a title. */}
      <div className="lrow" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10, paddingTop: 13, paddingBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="lrow-i soft" style={{ '--tint': 'var(--indigo)' }}><Icon name="folder" /></span>
          <span className="lrow-t">{t('Default tab')}</span>
        </div>
        <Segmented
          options={[
            { value: 'programs', label: t('Programs') },
            { value: 'routines', label: t('Routines') },
            { value: 'library', label: t('Exercises') },
          ]}
          value={S.defaultLibraryTab || 'programs'}
          onChange={v => update(s => { s.defaultLibraryTab = v })}
        />
      </div>
    </Section>
    <Section title={t('During a workout')}>
      {/* Everything about how a workout looks and behaves lives on one ordered screen (views/TrainingSettings.jsx); only the standalone plate tool stays here. */}
      <Row icon="dumbbell" iconTint="var(--acc)" title={t('Training')}
        subtitle={t('View, sets, rest, progression and the training guide')}
        accessory="chevron" onClick={() => nav('/settings/training')} />
      <Row icon="barbell" iconTint="var(--blue)" title={t('Plate calculator')}
        subtitle={t('Work out what to load on any bar, outside of a set')}
        accessory="chevron" onClick={() => platesSheet(S.unit === 'lb' ? 45 : 20, S.unit)} />
      <Row icon="figureStrength" iconTint="var(--purple)" title={t('Statistics')}
        subtitle={t('How secondary muscles count toward volume and the muscle map')}
        accessory="chevron" onClick={() => nav('/settings/stats')} />
    </Section>

    {/* exercises excluded from your own picker (RoutineEdit's "…" menu) */}
    {S.excludedEx?.length > 0 && (
      <Section title={t('Not recommended to you')} footer={t('These won’t be offered when picking an exercise. Remove one here to see it again.')}>
        {S.excludedEx.map(exId => {
          const ex = exOr(exId)
          return <Row key={exId} title={nameFor(ex)} className="capitalize">
            <button className="iconbtn" aria-label={t('Show again')} style={{ width: 32, height: 32, borderRadius: 8, fontSize: 14 }}
              onClick={() => update(s => { s.excludedEx = (s.excludedEx || []).filter(id => id !== exId) })}><Icon name="xmark" /></button>
          </Row>
        })}
      </Section>
    )}

    {coachAvailable(config, user, { demo: DEMO, mobile: MOBILE }) && (
      <Section title={t('Coach')} footer={hasConsent(S)
        ? t('The Coach designs and adjusts your plan; it never changes anything without your say-so.')
        : t('An AI coach that can build your plan and adjust it from what you log. Off until you turn it on.')}>
        <Row icon="sparkles" iconTint="var(--acc)" title={hasConsent(S) ? t('Open the Coach') : t('Meet the Coach')}
          subtitle={hasConsent(S) ? t('Reviews, plan design, history and controls') : t('See what it would use, then decide')}
          value={hasConsent(S) ? t('On') : t('Off')}
          accessory="chevron" onClick={() => nav('/coach')} />
      </Section>
    )}

    {/* ---------- 4. health & activity ---------- */}
    {(healthOn || connectedApps || bioOn) && <>
    <h3 className="set-grp">{t('Health & activity')}<span>{t('Your watch, your steps, your body')}</span></h3>
    <Section>
      {healthOn && <Row icon="heart" iconTint="var(--red)" title={t('Health & activity')} subtitle={t('Steps, sleep, heart rate and your connected watch')}
        value={bridge?.enabled ? t('Connected') : t('Not connected')} accessory="chevron" onClick={() => nav('/health')} />}
      {connectedApps && (
        <Row icon="link" iconTint="var(--indigo)" title={t('Connected apps')}
          subtitle={t('Strava, Whoop')} accessory="chevron" onClick={() => nav('/connected-apps')} />
      )}
      {bioOn && <>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Bioimpedance reminder')}
        subtitle={t('A nudge on Home when it’s been a while since your last body-composition scan')}>
        <Switch checked={S.enableBioimpedanceReminder !== false} onChange={v => {
          update(s => { s.enableBioimpedanceReminder = v })
          if (MOBILE) syncBioimpedanceReminder({ ...S, enableBioimpedanceReminder: v }, daysSinceBioimpedance(S), true)
        }} />
      </Row>
      {S.enableBioimpedanceReminder !== false && <SelectRow icon="calendar" iconTint="var(--orange)" title={t('Reminder frequency')}
        value={S.bioimpedanceReminderDays || 15} onChange={v => update(s => { s.bioimpedanceReminderDays = v })}
        options={[15, 30].map(d => ({ value: d, label: t('Every {0} days', d) }))} />}
      </>}
    </Section>
    </>}

    {/* ---------- 5. social & privacy ---------- */}
    {user && uxOn(S, 'social') && <>
    <h3 className="set-grp">{t('Social & privacy')}<span>{t('What you share, and with whom')}</span></h3>
    <PrivacySummary />
    <Section>
      <Row icon="users" iconTint="var(--blue)" title={t('Social preferences')} subtitle={t('Who sees your activity and what you share')} accessory="chevron" onClick={() => nav('/social/preferences')} />
    </Section>
    </>}

    {/* ---------- 6. notifications ---------- */}
    {(user || MOBILE) && <h3 className="set-grp">{t('Notifications')}<span>{t('Alerts and reminders')}</span></h3>}
    {(user || MOBILE) && <NotificationsCard S={S} update={update} toast={toast} />}

    {/* ---------- 7. data: your copy, in and out ---------- */}
    <h3 className="set-grp">{t('Data')}<span>{t('Your information is yours')}</span></h3>
    <Section footer={t('Take a copy any time, or bring one back.')}>
      {signedIn && <Row icon="download" iconTint="var(--blue)" title={t('Export my data')} subtitle={t('Everything 2J holds about you, as one file')} accessory="chevron" onClick={exportMyData} />}
      <Row icon="download" iconTint="var(--blue)" title={t('Export backup (JSON)')} subtitle={t('Your plan, workouts and body weight')} accessory="chevron" onClick={doExport} />
      <Row icon="upload" iconTint="var(--blue)" title={t('Import backup')} accessory="chevron" onClick={() => fileRef.current.click()} />
    </Section>

    {/* ---------- 8. security ---------- */}
    {signedIn && <>
    <h3 className="set-grp">{t('Security')}<span>{t('Your sessions and your sign-in')}</span></h3>
    <Section footer={t('Your passkeys keep working — sign in with them again anytime.')}>
      <Row icon="shield" iconTint="var(--red)" title={t('Sign out everywhere')} subtitle={t('Ends this profile’s sessions on all your devices.')} danger onClick={signOutEverywhere} />
    </Section>
    </>}

    {/* ---------- 9. advanced: rarely needed, so one entry until opened ---------- */}
    <h3 className="set-grp">{t('Advanced')}</h3>
    <Section>
      <Row icon="wrench" iconTint="var(--grey)" title={t('Data, backups and resets')} subtitle={t('Technical settings and additional options')}
        accessory="chevron" onClick={() => setAdv(v => !v)} className={adv ? 'v3-adv-open' : ''} />
    </Section>
    {adv && <>
    <Section title={t('Advanced options')} footer={t('Start over or bring things in from elsewhere. Rarely needed.')}>
      <Row icon="sparkles" iconTint="var(--acc)" title={t('Load starter plan (PPL)')} accessory="chevron" onClick={loadStarterPlan} />
      <Row icon="shuffle" iconTint="var(--teal)" title={t('Import from another app')}
        subtitle={t('FitNotes, Strong, Hevy, Gravl — or weight, body composition, steps, sleep and heart rate from Apple Health')}
        accessory="chevron" onClick={() => importRef.current.click()} />
      {/* Health's own export is a .zip — iOS auto-extracts a tapped .zip in Files, so this points there rather than adding an in-app unzip step. */}
      <div className="small dim" style={{ padding: '2px 14px 10px' }}>
        {t('From Apple Health: Settings → your name → Export All Health Data, then open the .zip in Files and pick export.xml from inside it.')}
      </div>
      {/* Also drops anything the Coach is holding server-side: a wipe that leaves a pending proposal on the server behind would be a wipe in name only. */}
      <Row icon="trash" iconTint="var(--red)" title={t('Reset everything')} danger onClick={() => confirmSheet({ title: t('Reset everything?'), message: t('Deletes your plan, workouts and body weight on this device. This cannot be undone.'), confirmText: t('Delete everything'), danger: true, onConfirm: () => { if (user) forgetCoach().catch(() => {}); replaceStateOnServer(JSON.parse(JSON.stringify(DEF)), 'reset'); nav('/home'); toast(t('All data reset')) } })} />
    </Section>
    </>}
    <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={doImport} />
    {/* Reset after reading so picking the same file twice still fires onChange. */}
    <input ref={importRef} type="file" accept=".csv,.xml,text/csv,text/xml" style={{ display: 'none' }}
      onChange={ev => { const f = ev.target.files[0]; if (f) importFromApp(f); ev.target.value = '' }} />

    <div className="dim small" style={{ textAlign: 'center', marginTop: 4, lineHeight: 1.6 }}>
      2J Fitness Center · {t('based on openGym')} · {t('free & open source (AGPL v3)')}<br />
      {t('exercise data:')} hasaneyldrm/exercises-dataset (CC)<br />
      <span className="tap" style={{ color: 'var(--acc)', cursor: 'pointer' }}
        onClick={() => useUI.getState().openSheet(() => <ChangelogSheet />)}>{t('Version history')}</span>
      {' · '}
      <span className="tap" style={{ color: 'var(--acc)', cursor: 'pointer' }}
        onClick={() => useUI.getState().openSheet(() => <LegalSheet />)}>{t('Legal & credits')}</span>
    </div>
  </div>
}

// The whole point is that the two scales are one judgement counted from opposite ends, and a
// paragraph is a bad way to say that — the conversion table shows it in one look. Reading down
// a column is the answer to "what do I put here", so the numbers get their own aligned columns.
const EFFORT_ROWS = [
  ['0', '10', 'Nothing left — went to failure'],
  ['1', '9', 'One more rep in the tank'],
  ['2', '8', 'Two more reps'],
  ['3', '7', 'Three more reps'],
  ['4+', '≤6', 'Easy — warm-up territory'],
]
// RIR 2 / RPE 8: the row a working set usually lands on — the anchor the others are read
// against. Not where the stepper starts; + walks up from the bottom of the scale.
const EFFORT_TYPICAL = 2

export function effortHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Effort per set')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5 }}>
      {t('How hard a set was, logged next to weight and reps. Two scales for the same judgement, counted from opposite ends.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('RIR')}</span><span className="n">{t('RPE')}</span><span className="f">{t('How it felt')}</span></div>
      {EFFORT_ROWS.map(([rir, rpe, feel], i) => (
        <div key={rir} className={'r' + (i === EFFORT_TYPICAL ? ' on' : '')}>
          <span className="n">{rir}</span><span className="n">{rpe}</span><span className="f">{t(feel)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, display: 'grid', gap: 8 }}>
      <div>{t('RIR counts the reps you left; RPE reads the same effort off a 10-point scale — so RPE ≈ 10 − RIR. Pick the one you already think in.')}</div>
      <div>{t('The highlighted row is where most working sets land. Sets you have already logged keep their own scale, and nothing else reads the value — progression and estimated 1RM are unaffected.')}</div>
    </div>
    <div style={{ height: 8 }} />
  </>)
}

export function trainingZonesHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Training zones')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {t('Every logged set is placed into one of 5 standard strength-training zones, so you can see at a glance what kind of effort a session is actually made of.')}
    </div>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('How it’s calculated')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Whenever this exercise already has an estimated 1RM (from your best set on record, or a test you logged), the zone comes from the set’s weight as a % of that 1RM — the most direct signal. Without an estimate yet — a brand-new exercise, or one you’ve only trained for very high reps — it falls back to the RIR/RPE you rated the set with instead.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('Zone')}</span><span className="f">{t('Range')}</span></div>
      {ZONES.map(z => (
        <div key={z.id} className="r">
          <span className="n" style={{ color: z.color, fontWeight: 700 }}>{z.short}</span>
          <span className="f">
            <b>{t(z.label)}</b> — {z.pctLabel} 1RM · {t('RIR')} {z.rirLabel} · {z.reps} {t('reps')}
          </span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, marginTop: 14 }}>
      {t('The coloured chip on each set (in the logger), the target-zone picker when planning a routine’s exercise, and the weekly/monthly volume-by-zone chart in Progress all read from the same calculation, and all turn off together with the switch above.')}
    </div>
  </>)
}

export function overloadHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Progression assistant')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('A recommendation for what to aim for next on any exercise you’ve trained before, plus a clear signal the moment you actually beat it.')}
    </div>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('The recommendation')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Before the first set it reads your last sessions of that exercise — reps against the target, the RPE you logged and the jumps your equipment allows — and suggests keeping the weight, adding a rep, adding weight or stepping down, with the reason and how sure it is. “Use recommendation” changes only today’s sets; your trainer’s routine never changes.')}
    </div>
    <h4 className="sec">{t('Beating it')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5 }}>
      {t('A set that matches or beats the equivalent one from last time turns its checkmark green. One that also beats this exercise’s best-ever estimated 1RM turns it gold instead, with “New PR this session!” underneath the sets.')}
    </div>
  </>)
}

export function rpVolumeHelpSheet() {
  useUI.getState().openSheet(close => <>
    <h3>{t('Weekly volume zones')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {t('Muscle growth tracks the number of effective sets a muscle gets in a week, not just how heavy any one of them was — too few and nothing adapts, too many and you can’t recover before the next session. This shows, per muscle group, which of five zones this week’s count actually lands in.')}
    </div>
    <div className="efftbl">
      <div className="r hd"><span className="n">{t('Zone')}</span><span className="f">{t('Meaning')}</span></div>
      {ZONE_ORDER.map(z => (
        <div key={z} className="r">
          <span className="n" style={{ color: ZONE_META[z].color, fontWeight: 700 }}>{ZONE_META[z].code}</span>
          <span className="f">{t(ZONE_META[z].label)}</span>
        </div>
      ))}
    </div>
    <div className="dim small" style={{ lineHeight: 1.5, marginTop: 14 }}>
      {t('Your training level (Beginner / Intermediate / Advanced) picks which set of weekly targets applies — a more experienced lifter tolerates, and needs, more volume to keep growing. Turning this on hides the per-set %1RM/RPE zone chip in the logger — the two are both called “zones” but answer different questions, and showing both at once was more confusing than either alone.')}
    </div>
  </>)
}

function NotificationsCard({ S, update, toast }) {
  if (MOBILE) return <MobileReminderCard S={S} update={update} toast={toast} />
  return <PushCard S={S} update={update} toast={toast} />
}

// Mobile build: the reminder is a native local notification scheduled on planned weekdays —
// no push server involved. The schedule itself is (re)synced by the store on every persist;
// this card only owns the OS permission prompt when the switch turns on.
function MobileReminderCard({ S, update, toast }) {
  const setReminder = patch => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), ...patch, tz: localTZ() } })
  const toggle = async () => {
    const on = !S.reminder?.on
    if (on) {
      const ok = await syncReminder({ ...S, reminder: { ...(S.reminder || DEF.reminder), on: true } }, true)
      if (!ok) { toast(t('Could not change notification settings')); return }
    }
    setReminder({ on })
  }
  return (
    <Section
      footer={S.reminder?.on ? t('Reminds you at this time on days that have a routine planned.') : null}>
      <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
        <Switch checked={!!S.reminder?.on} onChange={toggle} />
      </Row>
      {S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => setReminder({ time: e.target.value })} />
        </Row>
      )}
    </Section>
  )
}

function PushCard({ S, update, toast }) {
  const [on, setOn] = useState(false)
  const [busy, setBusy] = useState(false)
  const supported = pushSupported()

  useEffect(() => {
    if (!supported) return
    navigator.serviceWorker.ready.then(reg => reg.pushManager.getSubscription()).then(sub => setOn(!!sub)).catch(() => {})
  }, [supported])

  const toggle = async v => {
    setBusy(true)
    try {
      if (!v) { await disablePush(); setOn(false); toast(t('Notifications off')) }
      else { await enablePush(); setOn(true); toast(t('Notifications on')) }
    } catch (e) { toast(e.message || t('Could not change notification settings')) }
    setBusy(false)
  }
  const test = async () => {
    try { await sendTestPush(); toast(t('Test sent — should arrive any second')) }
    catch (e) { toast(e.message || t('Test failed')) }
  }

  if (!supported) return (
    <Section>
      <Row icon="bellSlash" iconTint="var(--grey)" title={t('Not supported in this browser.')} />
    </Section>
  )

  return <>
    <Section
      footer={on && S.reminder?.on
        ? t("Only sent on days you have a routine planned and haven't logged a workout yet.") +
          (S.reminder?.tz ? ' ' + t('Timezone: {0} (auto-detected, updates if you travel).', S.reminder.tz) : '')
        : null}
    >
      <Row icon="bell" iconTint="var(--red)" title={t('Push notifications')} subtitle={t('Rest-timer and chat alerts, even if 2J Fitness Center is closed.')}>
        <Switch checked={on} disabled={busy} onChange={toggle} />
      </Row>
      {on && (
        <Row icon="calendar" iconTint="var(--orange)" title={t('Workout day reminder')}>
          <Switch checked={!!S.reminder?.on} onChange={() => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), on: !s.reminder?.on, tz: localTZ() } })} />
        </Row>
      )}
      {on && S.reminder?.on && (
        <Row icon="clock" iconTint="var(--purple)" title={t('Reminder time')}>
          <input type="time" className="timef" value={S.reminder?.time || DEF.reminder.time}
            onChange={e => update(s => { s.reminder = { ...(s.reminder || DEF.reminder), time: e.target.value, tz: localTZ() } })} />
        </Row>
      )}
    </Section>
    {on && <div style={{ marginTop: -12, marginBottom: 22 }}><Button size="sm" icon="bell" onClick={test}>{t('Send test notification')}</Button></div>}
  </>
}
