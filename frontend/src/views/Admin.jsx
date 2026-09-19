import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { fmtDate, fmtNum, fmtVol, fmtDur, ageFrom } from '../lib/format.js'
import { workoutVolume, setsDone } from '../lib/history.js'
import { t, nameFor } from '../lib/i18n.js'
import { confirmSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, ChipSelect, Switch, Row } from '../components/ui.jsx'
import ScanUpload from '../components/ScanUpload.jsx'
import AdminCoach from './AdminCoach.jsx'
import AdminTrainerAI from './AdminTrainerAI.jsx'
import AdminIntegrations from './AdminIntegrations.jsx'
import { EXDB, equipmentOf } from '../lib/exercises.js'
import { MUSCLE_GROUPS, isInMuscleGroup } from '../lib/muscles.js'
import { Thumb } from '../components/Media.jsx'
import { GOALS } from '../lib/starter.js'
import { MUSCLES, MUSCLE_LABEL } from '../lib/muscle-priority.js'
import { MEASUREMENTS, bodyFatBand, visceralFatBand } from '../lib/measurements.js'
import BioimpedanceFields from '../components/BioimpedanceFields.jsx'

// Same labels the member-facing quick-plan sheet (sheets.jsx) uses, so "hypertrophy" means the
// same rep range whether a member or an admin set it up.
const GOAL_LABEL = { hypertrophy: 'Build muscle', toning: 'Tone up', fatloss: 'Lose fat', power: 'Power', plyometrics: 'Plyometrics', longevity: 'Health & longevity' }

// Admin-only operator dashboard (owner passkey + admin flag; guarded again server-side).
// Uses the same t()/locale packs as the rest of the app — an owner running this in Spanish
// should see Spanish here too, not just on the member-facing screens.

export const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - ts) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}
const dur = ms => { const m = Math.max(0, Math.floor(ms / 60000)); return m < 60 ? m + 'm' : Math.floor(m / 60) + 'h' + (m % 60) + 'm' }

