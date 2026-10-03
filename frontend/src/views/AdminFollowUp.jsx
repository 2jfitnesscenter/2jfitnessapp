// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { MEASUREMENTS } from '../lib/measurements.js'
import { PAIN_ZONE } from '../lib/checkin.js'
import { Button, Row, SelectRow } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { Surface, Pill, Stat } from '../components/v2.jsx'

// Seguimiento V2 — staff follow-up card inside the admin member detail. Server:
// api/lib/followup.js (admin-only; check-ins only when the member shared them). Everything
// shown is a count, a date or a difference — no scores, no verdicts, no diagnosis.

const TEMPLATE_LABEL = { basic: 'Basic', intermediate: 'Intermediate', pro: 'Pro', custom: 'Custom' }
const TEMPLATE_SUB = {
  basic: 'Weight and waist',
  intermediate: 'Weight, main tape measurements and body fat',
  pro: 'Full bioimpedance with segments, plus skinfolds',
  custom: 'Choose the readings',
}
const CADENCE_LABEL = { weekly: 'Weekly', biweekly: 'Every two weeks', monthly: 'Monthly', custom: 'Custom' }
const MEAS = Object.fromEntries(MEASUREMENTS.map(m => [m.key, m]))
const signed = n => (n > 0 ? '+' : '') + fmtNum(n)

export function alertText(a) {
  if (a.code === 'review_overdue') return t('Review overdue by {0} days', a.days)
  if (a.code === 'no_workouts_yet') return t('No workouts logged yet')
  if (a.code === 'no_recent_workouts') return t('No workouts in the last {0} days', a.days)
  if (a.code === 'high_fatigue') return t('High fatigue reported {0} times in 14 days', a.n)
  if (a.code === 'repeated_discomfort') return t('Discomfort in {0} reported {1} times in 14 days', t(PAIN_ZONE[a.zone]?.label || a.zone).toLowerCase(), a.n)
  return a.code
}

function FollowUpSetup({ id, current, onSaved, close }) {
  const toast = useUI(s => s.toast)
  const [template, setTemplate] = useState(current?.template || 'basic')
  const [keys, setKeys] = useState(current?.template === 'custom' ? current.keys || [] : ['waist'])
  const [cadence, setCadence] = useState(current?.cadence || 'monthly')
  const [days, setDays] = useState(current?.days || 21)
  const [busy, setBusy] = useState(false)
  const save = () => {
    setBusy(true)
    api('/api/admin/user/followup', { method: 'POST', body: JSON.stringify({ id, template, keys, cadence, days }) })
      .then(() => { toast(t('Follow-up saved')); onSaved(); close() })
      .catch(e => toast(e.message)).finally(() => setBusy(false))
  }
  const toggle = k => setKeys(ks => ks.includes(k) ? ks.filter(x => x !== k) : [...ks, k])
  return <>
    <h3>{t('Follow-up')}</h3>
    <h4 className="sec">{t('Assessment template')}</h4>
    <div className="list">
      {Object.keys(TEMPLATE_LABEL).map(k => <Row key={k} icon={template === k ? 'check' : 'clipboard'} iconTint={template === k ? 'var(--acc)' : 'var(--grey)'}
        title={t(TEMPLATE_LABEL[k])} subtitle={t(TEMPLATE_SUB[k])} onClick={() => setTemplate(k)} />)}
    </div>
    {template === 'custom' && <div className="ci-zones" style={{ margin: '10px 0' }}>
      {MEASUREMENTS.map(m => <button key={m.key} className={'chip' + (keys.includes(m.key) ? ' on' : '')} aria-pressed={keys.includes(m.key)} onClick={() => toggle(m.key)}>{t(m.label)}</button>)}
    </div>}
    <h4 className="sec">{t('Review frequency')}</h4>
    <div className="list">
      <SelectRow icon="calendar" iconTint="var(--blue)" title={t('Reviews')} value={cadence} onChange={setCadence}
        options={Object.keys(CADENCE_LABEL).map(k => ({ value: k, label: t(CADENCE_LABEL[k]) }))} />
      {cadence === 'custom' && <SelectRow icon="calendar" iconTint="var(--blue)" title={t('Every')} value={days} onChange={setDays}
        options={Array.from({ length: 118 }, (_, i) => i + 3).map(v => ({ value: v, label: t('{0} days', v) }))} />}
    </div>
    <Button variant="primary" style={{ width: '100%', marginTop: 14 }} disabled={busy || (template === 'custom' && !keys.length)} onClick={save}>{t('Save follow-up')}</Button>
  </>
}

