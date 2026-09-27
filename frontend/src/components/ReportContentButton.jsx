import { useState } from 'react'
import { t } from '../lib/i18n.js'
import { reportSocialContent } from '../lib/social-api.js'
import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'

export default function ReportContentButton({ targetType, targetId }) {
  const toast = useUI(s => s.toast)
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('inappropriate')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try { await reportSocialContent(targetType, targetId, reason); toast(t('Report sent to the team')); setOpen(false) }
    catch (e) { toast(e.message || t('Could not send report')) }
    finally { setBusy(false) }
  }
  return <div className="report-control">
    {!open ? <button className="btn ghost" onClick={() => setOpen(true)}><Icon name="flag" />{t('Report')}</button> : <div className="report-mini">
      <select className="input" aria-label={t('Report reason')} value={reason} onChange={e => setReason(e.target.value)}>
        <option value="inappropriate">{t('Inappropriate content')}</option><option value="spam">{t('Spam')}</option><option value="privacy">{t('Privacy concern')}</option><option value="other">{t('Other')}</option>
      </select>
      <button className="btn primary" disabled={busy} onClick={submit}>{t('Send report')}</button>
      <button className="btn ghost" disabled={busy} onClick={() => setOpen(false)}>{t('Cancel')}</button>
    </div>}
  </div>
}
