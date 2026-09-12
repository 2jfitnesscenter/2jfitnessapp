import { useLocation, useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { actionsSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

export default function TabBar() {
  const nav = useNavigate()
  const loc = useLocation()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  const isGuest = useStore(s => s.isGuest())
  if (!user && !isGuest) return null
  const cur = loc.pathname.split('/')[1] || 'home'
  const on = k => cur === k || (cur === 'history' && k === 'stats')

  // A workout already in progress is resumed directly — no menu in the way. Otherwise "Train"
  // always opens the Actions sheet, which is where every start path (scheduled, freestyle, a
  // test session, the clock) now lives.
  const startWorkout = () => { S.active ? nav('/workout') : actionsSheet() }
  const Tab = ({ k, icon, to, label }) => (
    <button className={on(k) ? 'on' : ''} onClick={() => nav(to)}>
      <Icon name={icon} /><span>{label}</span>
    </button>
  )

  return (
    <nav id="tabbar">
      <Tab k="home" icon="house" to="/home" label={t('Home')} />
      <Tab k="plan" icon="calendar" to="/plan" label={t('Plan')} />
      <Tab k="stats" icon="chart" to="/stats" label={t('Stats')} />
      <button className={'start' + (S.active ? ' rec' : '')} onClick={startWorkout}>
        <span className="cir"><Icon name={S.active ? 'play' : 'dumbbell'} /></span>
        <span>{S.active ? t('Resume') : t('Train')}</span>
      </button>
      <Tab k="social" icon="users" to="/social" label={t('Social')} />
      <Tab k="profile" icon="personCircle" to="/profile" label={t('Profile')} />
      <Tab k="settings" icon="gear" to="/settings" label={t('Settings')} />
    </nav>
  )
}
