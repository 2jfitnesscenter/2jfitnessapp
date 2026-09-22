import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button, Switch, TextField } from '../components/ui.jsx'

/* The operator's side of 2J's auxiliary-AI profile — a THIRD, independent AI, separate from
   both the member-facing Coach (AdminCoach) and the trainer panel's own AI (AdminTrainerAI).
   Always Google Gemini, and today drives exactly one capability: helping match an unrecognised
   exercise name from a CSV import against the real library (see the "Import from another app"
   flow in Settings). Same never-shows-content rule as the other two: counts and outcomes only,
   never an exercise name or a member's data. */

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}

const failureDetail = e => [
  e.diagnostic || e.errorClass,
  e.providerStatus ? `HTTP ${e.providerStatus}` : null,
  e.providerCode || null,
  e.attempts > 1 ? t('{0} attempts', e.attempts) : null,
].filter(Boolean).join(' · ')

export default function AdminAuxAI() {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/api/admin/aux-ai').then(setD).catch(e => toast(e.message || t('Failed to load')))
  useEffect(() => { load() }, [])

  const patch = async body => {
    setBusy(true)
    try { await api('/api/admin/aux-ai/config', { method: 'POST', body: JSON.stringify(body) }); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/aux-ai/test', { method: 'POST', body: '{}' })
      toast(r.ok ? t('Test passed ✅') : t('Test failed: {0}', r.error || t('unknown')))
      await load()
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await api('/api/admin/aux-ai/auth/disconnect', { method: 'POST', body: '{}' }); toast(t('Disconnected')); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  if (!d) return <div className="card"><div className="muted small">{t('Loading…')}</div></div>

  const authed = d.auth?.state === 'connected'
  const live = d.enabled && authed

  return <div className="card" style={{ borderColor: live ? 'var(--acc)' : undefined }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Auxiliary AI')}</h2>
      <Switch checked={!!d.enabled} disabled={busy} onChange={v => patch({ enabled: v })} />
    </div>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.5 }}>
      {t('Helps match exercise names from a CSV import (Hevy, Gravl…) against the real library when nothing else resolves them. Always Google Gemini, and completely independent of the AI Coach and the trainer panel AI above — a member never sees this, and it never generates or changes a routine or a workout.')}
    </div>

    {!d.enabled && <div className="muted small">{t('Off. Import review falls back to manual matching only.')}</div>}

    {d.enabled && <>
      <div className="tiles" style={{ textAlign: 'left', marginBottom: 10 }}>
        <div className="tile"><div className="l">{t('Credential')}</div>
          <div className="v" style={{ fontSize: '.9rem', color: authed ? 'var(--green)' : 'var(--red)' }}>{authLabel(d.auth)}</div></div>
        <div className="tile"><div className="l">{t('Jobs today')}</div><div className="v" style={{ fontSize: '1.1rem' }}>{d.jobsToday}</div></div>
        <div className="tile"><div className="l">{t('Last run')}</div><div className="v" style={{ fontSize: '.85rem' }}>{rel(d.lastSuccess?.at)}</div></div>
      </div>

      <h4 className="sec" style={{ marginTop: 4 }}>{t('Credential')}</h4>
      {authed ? <>
        <div className="small muted" style={{ marginBottom: 8 }}>{t('Connected · {0}', rel(d.auth.connectedAt))}</div>
        <div className="row" style={{ gap: 8 }}>
          <Button size="sm" icon="check" disabled={busy} onClick={test}>{t('Test')}</Button>
          <Button size="sm" danger disabled={busy} onClick={disconnect}>{t('Disconnect')}</Button>
        </div>
      </> : <>
        {d.auth?.state === 'unreadable' && <div className="small" style={{ color: 'var(--red)', marginBottom: 8 }}>
          {t('The stored credential can’t be decrypted — this usually means ./data was restored without its')} <code>secret</code> {t('file. Connect again.')}
        </div>}
        <Button size="sm" icon="lock" disabled={busy}
          onClick={() => openSheet(close => <ApiKeySheet close={close} onDone={load} />)}>{t('Use an API key')}</Button>
      </>}

      <h4 className="sec">{t('Limits')}</h4>
      <label className="small muted">{t('Whole instance / day')}
        <input className="num" type="number" min="0" max="2000" defaultValue={d.caps.instanceDaily} style={{ width: 70, marginLeft: 8 }}
          onBlur={e => patch({ caps: { instanceDaily: +e.target.value } })} /></label>
      <div className="dim small" style={{ margin: '4px 0 10px' }}>{t('0 = no limit. One matching job batches every unresolved name. A transient failure may add one retry.')}</div>

      {d.lastError && <>
        <h4 className="sec">{t('Last failure')}</h4>
        <div className="small" style={{ color: 'var(--red)' }}>{failureDetail(d.lastError)}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{rel(d.lastError.at)}</div>
      </>}

      {!!d.recent?.length && <>
        <h4 className="sec">{t('Recent jobs')}</h4>
        {d.recent.slice(0, 8).map((e, i) => <div key={i} className="row between" style={{ padding: '5px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small">{t('Exercise matching')}</span>
          <span className="dim" style={{ fontSize: '.72rem' }}>
            <span style={{ color: e.outcome === 'failed' ? 'var(--red)' : 'var(--acc)' }}>{e.outcome}</span>
            {e.outcome === 'failed' ? ' · ' + failureDetail(e) : (e.attempts > 1 ? ' · ' + t('{0} attempts', e.attempts) : '')}
            {e.ms ? ' · ' + t('{0}s', Math.round(e.ms / 1000)) : ''} · {rel(e.at)}
          </span>
        </div>)}
      </>}
    </>}
  </div>
}

const authLabel = a => ({ connected: t('connected'), disconnected: t('needed'), unreadable: t('unreadable') }[a?.state] || '—')

function ApiKeySheet({ close, onDone }) {
  const toast = useUI(s => s.toast)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/aux-ai/auth/key', { method: 'POST', body: JSON.stringify({ key: key.trim() }) })
      toast(r.test?.ok ? t('Key saved ✅') : t('Saved, but the test failed: {0}', r.test?.error || ''))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }
  return <>
    <h3>{t('Google Gemini API key')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {t('Stored encrypted on this server and passed to the provider runtime only while a job runs. It is never shown again and never leaves the server. This can be the same or a different key than the one connected to the AI Coach above.')}
    </div>
    <TextField value={key} autoFocus type="password" placeholder="AQ…" onChange={e => setKey(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !key.trim()} onClick={save}>{t('Save key')}</Button>
    <div style={{ height: 8 }} />
  </>
}
