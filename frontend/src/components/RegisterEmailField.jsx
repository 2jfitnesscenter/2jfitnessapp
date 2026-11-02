// Optional e-mail on the registration sheet (kept out of Login.jsx, whose shared-trainer PIN flow must stay free of e-mail handling).
import { t } from '../lib/i18n.js'
import { normalizeAccountEmail } from '../lib/account-email.js'

/** True when something was typed but it is not a valid address (empty is fine: the field is optional). */
export const registerMailInvalid = text => String(text).trim() !== '' && !normalizeAccountEmail(text)

export default function RegisterEmailField({ value, onChange }) {
  return <>
    <div style={{ height: 10 }} />
    <input className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" placeholder={t('E-mail (optional)')} maxLength={254}
      value={value} onChange={e => onChange(e.target.value)} />
    <div className="dim small" style={{ marginTop: 6 }}>{t('Optional. It lets you link your 2J account later. It starts unverified.')}</div>
  </>
}
