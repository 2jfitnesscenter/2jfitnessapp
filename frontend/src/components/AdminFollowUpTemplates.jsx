import { useEffect, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button } from './ui.jsx'
import { Surface } from './v2.jsx'
import './followup-v2.css'

const post = (url, body) => api(url, { method: 'POST', body: JSON.stringify(body) })
const QUESTION_TYPES = [['short_text', 'Short text'], ['long_text', 'Long text'], ['number', 'Number'], ['yes_no', 'Yes / no'], ['single', 'Single choice'], ['multiple', 'Multiple choice'], ['scale', 'Scale'], ['date', 'Date']]
const newQuestion = () => ({ id: `q_${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`, label: '', type: 'short_text', active: true, required: false, options: [] })

export default function AdminFollowUpTemplates() {
  const [templates, setTemplates] = useState([]), [selected, setSelected] = useState(''), [draft, setDraft] = useState(null), [notice, setNotice] = useState(''), [busy, setBusy] = useState(false)
  const load = async () => { const d = await api('/api/admin/followup/templates'); setTemplates(d.templates); setSelected(id => id || d.templates[0]?.id || '') }
  useEffect(() => { load().catch(e => setNotice(e.message)) }, [])
  useEffect(() => { const selectedTemplate = templates.find(x => x.id === selected); setDraft(selectedTemplate ? structuredClone(selectedTemplate) : null) }, [selected, templates])
  const save = async () => { setBusy(true); setNotice(''); try { const result = await post('/api/admin/followup/templates/save', { template: draft }); setTemplates(x => x.map(tpl => tpl.id === result.template.id ? result.template : tpl)); setNotice(t('Template saved')) } catch (e) { setNotice(e.message) } finally { setBusy(false) } }
  const create = async () => { const template = { name: t('New template'), published: false, active: true, questions: [newQuestion()] }; try { const result = await post('/api/admin/followup/templates/save', { template }); await load(); setSelected(result.template.id) } catch (e) { setNotice(e.message) } }
  const duplicate = async () => { try { const result = await post('/api/admin/followup/templates/duplicate', { id: selected }); await load(); setSelected(result.template.id) } catch (e) { setNotice(e.message) } }
  const publish = async () => { try { const result = await post('/api/admin/followup/templates/publish', { id: selected, published: !draft.published, active: true }); setTemplates(x => x.map(y => y.id === selected ? result.template : y)) } catch (e) { setNotice(e.message) } }
  const updateQuestion = (index, patch) => setDraft(d => ({ ...d, questions: d.questions.map((q, i) => i === index ? { ...q, ...patch } : q) }))
  const moveQuestion = (index, delta) => setDraft(d => { const next = [...d.questions], at = index + delta; if (at < 0 || at >= next.length) return d; [next[index], next[at]] = [next[at], next[index]]; return { ...d, questions: next } })
  if (!draft) return <div className="narrow"><h1>{t('Questionnaire templates')}</h1><p>{notice || t('Loading…')}</p></div>
  return <div className="narrow fu2-admin"><header className="hdr"><h1>{t('Questionnaire templates')}</h1></header>
    <p className="small dim">{t('Published template edits create a new version. Existing member answers keep their original snapshot.')}</p>
    <div className="fu2-inline"><select className="input" aria-label={t('Templates')} value={selected} onChange={e => setSelected(e.target.value)}>{templates.map(x => <option key={x.id} value={x.id}>{x.name} · v{x.version}{x.published ? '' : ` · ${t('Draft')}`}</option>)}</select><Button size="sm" variant="tinted" onClick={create}>{t('New')}</Button><Button size="sm" variant="tinted" disabled={!selected} onClick={duplicate}>{t('Duplicate')}</Button></div>
    <label className="fu2-question"><span>{t('Template name')}</span><input className="input" value={draft.name} maxLength={80} onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <label className="fu2-question"><span>{t('Description')}</span><input className="input" value={draft.description || ''} maxLength={240} onChange={e => setDraft({ ...draft, description: e.target.value })} /></label>
    {draft.questions.map((q, i) => <Surface className="fu2-card" key={q.id}><div className="fu2-inline"><input className="input" aria-label={t('Question')} value={q.label} onChange={e => updateQuestion(i, { label: e.target.value })} /><select className="input" aria-label={t('Question type')} value={q.type} onChange={e => updateQuestion(i, { type: e.target.value })}>{QUESTION_TYPES.map(([v, label]) => <option key={v} value={v}>{t(label)}</option>)}</select></div>
      {['single', 'multiple'].includes(q.type) && <input className="input" aria-label={t('Options separated by commas')} value={(q.options || []).join(', ')} onChange={e => updateQuestion(i, { options: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })} placeholder={t('Options separated by commas')} />}
      {['number', 'scale'].includes(q.type) && <div className="fu2-inline"><label>{t('Minimum')}<input className="input" type="number" value={q.min ?? (q.type === 'scale' ? 1 : '')} onChange={e => updateQuestion(i, { min: Number(e.target.value) })} /></label><label>{t('Maximum')}<input className="input" type="number" value={q.max ?? (q.type === 'scale' ? 5 : '')} onChange={e => updateQuestion(i, { max: Number(e.target.value) })} /></label></div>}
      <div className="fu2-inline"><label><input type="checkbox" checked={q.active !== false} onChange={e => updateQuestion(i, { active: e.target.checked })} /> {t('Active')}</label><label><input type="checkbox" checked={q.required === true} onChange={e => updateQuestion(i, { required: e.target.checked })} /> {t('Required')}</label><label><input type="checkbox" checked={q.shareWithCoach === true} onChange={e => updateQuestion(i, { shareWithCoach: e.target.checked })} /> {t('May inform Coach if member has enabled AI consent')}</label><button type="button" onClick={() => moveQuestion(i, -1)} aria-label={t('Move up')}>↑</button><button type="button" onClick={() => moveQuestion(i, 1)} aria-label={t('Move down')}>↓</button><button type="button" onClick={() => setDraft(d => ({ ...d, questions: d.questions.filter((_, j) => j !== i) }))}>{t('Remove')}</button></div>
    </Surface>)}
    <Button variant="tinted" onClick={() => setDraft(d => ({ ...d, questions: [...d.questions, newQuestion()] }))}>{t('Add question')}</Button>
    {notice && <p role="status" className="small">{notice}</p>}
    <div className="fu2-inline"><Button variant="primary" disabled={busy} onClick={save}>{t('Save template')}</Button><Button variant="tinted" onClick={publish}>{t(draft.published ? 'Hide' : 'Publish')}</Button></div>
  </div>
}
