import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { Button } from './ui.jsx'
import { Surface } from './v2.jsx'
import './followup-v2.css'

const trainerApi = (id, params = '') => api(`/api/trainer/followup/records?id=${encodeURIComponent(id)}${params}`)
export const loadMemberFollowUpRecords = () => api('/api/followup/records')
const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) })

function AnswerField({ q, value, onChange }) {
  if (q.type === 'long_text') return <textarea className="input" rows={3} maxLength={2000} value={value || ''} onChange={e => onChange(e.target.value)} />
  if (q.type === 'short_text') return <input className="input" maxLength={240} value={value || ''} onChange={e => onChange(e.target.value)} />
  if (q.type === 'number' || q.type === 'scale') return <input className="input" type="number" min={q.min} max={q.max} value={value ?? ''} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
  if (q.type === 'date') return <input className="input" type="date" value={value || ''} onChange={e => onChange(e.target.value)} />
  if (q.type === 'yes_no') return <div className="fu2-options">{[[true, 'Yes'], [false, 'No']].map(([v, label]) => <button type="button" key={String(v)} aria-pressed={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>{t(label)}</button>)}</div>
  if (q.type === 'single') return <select className="input" value={value || ''} onChange={e => onChange(e.target.value)}><option value="">{t('Choose')}</option>{q.options.map(o => <option key={o}>{o}</option>)}</select>
  if (q.type === 'multiple') return <div className="fu2-options">{q.options.map(o => { const selected = value || []; return <button type="button" key={o} aria-pressed={selected.includes(o)} className={selected.includes(o) ? 'on' : ''} onClick={() => onChange(selected.includes(o) ? selected.filter(x => x !== o) : [...selected, o])}>{o}</button> })}</div>
  return null
}

function MemberQuestionnaires({ data, onReload }) {
  const [answers, setAnswers] = useState({}), [busy, setBusy] = useState(''), [error, setError] = useState('')
  const pending = (data?.assignments || []).filter(a => a.status === 'pending')
  const submit = async assignment => {
    setBusy(assignment.id); setError('')
    try { await post('/api/followup/questionnaire/submit', { assignmentId: assignment.id, answers: answers[assignment.id] || {} }); setAnswers(x => ({ ...x, [assignment.id]: {} })); await onReload() }
    catch (e) { setError(e.message || t('Could not save')); } finally { setBusy('') }
  }
  return <section className="fu2-block" aria-label={t('Questionnaires')}>
    <h2>{t('Questionnaires')}</h2>
    {!pending.length && <p className="small dim">{t('No pending questionnaires.')}</p>}
    {pending.map(a => <Surface key={a.id} className="fu2-card"><h3>{a.snapshot.name}</h3><p className="small dim">{t('Assigned {0}', fmtDate(a.assignedAt.slice(0, 10)))}</p>
      {a.snapshot.questions.map(q => <label className="fu2-question" key={q.id}><span>{q.label}{q.required ? ' *' : ''}</span><AnswerField q={q} value={answers[a.id]?.[q.id]} onChange={value => setAnswers(x => ({ ...x, [a.id]: { ...(x[a.id] || {}), [q.id]: value } }))} /></label>)}
      {error && <p role="alert" className="small">{error}</p>}<Button variant="primary" disabled={busy === a.id} onClick={() => submit(a)}>{t('Send answers')}</Button>
    </Surface>)}
    {(data?.responses || []).slice().reverse().map(r => <details className="fu2-history" key={r.id}><summary>{fmtDate(r.completedAt.slice(0, 10))} · {r.snapshot.name} · {t('version {0}', r.templateVersion)}</summary>
      <dl>{r.snapshot.questions.map(q => r.answers[q.id] !== undefined && <div key={q.id}><dt>{q.label}</dt><dd>{Array.isArray(r.answers[q.id]) ? r.answers[q.id].join(', ') : String(r.answers[q.id])}</dd></div>)}</dl></details>)}
  </section>
}

function PhotoList({ photos }) {
  if (!photos?.length) return <p className="small dim">{t('No progress photos yet.')}</p>
  const entries = new Map()
  for (const photo of photos) {
    const key = photo.entryId || photo.id
    if (!entries.has(key)) entries.set(key, { ...photo, images: [] })
    entries.get(key).images.push(photo)
  }
  return <div className="fu2-photos">{[...entries.values()].sort((a, b) => b.date.localeCompare(a.date)).map(entry => <figure key={entry.entryId || entry.id}>
    <div className="fu2-photo-images">{entry.images.map(photo => <img key={photo.id} src={photo.url} alt={t('Private progress photo')} loading="lazy" />)}</div>
    <figcaption>{fmtDate(entry.date)} · {t(({ front: 'Front', side: 'Side', back: 'Back', free: 'Other' })[entry.type] || 'Other')}{entry.note ? ` · ${entry.note}` : ''}</figcaption>
  </figure>)}</div>
}

function MemberPhotos({ data, onReload }) {
  const [files, setFiles] = useState([]), [date, setDate] = useState(new Date().toISOString().slice(0, 10)), [type, setType] = useState('front'), [note, setNote] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const upload = async () => {
    if (!files.length) return
    if (files.length > 4 || files.some(file => !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) || files.reduce((n, file) => n + file.size, 0) > 5 * 1024 * 1024) { setError(t('Choose up to four JPEG, PNG or WebP images under 5 MB total.')); return }
    setBusy(true); setError('')
    try {
      const images = await Promise.all(files.map(file => new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsDataURL(file) })))
      await post('/api/followup/photo', { images, date, type, note }); setFiles([]); setNote(''); await onReload()
    } catch (e) { setError(e.message || t('Could not upload photo')) } finally { setBusy(false) }
  }
  return <section className="fu2-block" aria-label={t('Progress photos')}><h2>{t('Progress photos')}</h2>
    <p className="small dim">{t('Private to you and the centre staff who support your training. Never shared to Social or sent to AI.')}</p>
    <div className="fu2-upload"><input aria-label={t('Choose progress photos')} type="file" multiple accept="image/jpeg,image/png,image/webp" onChange={e => setFiles(Array.from(e.target.files || []))} />
      {!!files.length && <p className="small dim">{t('{0} photos selected', files.length)}</p>}
      <div className="fu2-fields"><label>{t('Date')}<input className="input" type="date" value={date} onChange={e => setDate(e.target.value)} /></label>
        <label>{t('Photo type')}<select className="input" value={type} onChange={e => setType(e.target.value)}><option value="front">{t('Front')}</option><option value="side">{t('Side')}</option><option value="back">{t('Back')}</option><option value="free">{t('Other')}</option></select></label></div>
      <input className="input" maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Optional note')} />
      {error && <p role="alert" className="small">{error}</p>}<Button variant="tinted" disabled={!files.length || busy} onClick={upload}>{t('Save private photo')}</Button></div>
    <PhotoList photos={data?.photos} />
  </section>
}

