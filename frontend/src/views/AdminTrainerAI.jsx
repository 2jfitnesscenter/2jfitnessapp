import { useEffect, useState } from 'react'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { Button, Switch, TextField } from '../components/ui.jsx'

/* The operator's side of the trainer panel's "Generate with AI" feature — deliberately its own
   card, separate from AdminCoach: this is always Claude and always independent of whatever (if
   anything) the member-facing Coach above is configured to use. Same never-shows-content rule
   as AdminCoach: counts and outcomes only, never a member's data or a generated plan. */

const rel = ts => {
  if (!ts) return t('never')
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000)
  if (s < 60) return t('just now')
  if (s < 3600) return t('{0}m ago', Math.floor(s / 60))
  if (s < 86400) return t('{0}h ago', Math.floor(s / 3600))
  return t('{0}d ago', Math.floor(s / 86400))
}

export default function AdminTrainerAI() {
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [d, setD] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = () => api('/api/admin/trainer-ai').then(setD).catch(e => toast(e.message || t('Failed to load')))
  useEffect(() => { load() }, [])

  const patch = async body => {
    setBusy(true)
    try { await api('/api/admin/trainer-ai/config', { method: 'POST', body: JSON.stringify(body) }); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }
  const test = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/trainer-ai/test', { method: 'POST', body: '{}' })
      toast(r.ok ? t('Test passed ✅') : t('Test failed: {0}', r.error || t('unknown')))
      await load()
    } catch (e) { toast(e.message) }
    setBusy(false)
  }
  const disconnect = async () => {
    setBusy(true)
    try { await api('/api/admin/trainer-ai/auth/disconnect', { method: 'POST', body: '{}' }); toast(t('Disconnected')); await load() }
    catch (e) { toast(e.message) }
    setBusy(false)
  }

  if (!d) return <div className="card"><div className="muted small">{t('Loading…')}</div></div>

  const authed = d.auth?.state === 'connected'
  const live = d.enabled && authed

  return <div className="card" style={{ borderColor: live ? 'var(--acc)' : undefined }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <h2 style={{ margin: 0 }}>{t('Trainer panel AI')}</h2>
      <Switch checked={!!d.enabled} disabled={busy} onChange={v => patch({ enabled: v })} />
    </div>
    <div className="dim small" style={{ marginBottom: 10, lineHeight: 1.5 }}>
      {t('Lets trainers draft a member’s routines with AI from the desktop panel. Always Claude, and completely independent of the member-facing Coach above — this can be on even if that one is off, or the other way around.')}
    </div>

    {!d.enabled && <div className="muted small">{t('Off. Trainers see no “Generate with AI” option in the panel.')}</div>}

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
        <Button size="sm" variant="primary" icon="key" disabled={busy}
          onClick={() => openSheet(close => <SetupTokenSheet close={close} onDone={load} />)}>{t('Add CLI token')}</Button>
      </>}

      <h4 className="sec">{t('Limits')}</h4>
      <label className="small muted">{t('Whole instance / day')}
        <input className="num" type="number" min="0" max="500" defaultValue={d.caps.instanceDaily} style={{ width: 70, marginLeft: 8 }}
          onBlur={e => patch({ caps: { instanceDaily: +e.target.value } })} /></label>
      <div className="dim small" style={{ margin: '4px 0 10px' }}>{t('0 = no limit. Every generation is one Claude session on the connected account.')}</div>

      {d.lastError && <>
        <h4 className="sec">{t('Last failure')}</h4>
        <div className="small" style={{ color: 'var(--red)' }}>{d.lastError.errorClass}</div>
        <div className="dim" style={{ fontSize: '.72rem' }}>{rel(d.lastError.at)}</div>
      </>}

      {!!d.recent?.length && <>
        <h4 className="sec">{t('Recent jobs')}</h4>
        {d.recent.slice(0, 8).map((e, i) => <div key={i} className="row between" style={{ padding: '5px 2px', borderBottom: '1px solid var(--sep)' }}>
          <span className="small">{t('Routine draft')}</span>
          <span className="dim" style={{ fontSize: '.72rem' }}>
            <span style={{ color: e.outcome === 'failed' ? 'var(--red)' : 'var(--acc)' }}>{e.outcome}</span>
            {e.ms ? ' · ' + t('{0}s', Math.round(e.ms / 1000)) : ''} · {rel(e.at)}
          </span>
        </div>)}
      </>}
    </>}
  </div>
}

const authLabel = a => ({ connected: t('connected'), disconnected: t('needed'), unreadable: t('unreadable') }[a?.state] || '—')

function SetupTokenSheet({ close, onDone }) {
  const toast = useUI(s => s.toast)
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setBusy(true)
    try {
      const r = await api('/api/admin/trainer-ai/auth/setup-token', { method: 'POST', body: JSON.stringify({ token: token.trim() }) })
      setToken('')
      toast(r.test?.ok ? t('Connected ✅') : t('Saved, but the test failed: {0}', r.test?.error || ''))
      close(); onDone()
    } catch (e) { toast(e.message); setBusy(false) }
  }

  return <>
    <h3>{t('Connect Claude')}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 12 }}>
      {t('On a trusted computer where you use Claude Code, run')} <code>claude setup-token</code>{t(', complete its normal browser sign-in, then paste the token it prints here. This can be the same or a different Claude account than the one connected to the member-facing Coach above.')}
    </div>
    <TextField value={token} autoFocus type="password" placeholder={t('paste setup token')} onChange={e => setToken(e.target.value)} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy || !token.trim()} onClick={save}>{t('Save and test')}</Button>
    <div style={{ height: 8 }} />
  </>
}
