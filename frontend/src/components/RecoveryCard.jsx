import { t } from '../lib/i18n.js'
import { recoveryOf, overallRecovery, recoveryColor } from '../lib/recovery.js'
import RecoveryRing from './RecoveryRing.jsx'
import BodyMap from './BodyMap.jsx'

// Muscle recovery — an estimate of how ready each muscle group is, from logged sets (see
// lib/recovery.js). The ring gives the one number that matters at a glance; the coloured
// manikin is the same red/yellow/green map /recovery itself uses, just without its legend or
// the per-muscle % list — tapping through is the only way to get those, on purpose, so the card
// stays a glance rather than a second copy of the detail screen. Shared by Home and Stats
// (Progress) rather than each keeping its own copy of this teaser.
export default function RecoveryCard({ nav, S }) {
  const recovery = recoveryOf(S)
  const overall = overallRecovery(recovery)
  const colorOf = slug => recoveryColor(recovery[slug] ?? 100)
  return <div className="card tappable" style={{ cursor: 'pointer' }} onClick={() => nav('/recovery')}>
    <div className="row between">
      <div style={{ minWidth: 0 }}>
        <h2 style={{ margin: '0 0 2px' }}>{t('Muscle recovery')}</h2>
        <div className="muted small">{t('See which muscles are ready to train')}</div>
      </div>
      <RecoveryRing value={overall} size={58} stroke={6} />
    </div>
    <BodyMap colorOf={colorOf} body={S.body} />
  </div>
}
