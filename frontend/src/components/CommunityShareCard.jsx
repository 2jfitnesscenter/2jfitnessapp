import { t } from '../lib/i18n.js'
import Icon from './Icon.jsx'

const iconFor = kind => ({ routine: 'dumbbell', program: 'calendar', record: 'trophy', challenge: 'flag', workout: 'figureStrength', achievement: 'sparkles', streak: 'flame' }[kind] || 'users')
const kickerFor = kind => ({ routine: 'A routine worth sharing', program: 'A program to inspire', record: 'A real training mark', challenge: 'Train together', workout: 'Session complete', achievement: 'Achievement unlocked', streak: 'Consistency in motion' }[kind] || '2J Community')

export default function CommunityShareCard({ data, cardRef }) {
  return <article ref={cardRef} className="community-sharecard" data-share-kind={data.kind}>
    <div className="csc-brand"><span className="csc-mark"><Icon name="dumbbell" /></span><span>2J FITNESS CENTER</span><span className="csc-brand-dot" /></div>
    <div className="csc-art"><span className="csc-orbit csc-orbit-a" /><span className="csc-orbit csc-orbit-b" /><span className="csc-art-icon"><Icon name={iconFor(data.kind)} /></span></div>
    <div className="csc-kicker">{t(kickerFor(data.kind))}</div>
    <h2>{data.title || t('A moment from your training')}</h2>
    {data.metric && <div className="csc-metric">{data.metric}</div>}
    {data.subtitle && <p>{data.subtitle}</p>}
    <div className="csc-bottom"><span>{data.date}</span><span>2J · KEEP MOVING</span></div>
  </article>
}
