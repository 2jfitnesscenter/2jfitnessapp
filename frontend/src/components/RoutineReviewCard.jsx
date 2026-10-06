import { t } from '../lib/i18n.js'
import { reviewReasons } from '../lib/routine-review-text.js'
import Icon from './Icon.jsx'
import { Surface } from './v2.jsx'
import { Button } from './ui.jsx'

/* Member notice: "this routine is worth a look" and why, from their own logged numbers. Calm tone, two actions — see the routine, or mark it reviewed (which
   closes the notice and restarts the cycle). Nothing here changes the routine. */
export default function RoutineReviewCard({ review, onView, onDone, compact = false }) {
  const why = reviewReasons(review, compact ? 1 : 3)
  return <Surface className="v3-rr" role="status" aria-label={t('Routine review')}>
    <div className="v2-eyebrow"><Icon name="clipboard" /> {t('Routine review')}</div>
    <div className="v3-rr-t"><b>{review.name}</b><small>{t('Week {0} with this routine', review.week)}</small></div>
    {why.length > 0 && <ul className="v3-rr-why">{why.map((w, i) => <li key={i}>{w}</li>)}</ul>}
    <div className="v3-rr-acts">
      <Button size="sm" variant="tinted" icon="clipboard" onClick={onView}>{t('View routine')}</Button>
      <Button size="sm" variant="plain" icon="check" onClick={onDone}>{t('Routine reviewed')}</Button>
    </div>
  </Surface>
}