function ProfileEditForm({ d, onSaved, close }) {
  const toast = useUI(s => s.toast)
  const [name, setName] = useState(d.user.name)
  const [birthDate, setBirthDate] = useState(d.birthDate || '')
  const [body, setBody] = useState(d.body || 'male')
  const [height, setHeight] = useState(d.height ?? '')
  const [primary, setPrimary] = useState(d.priorityMuscles || [])
  const [secondary, setSecondary] = useState(d.secondaryMuscles || [])
  const [busy, setBusy] = useState(false)
  const togglePrimary = m => {
    setPrimary(v => v.includes(m) ? v.filter(x => x !== m) : v.length < 2 ? [...v, m] : v)
    setSecondary(v => v.filter(x => x !== m))
  }
  const toggleSecondary = m => {
    setSecondary(v => v.includes(m) ? v.filter(x => x !== m) : v.length < 3 ? [...v, m] : v)
    setPrimary(v => v.filter(x => x !== m))
  }
  const save = () => {
    const n = name.trim()
    if (!n) { toast(t('Name required')); return }
    setBusy(true)
    api('/api/admin/user/profile', {
      method: 'POST',
      body: JSON.stringify({
        id: d.user.id, name: n, birthDate: birthDate || null, body, height: height === '' ? null : Number(height),
        priorityMuscles: primary, secondaryMuscles: secondary
      })
    }).then(() => { toast(t('Profile saved')); onSaved(); close() }).catch(e => { toast(e.message); setBusy(false) })
  }
  return <>
    <h3>{t('Edit profile — {0}', d.user.name)}</h3>
    <div className="dim small" style={{ margin: '6px 0 4px' }}>{t('Name')}</div>
    <input className="input" maxLength={40} value={name} onChange={e => setName(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Date of birth')}</div>
    <input type="date" className="input" value={birthDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setBirthDate(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Sex')}</div>
    <Segmented options={[{ value: 'male', label: t('Male') }, { value: 'female', label: t('Female') }]} value={body} onChange={setBody} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Height (cm)')}</div>
    <input type="number" inputMode="decimal" className="input" min="0" max="250" value={height} onChange={e => setHeight(e.target.value)} />
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('What do you want to prioritize? (up to 2)')}</div>
    <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
      {MUSCLES.map(m => <button key={m} className={'chip' + (primary.includes(m) ? ' on' : '')} onClick={() => togglePrimary(m)}>{t(MUSCLE_LABEL[m])}</button>)}
    </div>
    <div className="dim small" style={{ margin: '10px 0 4px' }}>{t('Anything else? (up to 3)')}</div>
    <div className="row" style={{ flexWrap: 'wrap', gap: 7 }}>
      {MUSCLES.map(m => <button key={m} className={'chip' + (secondary.includes(m) ? ' on' : '')} disabled={primary.includes(m)}
        style={primary.includes(m) ? { opacity: .35 } : undefined} onClick={() => toggleSecondary(m)}>{t(MUSCLE_LABEL[m])}</button>)}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="primary" disabled={busy} onClick={save}>{t('Save')}</Button>
  </>
}

// Admin-assisted recovery: a member who lost their only device gets a short-lived, single-use
// link that registers a new passkey onto their EXISTING account instead of a password reset —
// see api/server.js's /api/admin/user/recovery-link and /api/recover/* for the full rationale.
// Meant to be generated with the member standing there (AirDrop it, show the screen, read out
// the code) — 15 minutes is deliberately too tight to send ahead of time.
function RecoveryLinkSheet({ u, close }) {
  const toast = useUI(s => s.toast)
  const [link, setLink] = useState(null)
  const [qr, setQr] = useState(null)
  const [busy, setBusy] = useState(false)
  const gen = () => {
    setBusy(true)
    setQr(null)
    api('/api/admin/user/recovery-link', { method: 'POST', body: JSON.stringify({ id: u.id }) })
      .then(async ({ token }) => {
        const url = `${location.origin}/#/recover?token=${token}`
        setLink(url)
        navigator.clipboard?.writeText(url).catch(() => {})
        toast(t('Link created & copied'))
        // Loaded on demand — this is the only screen in the app that draws a QR code, so it
        // isn't worth adding to everyone else's initial download.
        try {
          const { default: QRCode } = await import('qrcode')
          setQr(await QRCode.toDataURL(url, { margin: 1, width: 240 }))
        } catch { /* link + copy still work without it */ }
      })
      .catch(e => toast(e.message))
      .finally(() => setBusy(false))
  }
  return <>
    <h3>{t('Recovery link for {0}', u.name)}</h3>
    <div className="muted small" style={{ marginBottom: 14, lineHeight: 1.5 }}>
      {t('Hand this to them in person — it lets them add a new passkey to this exact account, nothing is lost. Works once, expires in 15 minutes.')}
    </div>
    {qr && <div style={{ textAlign: 'center', marginBottom: 14 }}>
      <img src={qr} alt={t('QR code for the recovery link')} width={200} height={200} style={{ borderRadius: 10, background: '#fff', padding: 8 }} />
      <div className="dim small" style={{ marginTop: 6 }}>{t('Let them scan it with their own phone')}</div>
    </div>}
    {link && <>
      <div className="input" style={{ wordBreak: 'break-all', fontSize: '.82rem', fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', cursor: 'pointer' }}
        onClick={() => { navigator.clipboard?.writeText(link).catch(() => {}); toast(t('Copied')) }}>{link}</div>
      <div style={{ height: 12 }} />
    </>}
    <Button variant="primary" icon="key" disabled={busy} onClick={gen}>{t(link ? 'Generate a new link' : 'Generate link')}</Button>
    {link && <div className="dim small" style={{ marginTop: 10 }}>{t('Generating a new link retires this one.')}</div>}
    <div style={{ height: 8 }} />
    <Button onClick={close}>{t('Done')}</Button>
  </>
}

// One staff-run assessment (this gym's Tanita scan, plus a caliper pass) gives several readings
// at once — body fat, muscle mass, water, visceral fat, bone mass, and the four skinfolds — so
// this is one form for all of them rather than the member-facing measurementSheet's
// one-value-at-a-time (sheets.jsx), which fits a tape-measure reading taken whenever, not a
// single assessment session. Leaving a field blank keeps whatever that member already had for
// it — a scan that dropped one reading shouldn't force staff to guess the others.
function BioimpedanceSheet({ u, current, latestWeight, onSaved, close }) {
  const toast = useUI(s => s.toast)
  const composition = MEASUREMENTS.filter(m => m.group === 'composition')
  const segments = MEASUREMENTS.filter(m => m.group === 'segments')
  const folds = MEASUREMENTS.filter(m => m.group === 'folds')
  const all = [...composition, ...segments, ...folds]
  const [vals, setVals] = useState(() => Object.fromEntries(all.map(m => [m.key, current?.[m.key]?.v ?? ''])))
  const [weight, setWeight] = useState(latestWeight ?? '')
  const [scanned, setScanned] = useState(0)   // also doubles as BioimpedanceFields' resetToken
  const [busy, setBusy] = useState(false)
  // Local to this sheet, not a profile preference — several trainers may share this dashboard
  // on one device, so "remembering" a %/kg choice across sessions here would mean remembering
  // whichever staff member last used it, not this one.
  const [unitMode, setUnitModeState] = useState({ fat: 'canonical', muscle: 'canonical' })
  const setUnitMode = (k, v) => setUnitModeState(s => ({ ...s, [k]: v }))
  const set = (k, v) => setVals(s => ({ ...s, [k]: v }))
  const applyScan = values => {
    setVals(s => ({ ...s, ...Object.fromEntries(all.filter(m => values[m.key] != null).map(m => [m.key, values[m.key]])) }))
    if (values.weight != null) setWeight(values.weight)
    setScanned(n => n + 1)
    toast(t('Report read — check the values below'))
  }
  const save = () => {
    const values = {}
    for (const m of all) { if (vals[m.key] !== '' && vals[m.key] != null) values[m.key] = Number(vals[m.key]) }
    const w = weight !== '' && weight != null ? Number(weight) : undefined
    if (!Object.keys(values).length && w === undefined) { toast(t('Enter at least one value')); return }
    setBusy(true)
    api('/api/admin/user/measurements', { method: 'POST', body: JSON.stringify({ id: u.id, values, weight: w }) })
      .then(() => { toast(t('Measurements saved')); onSaved(); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }
  return <>
    <h3>{t('Bioimpedance scan — {0}', u.name)}</h3>
    <div className="row between" style={{ marginBottom: 12 }}>
      <div className="muted small" style={{ lineHeight: 1.5, flex: 1 }}>{t('Leave a field blank to leave that reading as it was.')}</div>
      <ScanUpload onResult={applyScan} />
    </div>
    {scanned > 0 && <div className="small" style={{ color: 'var(--acc)', marginBottom: 10 }}>{t('Estimated by AI — review before saving.')}</div>}
    <div style={{ marginBottom: 10 }}>
      <div className="dim small" style={{ marginBottom: 4 }}>{t('Weight')}</div>
      <input type="number" inputMode="decimal" className="input" step={0.1} min={20} max={400}
        placeholder="— kg" value={weight} onChange={e => setWeight(e.target.value)} />
      <div className="dim small" style={{ marginTop: 3 }}>{t('Used to convert % ↔ kg below.')}</div>
    </div>
    <BioimpedanceFields vals={vals} setVal={set} weightKg={Number(weight) || null}
      unitMode={unitMode} setUnitMode={setUnitMode} showFolds resetToken={scanned} />
    <div style={{ height: 6 }} />
    <Button variant="primary" disabled={busy} onClick={save}>{t('Save')}</Button>
  </>
}

function StarterPlanSheet({ u, onApplied, close }) {
  const toast = useUI(s => s.toast)
  const [goal, setGoal] = useState('longevity')
  const [days, setDays] = useState(3)
  const [busy, setBusy] = useState(false)
  const apply = () => {
    setBusy(true)
    api('/api/admin/user/apply-starter-plan', { method: 'POST', body: JSON.stringify({ id: u.id, goal, days }) })
      .then(() => { toast(t('Starter plan added')); onApplied(); close() })
      .catch(e => { toast(e.message); setBusy(false) })
  }
  return <>
    <h3>{t('Load the PPL starter plan for {0}?', u.name)}</h3>
    <div className="muted small" style={{ margin: '6px 0 10px' }}>{t('Adds Push/Pull/Legs routines on top of whatever they already have.')}</div>
    <div className="dim small" style={{ marginBottom: 6 }}>{t('What are you training for?')}</div>
    <div className="sect-b">
      {GOALS.map(g => <button key={g} className="lrow tap" onClick={() => setGoal(g)}>
        <span className="lrow-m"><span className="lrow-t">{t(GOAL_LABEL[g])}</span></span>
        {goal === g && <Icon name="check" className="lrow-k" />}
      </button>)}
    </div>
    <div className="dim small" style={{ margin: '14px 0 6px' }}>{t('How many days a week?')}</div>
    <Segmented options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={days} onChange={setDays} />
    <div style={{ height: 14 }} />
    <Button variant="primary" icon="sparkles" disabled={busy} onClick={apply}>{t('Load plan')}</Button>
  </>
}

export function UserDetail({ id, onChanged, close }) {
  const [d, setD] = useState(null)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const load = () => api('/api/admin/user?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return <div className="muted small">{t('Loading…')}</div>
  const u = d.user
  const setDisabled = disabled => {
    api('/api/admin/user/disable', { method: 'POST', body: JSON.stringify({ id: u.id, disabled }) })
      .then(() => { toast(disabled ? t('User disabled') : t('User enabled')); onChanged(); close() })
      .catch(e => toast(e.message))
  }
  const setTrainer = trainer => {
    api('/api/admin/user/trainer', { method: 'POST', body: JSON.stringify({ id: u.id, trainer }) })
      .then(() => { toast(trainer ? t('Now a trainer') : t('No longer a trainer')); load() })
      .catch(e => toast(e.message))
  }
  const applyStarterPlan = () => openSheet(close2 => <StarterPlanSheet u={u} onApplied={load} close={close2} />)
  const setFeature = (key, value) => {
    setD(dd => ({ ...dd, [key]: value }))   // optimistic — this member's own toggle already works this way
    api('/api/admin/user/features', { method: 'POST', body: JSON.stringify({ id: u.id, [key]: value }) }).catch(e => { toast(e.message); load() })
  }
  const age = ageFrom(d.birthDate)
  return <>
    <h3 className="capitalize">{u.name}</h3>
    <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '8px 0 12px' }}>
      {u.admin && <span className="tag acc">{t('admin')}</span>}
      {!u.admin && u.trainer && <span className="tag acc">{t('trainer')}</span>}
      {u.disabled && <span className="tag" style={{ color: 'var(--red)' }}>{t('disabled')}</span>}
      {u.invitedBy && <span className="tag">{t('invite {0}', u.invitedBy)}</span>}
      <span className="tag">{t('joined {0}', u.created ? fmtDate(u.created.slice(0, 10)) : '—')}</span>
    </div>
    <div className="tiles" style={{ textAlign: 'left' }}>
      <div className="tile"><div className="l">{t('Age')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{age ?? '—'}</div></div>
      <div className="tile"><div className="l">{t('Sex')}</div><div className="v capitalize" style={{ fontSize: '1.1rem' }}>{t(d.body === 'female' ? 'Female' : 'Male')}</div></div>
      <div className="tile"><div className="l">{t('Height')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.height ? d.height + ' cm' : '—'}</div></div>
      <div className="tile"><div className="l">{t('Weight')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.latestWeight ? fmtNum(d.latestWeight.w) + ' ' + d.unit : '—'}</div></div>
      <div className="tile"><div className="l">{t('Workouts')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.workouts.length}</div></div>
      <div className="tile"><div className="l">{t('Weigh-ins')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.bodyweight.length}</div></div>
      <div className="tile"><div className="l">{t('Routines')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.routines.length}</div></div>
      <div className="tile"><div className="l">{t('Last sync')}</div><div className="v" style={{ fontSize: '.95rem' }}>{rel(d.lastSync)}</div></div>
    </div>
    {!!(d.priorityMuscles?.length || d.secondaryMuscles?.length) && <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 0' }}>
      {(d.priorityMuscles || []).map(m => <span key={m} className="tag acc">{t(MUSCLE_LABEL[m])}</span>)}
      {(d.secondaryMuscles || []).map(m => <span key={m} className="tag">{t(MUSCLE_LABEL[m])}</span>)}
    </div>}
    {!!Object.keys(d.measurements || {}).length && <div className="row" style={{ gap: 6, flexWrap: 'wrap', margin: '10px 0 0' }}>
      {MEASUREMENTS.filter(m => d.measurements?.[m.key]).map(m => {
        const band = m.key === 'bodyFat' ? bodyFatBand(d.measurements[m.key].v, d.body, age)
          : m.key === 'visceralFat' ? visceralFatBand(d.measurements[m.key].v)
          : null
        return <span key={m.key} className={'tag' + (band ? ' ' + band : '')}>{t(m.label)}: {fmtNum(d.measurements[m.key].v)} {m.unit}</span>
      })}
    </div>}
    <div className="list" style={{ margin: '12px 0 4px' }}>
      <Row icon="target" iconTint="var(--purple)" title={t('Training zones')}>
        <Switch checked={d.enableTrainingZones !== false} onChange={v => setFeature('enableTrainingZones', v)} />
      </Row>
      <Row icon="chartLine" iconTint="var(--orange)" title={t('Weekly volume zones')}>
        <Switch checked={!!d.enableRpVolumeZones} onChange={v => setFeature('enableRpVolumeZones', v)} />
      </Row>
    </div>
    <div className="row" style={{ gap: 8, margin: '12px 0 4px' }}>
      <Button style={{ flex: 1 }} icon="pencil" onClick={() => openSheet(close2 => <ProfileEditForm d={d} onSaved={load} close={close2} />)}>{t('Edit profile')}</Button>
      {!d.routines.length && <Button style={{ flex: 1 }} icon="sparkles" onClick={applyStarterPlan}>{t('Load PPL plan')}</Button>}
    </div>
    <Button style={{ width: '100%', margin: '0 0 4px' }} icon="chart"
      onClick={() => openSheet(close2 => <BioimpedanceSheet u={u} current={d.measurements} latestWeight={d.latestWeight?.w} onSaved={load} close={close2} />)}>{t('Log bioimpedance scan')}</Button>
    <Button style={{ width: '100%', margin: '0 0 4px' }} icon="key"
      onClick={() => openSheet(close2 => <RecoveryLinkSheet u={u} close={close2} />)}>{t('Recover access (lost device)')}</Button>
    {!u.admin && <Button style={{ width: '100%', margin: '0 0 4px' }} icon="person" variant={u.trainer ? 'tinted' : 'plain'}
      onClick={() => setTrainer(!u.trainer)}>{u.trainer ? t('Remove trainer role') : t('Make trainer')}</Button>}
    {!u.admin && <button className={'btn ' + (u.disabled ? 'primary' : 'danger')} style={{ margin: '4px 0 4px' }}
      onClick={() => u.disabled ? setDisabled(false)
        : confirmSheet({ title: t('Disable {0}?', u.name), message: t('They are signed out everywhere and can no longer sync or log in until re-enabled.'), confirmText: t('Disable'), danger: true, onConfirm: () => setDisabled(true) })}>
      {u.disabled ? t('Enable account') : t('Disable account')}</button>}
    <h4 className="sec">{t('Workout history')}</h4>
    {d.workouts.length ? <div className="list" style={{ gap: 0 }}>
      {d.workouts.slice(0, 60).map(w => <div key={w.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div><div className="small" style={{ fontWeight: 600 }}>{w.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{fmtDate(w.d, true)} · {fmtDur((w.end || w.start) - w.start)} · {t('{0} sets', setsDone(w))}{w.prs?.length ? ' · ' + t('{0} PR', w.prs.length) : ''}</div></div>
        <span className="small muted">{fmtVol(w.vol ?? workoutVolume(w), d.unit)}</span>
      </div>)}
    </div> : <div className="empty small">{t('No workouts logged.')}</div>}
  </>
}

// Sheet content — opened from the compact "Invite codes" nav card below.
function InvitesSheet({ invites, reload }) {
  const toast = useUI(s => s.toast)
  const gen = () => api('/api/admin/invites/new', { method: 'POST', body: '{}' })
    .then(({ invite }) => { navigator.clipboard?.writeText(invite.code).catch(() => {}); toast(t('Code {0} created & copied', invite.code)); reload() })
    .catch(e => toast(e.message))
  const revoke = code => api('/api/admin/invites/revoke', { method: 'POST', body: JSON.stringify({ code }) })
    .then(() => { toast(t('Code revoked')); reload() }).catch(e => toast(e.message))
  const open = (invites || []).filter(i => !i.usedBy)
  const used = (invites || []).filter(i => i.usedBy)
  return <>
    <div className="row between"><h3 style={{ margin: 0 }}>{t('Invite codes')}</h3>
      <Button variant="primary" size="sm" onClick={gen} icon="plus">{t('Generate')}</Button></div>
    <div className="small muted" style={{ margin: '6px 0 10px' }}>{t('{0} unused · {1} redeemed', open.length, used.length)}</div>
    {open.map(i => <div key={i.code} className="row between" style={{ padding: '7px 2px', borderBottom: '1px solid var(--sep)' }}>
      <span style={{ fontFamily: 'ui-monospace,SFMono-Regular,Menlo,monospace', fontWeight: 500, letterSpacing: '.06em' }}
        onClick={() => { navigator.clipboard?.writeText(i.code).catch(() => {}); toast(t('Copied {0}', i.code)) }}>{i.code}</span>
      <button className="iconbtn" style={{ width: 32, height: 30, borderRadius: 8, fontSize: 15, color: 'var(--red)' }} onClick={() => revoke(i.code)} aria-label={t('revoke')}><Icon name="trash" /></button>
    </div>)}
    {used.map(i => <div key={i.code} className="row between dim" style={{ padding: '7px 2px', fontSize: '.8rem' }}>
      <span style={{ fontFamily: 'monospace' }}>{i.code}</span><span>→ {i.usedByName || t('used')}</span>
    </div>)}
    {!open.length && !used.length && <div className="dim small">{t('No codes yet — generate one to invite someone.')}</div>}
    <div style={{ height: 8 }} />
  </>
}

/* ============================ exercise blacklist ============================ */
// Gym-wide: equipment this location doesn't have, or movements the owner would rather not
// offer, hidden from every member's search/picker everywhere in the app. Not a deletion — the
// 1324-exercise catalogue itself never changes, and a hidden id still resolves fine for
// anyone who already has it logged or in a routine (see lib/exercises.js).
function ExerciseLibrarySheet({ initialHidden, close }) {
  const toast = useUI(s => s.toast)
  const [hidden, setHidden] = useState(initialHidden)   // owns its own copy so toggles repaint immediately
  const [q, setQ] = useState('')
  const [grp, setGrp] = useState('')
  const [shown, setShown] = useState(60)
  const ql = q.toLowerCase().trim()
  const base = EXDB.filter(e =>
    (grp === 'cardio' ? e.bp === 'cardio' : !grp || isInMuscleGroup(e, grp)) &&
    (!ql || e.n.toLowerCase().includes(ql) || nameFor(e).toLowerCase().includes(ql)))
  const toggle = (id, hide) => {
    const next = new Set(hidden); hide ? next.add(id) : next.delete(id); setHidden(next)   // optimistic
    api('/api/admin/exercises/hidden', { method: 'POST', body: JSON.stringify({ id, hidden: hide }) })
      .catch(e => { toast(e.message); setHidden(hidden) })   // roll back on failure
  }
  return <>
    <h3>{t('Exercise library')}</h3>
    <div className="dim small" style={{ marginBottom: 10 }}>{t('{0} of {1} hidden from members. Hiding one doesn’t delete it — anyone who already has it stays unaffected.', hidden.size, EXDB.length)}</div>
    <div className="search">
      <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} exercises…', EXDB.length)} value={q} onChange={e => { setQ(e.target.value); setShown(60) }} />
    </div>
    <div className="chips" style={{ margin: '10px 0' }}>
      <button className={'chip nocap' + (!grp ? ' on' : '')} onClick={() => { setGrp(''); setShown(60) }}>{t('All')}</button>
      <ChipSelect value={grp} onChange={g => { setGrp(g); setShown(60) }} sheetTitle={t('Muscle group')} placeholder={t('Muscle group')}
        options={[...MUSCLE_GROUPS.map(g => ({ value: g.key, label: t(g.name) })), { value: 'cardio', label: t('Cardio') }]} />
    </div>
    <div className="list">
      {base.slice(0, shown).map(e => {
        const isHidden = hidden.has(e.id)
        return <div key={e.id} className="item" onClick={() => toggle(e.id, !isHidden)} style={isHidden ? { opacity: .5 } : null}>
          <Thumb ex={e} />
          <div className="grow"><div className="tt capitalize">{nameFor(e)}</div><div className="ss capitalize">{t(e.tg || e.bp)} · {t(e.eq)}</div></div>
          <span className={'tag' + (isHidden ? '' : ' acc')}>{isHidden ? t('Hidden') : t('Visible')}</span>
        </div>
      })}
    </div>
    {base.length > shown && <><div style={{ height: 8 }} /><Button onClick={() => setShown(s => s + 60)}>{t('Show more')}</Button></>}
    <div style={{ height: 12 }} />
    <Button variant="primary" onClick={() => close(hidden)}>{t('Done')}</Button>
  </>
}

// A reusable "featured" nav card — a big colored icon, title (+ optional tag), a one-line
// subtitle, and a chevron. Used for the handful of admin sections important/frequent enough to
// live at the top of the dashboard instead of buried in the day-to-day scroll (Trainer panel,
// Members, Invite codes, Exercise library) — each group gets its own tint so they read as a
// deliberate row of shortcuts, not just more cards.
function AdminNavCard({ icon, tint, title, tag, sub, onClick }) {
  return <div className="card row between" style={{
    cursor: 'pointer', gap: 14,
    border: `1.5px solid ${tint}`,
    background: `color-mix(in srgb, ${tint} 9%, var(--surface))`
  }} onClick={onClick}>
    <div className="row" style={{ gap: 14, minWidth: 0 }}>
      <span className="lrow-i" style={{ '--tint': tint, width: 46, height: 46, borderRadius: 14, fontSize: 22, flex: 'none' }}>
        <Icon name={icon} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <h2 style={{ margin: '0 2px 2px 0', fontSize: 17, fontWeight: 600, color: 'var(--label)', textTransform: 'none' }}>{title}</h2>
          {tag && <span className="tag" style={{ background: `color-mix(in srgb, ${tint} 20%, transparent)`, color: tint }}>{tag}</span>}
        </div>
        <div className="dim small">{sub}</div>
      </div>
    </div>
    <Icon name="chevronRight" className="chev" style={{ flex: 'none' }} />
  </div>
}

function ExerciseLibraryNav() {
  const openSheet = useUI(s => s.openSheet)
  const [hidden, setHidden] = useState(null)   // Set of ids, once loaded
  useEffect(() => { api('/api/admin/exercises/hidden').then(d => setHidden(new Set(d.hidden))).catch(() => setHidden(new Set())) }, [])
  if (hidden === null) return null
  return <AdminNavCard icon="barbell" tint="var(--blue)" title={t('Exercise library')}
    sub={hidden.size ? t('{0} of {1} hidden from members.', hidden.size, EXDB.length) : t('{0} of {1} hidden from members — full catalogue is visible.', hidden.size, EXDB.length)}
    onClick={() => openSheet(closeFn => <ExerciseLibrarySheet initialHidden={hidden} close={h => { setHidden(h); closeFn() }} />, { wide: true })} />
}

export default function Admin() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [users, setUsers] = useState(null)
  const [invites, setInvites] = useState(null)
  const [inviteOnly, setInviteOnly] = useState(false)
  const [recoveryRequests, setRecoveryRequests] = useState(null)

  const loadUsers = () => api('/api/admin/users').then(d => { setUsers(d.users); setInviteOnly(d.invite_only) }).catch(e => toast(e.message || t('Failed to load')))
  const loadInvites = () => api('/api/admin/invites').then(d => setInvites(d.invites)).catch(() => {})
  const loadRecoveryRequests = () => api('/api/admin/recovery-requests').then(d => setRecoveryRequests(d.requests)).catch(() => {})
  // poll every 15s so the "training now" section (and any new recovery request) stays live
  // without a manual refresh
  useEffect(() => { if (!user?.admin) return; loadUsers(); loadInvites(); loadRecoveryRequests(); const iv = setInterval(() => { loadUsers(); loadRecoveryRequests() }, 15000); return () => clearInterval(iv) }, [])
  if (!user?.admin) return null

  const resolveRecovery = id => api('/api/admin/recovery-requests/resolve', { method: 'POST', body: JSON.stringify({ id }) })
    .then(loadRecoveryRequests).catch(e => toast(e.message))

  const openUser = id => openSheet(close => <UserDetail id={id} onChanged={loadUsers} close={close} />)
  const liveUsers = (users || []).filter(u => u.live)
  const activeCount = (users || []).filter(u => u.lastSync && Date.now() - u.lastSync < 7 * 86400000).length
  const disabledCount = (users || []).filter(u => u.disabled).length

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 style={{ margin: 0 }}>{t('Admin')}</h1>
        <div className="sub">{users ? t('{0} users · {1} active this week', users.length, activeCount) : t('Loading…')}</div></div>
      <button className="iconbtn" onClick={() => { loadUsers(); loadInvites() }} aria-label={t('refresh')}>↻</button>
    </div>

    <div className="tiles" style={{ marginBottom: 12 }}>
      <div className="tile"><div className="l">{t('Users')}</div><div className="v">{users ? users.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Training now')}</div><div className="v" style={{ color: liveUsers.length ? 'var(--acc)' : undefined }}>{users ? liveUsers.length : '—'}</div></div>
      <div className="tile"><div className="l">{t('Active 7d')}</div><div className="v">{users ? activeCount : '—'}</div></div>
      <div className="tile"><div className="l">{t('Disabled')}</div><div className="v">{users ? disabledCount : '—'}</div></div>
    </div>

    {liveUsers.length > 0 && <div className="card" style={{ borderColor: 'var(--acc)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="dot" style={{ fontSize: 10, color: 'var(--green)' }} />{t('Training now')}</h2>
      {liveUsers.map(u => <div key={u.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)' }} onClick={() => openUser(u.id)}>
        <div><div className="small" style={{ fontWeight: 600 }}>{u.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{t('{0} · ex {1}/{2} · {3}/{4} sets', u.live.name, u.live.exIdx, u.live.exTotal, u.live.setsDone, u.live.setsTotal)}</div></div>
        <span className="tag acc">{dur(Date.now() - u.live.startedAt)}</span>
      </div>)}
    </div>}

    {!!recoveryRequests?.length && <div className="card" style={{ border: '1.5px solid var(--orange)' }}>
      <h2 className="row" style={{ margin: '0 0 8px', gap: 6 }}><Icon name="key" style={{ fontSize: 15, color: 'var(--orange)' }} />{t('Lost passkey requests')}</h2>
      {recoveryRequests.map(r => <div key={r.id} className="row between" style={{ padding: '8px 2px', borderBottom: '1px solid var(--sep)', gap: 10 }}>
        <div style={{ minWidth: 0 }}>
          <div className="small" style={{ fontWeight: 600 }}>{r.name}</div>
          <div className="dim" style={{ fontSize: '.72rem' }}>{r.matchedUserName ? t('matches {0}', r.matchedUserName) : t('no exact match — check Members')} · {rel(r.at)}</div>
        </div>
        <div className="row" style={{ gap: 6, flex: 'none' }}>
          {r.matchedUserId && <Button size="sm" icon="key" onClick={() => openUser(r.matchedUserId)}>{t('Open')}</Button>}
          <button className="iconbtn" onClick={() => resolveRecovery(r.id)} aria-label={t('Dismiss')} title={t('Dismiss')}><Icon name="xmark" /></button>
        </div>
      </div>)}
    </div>}

    <AdminNavCard icon="dumbbell" tint="var(--indigo)" title={t('Trainer panel')} tag={t('Desktop')}
      sub={t('Build and assign routines for your members — best used on a computer.')} onClick={() => nav('/trainer')} />

    <AdminNavCard icon="users" tint="var(--blue)" title={t('Members')}
      sub={users ? t('{0} users · {1} active this week', users.length, activeCount) : t('Loading…')} onClick={() => nav('/admin/members')} />

    <AdminNavCard icon="link" tint="var(--blue)" title={t('Invite codes')}
      sub={invites ? t('{0} unused · {1} redeemed', invites.filter(i => !i.usedBy).length, invites.filter(i => i.usedBy).length) : t('Loading…')}
      onClick={() => openSheet(close => <InvitesSheet invites={invites} reload={loadInvites} close={close} />)} />

    <AdminNavCard icon="dumbbell" tint="var(--acc)" title={t('Room admin')}
      sub={t('Manage who’s checked into the Bunker and the room screen’s own settings')} onClick={() => nav('/admin/bunker')} />

    <ExerciseLibraryNav />

    <AdminCoach />

    <AdminTrainerAI />

    <AdminIntegrations />
  </div>
}
