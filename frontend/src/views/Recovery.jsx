import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import Icon from '../components/Icon.jsx'
import RecoveryRing from '../components/RecoveryRing.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { recoveryOf, overallRecovery, GROUPS, GROUP_LABEL, GROUP_MUSCLES, MUSCLE_NAME } from '../lib/recovery.js'

const pillColor = v => v >= 70 ? 'var(--green)' : v >= 40 ? 'var(--orange)' : 'var(--red)'

function RecoveryLegend() {
  return <div className="hm-legend" style={{ justifyContent: 'center', gap: 16 }}>
    <span className="row" style={{ gap: 4 }}><i className="hm-c" style={{ background: 'var(--red)' }} />{t('Fatigued')}</span>
    <span className="row" style={{ gap: 4 }}><i className="hm-c" style={{ background: 'var(--orange)' }} />{t('Recovering')}</span>
    <span className="row" style={{ gap: 4 }}><i className="hm-c" style={{ background: 'var(--green)' }} />{t('Ready')}</span>
  </div>
}

function MuscleRow({ slug, value }) {
  return <div className="item">
    <div className="grow">
      <div className="row between">
        <span className="tt">{t(MUSCLE_NAME[slug])}</span>
        <span className="small" style={{ color: pillColor(value), fontWeight: 600 }}>{value}%</span>
      </div>
      <div style={{ height: 6, background: 'var(--surface-2)', borderRadius: 99, marginTop: 6, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: value + '%', background: pillColor(value), borderRadius: 99 }} />
      </div>
    </div>
  </div>
}

function InfoSheet() {
  return <>
    <h3>{t('How recovery works')}</h3>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('About')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Muscle recovery estimates how ready each muscle group is to train again, based on the sets you logged in the last 7 days.')}
    </div>
    <h4 className="sec">{t('How it’s calculated')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('We look at your last 7 days of training and give more weight to recent sessions. Each set counts for the muscle it targets — full for the main muscle, half for supporting ones — and more reps in a set count for more. Time-based work (holds, cardio) isn’t included.')}
    </div>
    <h4 className="sec">{t('Keep in mind')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5 }}>
      {t('This is only an estimate. It doesn’t account for sleep, stress, nutrition or how hard a set actually felt (RIR/RPE). Custom exercises need a muscle tag to be included.')}
    </div>
  </>
}

export default function Recovery() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const recovery = recoveryOf(S)
  const overall = overallRecovery(recovery)
  const [sel, setSel] = useState(null)
  const groupAvg = g => Math.round(GROUP_MUSCLES[g].reduce((s, m) => s + recovery[m], 0) / GROUP_MUSCLES[g].length)
  // Traffic-light colours, not a single-accent intensity ramp — the diagram should read at a
  // glance the same way the ring and the list below it already do, not need its own legend to
  // decode a different scale.
  const colorOf = slug => pillColor(recovery[slug] ?? 100)

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/home')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Muscle recovery')}</h1></div>
      <button className="iconbtn" onClick={() => openSheet(() => <InfoSheet />)} aria-label={t('How recovery works')}><Icon name="info" /></button>
    </div>

    <div className="card" style={{ textAlign: 'center' }}>
      <div className="row" style={{ justifyContent: 'center', marginBottom: 8 }}><RecoveryRing value={overall} size={110} stroke={11} /></div>
      <div className="tt" style={{ fontWeight: 600 }}>{t('Overall recovery')}</div>
      <div className="muted small" style={{ marginTop: 2 }}>{t('Average recovery across every muscle group, based on the last 7 days of training.')}</div>
    </div>

    <BodyMap className="tappable" colorOf={colorOf} selected={sel} onMuscle={m => setSel(s => (s === m ? null : m))} body={S.body} />
    <RecoveryLegend />
    {sel && <div className="mrow" style={{ borderTop: 'var(--hair) solid var(--sep)', marginTop: 8, paddingTop: 10 }}>
      <span className="nm"><b>{t(MUSCLE_NAME[sel])}</b></span>
      <span className="v" style={{ color: pillColor(recovery[sel]), fontWeight: 600 }}>{recovery[sel]}%</span>
    </div>}
    <div style={{ height: 14 }} />

    {GROUPS.map(g => <div key={g} style={{ marginBottom: 18 }}>
      <h4 className="sec">{t(GROUP_LABEL[g])}</h4>
      <div className="list" style={{ gap: 0 }}>
        {GROUP_MUSCLES[g].map(slug => <MuscleRow key={slug} slug={slug} value={recovery[slug]} />)}
      </div>
    </div>)}
    <div style={{ height: 20 }} />
  </div>
}
