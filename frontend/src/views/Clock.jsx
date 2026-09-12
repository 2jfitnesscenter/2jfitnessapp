import { useNavigate } from 'react-router-dom'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'

// Six fixed formats rather than a configurable "build your own clock" — matches every reference
// timer app, and each mode's own screen (ClockRun.jsx) is genuinely different enough (phases,
// rounds, a manual result form) that a single generic config screen would just be a worse UI.
export const CLOCK_MODES = [
  { id: 'stopwatch', icon: 'timer', title: 'Clock', desc: 'Free stopwatch for timing any block.' },
  { id: 'countdown', icon: 'clock', title: 'Countdown', desc: 'Count down from a set duration.' },
  { id: 'tabata', icon: 'intervals', title: 'Tabata', desc: '20 seconds of work, 10 of rest, 8 rounds.' },
  { id: 'fortime', icon: 'flag', title: 'For time', desc: 'Count up until you finish or hit the cap.' },
  { id: 'amrap', icon: 'infinity', title: 'AMRAP', desc: 'Count down to complete as many rounds as you can.' },
  { id: 'emom', icon: 'emom', title: 'EMOM', desc: 'Every round starts at the top of the interval.' },
]

export default function ClockPicker() {
  const nav = useNavigate()
  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav(-1)} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, margin: '0 12px' }}>
        <div style={{ fontWeight: 600, fontSize: 20, letterSpacing: '-.021em' }}>{t('Choose a clock')}</div>
        <div className="sub">{t('Pick the format to start now.')}</div>
      </div>
    </div>
    <div className="list">
      {CLOCK_MODES.map(m => <div key={m.id} className="item" onClick={() => nav('/clock/' + m.id)}>
        <span className="lrow-i"><Icon name={m.icon} /></span>
        <div className="grow"><div className="tt">{t(m.title)}</div><div className="ss">{t(m.desc)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
  </div>
}