export default function AdminFollowUp({ id }) {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const load = () => api('/api/admin/user/followup?id=' + encodeURIComponent(id)).then(setD).catch(e => toast(e.message))
  useEffect(() => { load() }, [id])
  if (!d) return null
  const f = d.followUp, s = d.summary
  const setup = () => openSheet(close => <FollowUpSetup id={id} current={f} onSaved={load} close={close} />)
  const review = () => api('/api/admin/user/review', { method: 'POST', body: JSON.stringify({ id }) })
    .then(() => { toast(t('Review recorded')); load() }).catch(e => toast(e.message))
  const stop = () => api('/api/admin/user/followup', { method: 'POST', body: JSON.stringify({ id, stop: true }) })
    .then(() => { toast(t('Follow-up stopped')); load() }).catch(e => toast(e.message))
  const last = f?.reviews?.length ? f.reviews[f.reviews.length - 1].d : null
  const overdue = d.alerts.some(x => x.code === 'review_overdue')
  const today = new Date().toISOString().slice(0, 10)
  const status = !f ? '' : overdue ? 'overdue' : s.nextReview && s.nextReview <= today ? 'due' : ''
  return <section className="fu">
    <h4 className="sec">{t('Follow-up')}</h4>
    {!f ? <div className="card fu-empty">
      <div className="muted small">{t('No follow-up yet. Choose an assessment template and how often to review.')}</div>
      <Button icon="plus" onClick={setup}>{t('Start follow-up')}</Button>
    </div> : <Surface className={'v2-fu v2-fu-staff ' + status}>
      <div className="v2-fu-top">
        <span className="v2-fu-ic"><Icon name={overdue ? 'bell' : 'calendar'} /></span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="v2-fu-when">{s.nextReview ? t('Next {0}', fmtDate(s.nextReview)) : t('Follow-up')}</div>
          <div className="v2-fu-sub">{last ? t('Last review {0}', fmtDate(last)) : t('Started {0}', fmtDate(f.startedAt))}</div>
        </div>
      </div>
      <div className="v2-fu-chips">
        <Pill tone="acc">{t(TEMPLATE_LABEL[f.template])}</Pill>
        <Pill>{f.cadence === 'custom' ? t('Every {0} days', f.days) : t(CADENCE_LABEL[f.cadence])}</Pill>
      </div>
      {!!d.alerts.length && <ul className="v2-fu-alerts">{d.alerts.map((a, i) => <li key={i}><Icon name="info" />{alertText(a)}</li>)}</ul>}
      <div className="v2-eyebrow">{t('Since {0}', fmtDate(s.from))}</div>
      <div className="v2-fu-facts">
        <Stat value={s.workouts} label={t('workouts')} />
        <Stat value={fmtNum(s.perWeek)} label={s.plannedPerWeek ? t('per week · {0} planned', s.plannedPerWeek) : t('per week')} />
        <Stat value={s.prs} label={t('PRs')} />
        {s.weight && <Stat value={fmtNum(s.weight.end)} label={s.weight.delta != null ? t('kg · {0} since {1}', signed(s.weight.delta), fmtDate(s.weight.startDate)) : t('kg · one reading')} />}
      </div>
      {!!f.keys.length && <div className="v2-fu-meas">
        {f.keys.map(k => {
          const m = s.measurements[k], def = MEAS[k]
          return <div key={k} className="v2-fu-mrow"><span>{t(def?.label || k)}</span>
            <b>{m ? fmtNum(m.end) + ' ' + (def?.unit || '') : '—'}</b>
            <em>{m?.delta != null ? signed(m.delta) : m ? t('one reading') : t('not measured')}</em></div>
        })}
      </div>}
      {s.checkins ? <div className="fu-ci">
        <div className="fu-h">{t('Check-ins shared by the member ({0})', s.checkins.count)}</div>
        {s.checkins.count > 0 && <div className="ci-line">
          <span>{t('Energy')} <b>{fmtNum(s.checkins.avg.energy ?? 0)}</b>/5</span>
          <span>{t('Sleep')} <b>{fmtNum(s.checkins.avg.sleep ?? 0)}</b>/5</span>
          <span>{t('Fatigue')} <b>{fmtNum(s.checkins.avg.fatigue ?? 0)}</b>/5</span>
        </div>}
      </div> : <div className="dim small">{t('Check-ins are private unless the member shares them in their settings.')}</div>}
      <div className="v2-fu-acts">
        <Button variant="primary" icon="check" onClick={review}>{t('Mark review done')}</Button>
        <Button onClick={setup}>{t('Edit')}</Button>
        <Button variant="plain" onClick={stop}>{t('Stop')}</Button>
      </div>
      <div className="dim small">{t('Log the readings with “Log bioimpedance scan”. These are facts from the member’s data, not a diagnosis.')}</div>
    </Surface>}
  </section>
}