function TrainerRecords({ id, data, reload }) {
  const [template, setTemplate] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(new Date().toISOString().slice(0, 10)), [comparison, setComparison] = useState(null), [error, setError] = useState('')
  const pending = (data?.assignments || []).filter(a => a.status === 'pending')
  const assign = async () => { if (!template) return; setError(''); try { await post('/api/trainer/followup/questionnaire/assign', { memberId: id, templateId: template }); await reload() } catch (e) { setError(e.message) } }
  const compare = async () => { setError(''); try { const r = await trainerApi(id, `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`); if (r.comparison?.error) throw new Error(r.comparison.error); setComparison(r.comparison.value) } catch (e) { setError(e.message) } }
  const formatAnswers = r => r.snapshot.questions.filter(q => Object.hasOwn(r.answers, q.id)).map(q => `${q.label}: ${Array.isArray(r.answers[q.id]) ? r.answers[q.id].join(', ') : String(r.answers[q.id])}`).join(' · ')
  return <div className="fu2-trainer">
    <section className="fu2-block"><h3>{t('Initial questionnaires')}</h3>
      {data?.templates?.length > 0 && <div className="fu2-inline"><select className="input" aria-label={t('Questionnaire template')} value={template} onChange={e => setTemplate(e.target.value)}><option value="">{t('Choose a published template')}</option>{data.templates.map(x => <option key={x.id} value={x.id}>{x.name} · {t('version {0}', x.version)}</option>)}</select><Button size="sm" variant="tinted" disabled={!template} onClick={assign}>{t('Assign')}</Button></div>}
      {error && <p role="alert" className="small">{error}</p>}
      {pending.map(a => <div className="fu2-entry" key={a.id}><b>{a.snapshot.name}</b><span>{t('Pending')} · {fmtDate(a.assignedAt.slice(0, 10))} · {t('version {0}', a.templateVersion)}</span></div>)}
      {(data?.responses || []).slice().reverse().map(r => <div className="fu2-entry" key={r.id}><b>{r.snapshot.name}</b><span>{fmtDate(r.completedAt.slice(0, 10))} · {t('version {0}', r.templateVersion)}</span><p>{formatAnswers(r)}</p></div>)}
      {!pending.length && !data?.responses?.length && <p className="small dim">{t('No questionnaire history.')}</p>}
    </section>
    <section className="fu2-block"><h3>{t('Measurements and comparison')}</h3>
      <div className="fu2-inline"><label>{t('From')}<input className="input" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label>{t('To')}<input className="input" type="date" value={to} onChange={e => setTo(e.target.value)} /></label><Button size="sm" variant="tinted" disabled={!from || !to} onClick={compare}>{t('Compare')}</Button></div>
      {comparison && <div className="fu2-entry"><b>{fmtDate(comparison.from)} → {fmtDate(comparison.to)}</b><span>{t('Weight')}: {comparison.weight.delta == null ? '—' : `${comparison.weight.delta > 0 ? '+' : ''}${comparison.weight.delta} kg`}</span>
        {Object.entries(comparison.measurements).map(([key, x]) => <span key={key}>{t(key)}: {x.delta == null ? '—' : `${x.delta > 0 ? '+' : ''}${x.delta}`}</span>)}
        <span>{t('Goal')}: {comparison.goal.from?.label || comparison.goal.from?.primary || '—'} → {comparison.goal.to?.label || comparison.goal.to?.primary || '—'}{!comparison.goal.from && !comparison.goal.to ? ` · ${t('No objective history for these dates.')}` : ''}</span><PhotoList photos={comparison.photos.map(x => ({ ...x, url: `/api/followup/photo?id=${encodeURIComponent(x.id)}` }))} /></div>}
      <p className="small dim">{t('Photos are compared manually. No image analysis is performed.')}</p>
    </section>
    <section className="fu2-block"><h3>{t('Progress photos')} <span className="dim">{data?.photos?.length || 0}</span></h3><p className="small dim">{t('Private files; visible only to the member and centre staff.')}</p><PhotoList photos={data?.photos} /></section>
    <section className="fu2-block"><h3>{t('Check-ins')}</h3>{data?.checkinsShared ? <div className="fu2-entry">{(data.checkins || []).slice(-10).reverse().map(x => <span key={x.d}>{fmtDate(x.d)} · {t('Energy {0}/5', x.energy ?? '—')} · {t('Sleep {0}/5', x.sleep ?? '—')} · {t('Fatigue {0}/5', x.fatigue ?? '—')}{x.pain ? ` · ${t('Discomfort noted')}` : ''}</span>)}</div> : <p className="small dim">{t('The member does not share check-ins.')}</p>}</section>
    <section className="fu2-block"><h3>{t('Follow-up timeline')}</h3><ol className="fu2-timeline">{(data?.timeline || []).slice(0, 30).map((x, i) => <li key={`${x.kind}-${x.d}-${i}`}><time>{fmtDate(x.d)}</time><span>{t(({ questionnaire_completed: 'Questionnaire completed', progress_photo: 'Progress photo', measurement: 'Measurement', weight_measurement: 'Weight measurement', checkin: 'Check-in' })[x.kind] || x.kind)}{x.ref?.name ? ` · ${x.ref.name}` : x.ref?.key ? ` · ${t(x.ref.key)}` : ''}</span></li>)}</ol></section>
  </div>
}

