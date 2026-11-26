import { t } from '../lib/i18n.js'

// F9r (M-7): when «Generate link» is refused, the sheet itself says so and what to do. Before, the
// reason only went to a toast that sat behind the sheet, so the button looked broken. The usual
// case is a session opened from 2J Hub: the server asks for this person's own Búnker passkey
// (POST /api/admin/user/recovery-link stays on the strong-action list).
export function recoveryLinkErrorText(e) {
  const passkey = e?.data?.code === 'passkey_required' || e?.name === 'NotAllowedError' || e?.name === 'AbortError'
  if (passkey) return t('To create the link, confirm with your Búnker passkey. If you came in from 2J Hub, sign in to Búnker with your passkey and try again.')
  const msg = String(e?.message || '').trim()
  return msg ? t('Could not create the link: {0}', msg) : t('Could not create the link. Try again.')
}

export function RecoveryLinkError({ error }) {
  if (!error) return null
  return <div role="alert" className="small" style={{ color: 'var(--danger, #e5484d)', margin: '0 0 12px', lineHeight: 1.45 }}>{error}</div>
}