export function TrainerFollowUpRecords({ id, onReload = () => {} }) {
  const [data, setData] = useState(null), [error, setError] = useState('')
  const reload = () => trainerApi(id).then(setData).catch(e => setError(e.message))
  useEffect(() => { setData(null); setError(''); reload() }, [id])
  if (error) return <p className="small dim" role="status">{error}</p>
  if (!data) return <p className="small dim">{t('Loading follow-up records…')}</p>
  return <TrainerRecords id={id} data={data} reload={async () => { await reload(); onReload() }} />
}

export function MemberFollowUpRecords({ reloadKey = 0 }) {
  const [data, setData] = useState(null), [error, setError] = useState('')
  const reload = () => loadMemberFollowUpRecords().then(setData).catch(e => setError(e.message))
  useEffect(() => { reload() }, [reloadKey])
  if (error) return <p className="small dim" role="status">{error}</p>
  if (!data) return <p className="small dim">{t('Loading follow-up records…')}</p>
  return <div className="fu2-member"><MemberQuestionnaires data={data} onReload={reload} /><MemberPhotos data={data} onReload={reload} />
    <section className="fu2-block"><h2>{t('Measurements')}</h2><p>{t('Goal')}: {data.objective || '—'}</p><div className="fu2-entry">{Object.entries(data.measurements || {}).map(([key, list]) => list.length ? <span key={key}>{t(key)} · {fmtDate(list.at(-1).d)}: {list.at(-1).value}</span> : null)}{data.weight?.length > 0 && <span>{t('Weight')} · {fmtDate(data.weight.at(-1).d)}: {data.weight.at(-1).value} kg</span>}</div></section>
  </div>
}
