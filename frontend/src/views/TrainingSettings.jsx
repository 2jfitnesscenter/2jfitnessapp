import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { wakeLockSupported } from '../lib/wakelock.js'
import { t } from '../lib/i18n.js'
import { MOBILE } from '../lib/mobile.js'
import { DUMBBELL_WEIGHTS_2J, MACHINE_WEIGHTS_CONFIG, BARBELL_PLATES_2J } from '../lib/equipment.js'
import Icon from '../components/Icon.jsx'
import { Section, Row, Switch, Slider } from '../components/ui.jsx'

const DEFAULT_INC = { barbell: 5, dumbbell: 2, machineOther: 5 }

// Settings → Training. Two things live here: whether a fresh set starts pre-filled with a
// ghost of last time's numbers (lib/history.js's buildSets, views/Workout.jsx's cell()), and
// what the weight +/- stepper jumps by — the gym's real rack/pins/plates by default
// (lib/equipment.js's stepWeight), or a member's own flat increment per equipment class once
// that's switched off.
export default function TrainingSettings() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const wakeOK = wakeLockSupported()
  const use2J = S.use2JRoomEquipment !== false
  const inc = S.customIncrements || DEFAULT_INC
  const setInc = (k, v) => update(s => { s.customIncrements = { ...(s.customIncrements || DEFAULT_INC), [k]: v } })

  return <div className="narrow">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/settings')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Training')}</h1></div>
    </div>

    <Section title={t('Previous results')}>
      <Row icon="history" iconTint="var(--blue)" title={t('Show previous results')}
        subtitle={t('Shows your last mark or reference set in gray while training.')}>
        <Switch checked={S.showPreviousResults !== false} onChange={v => update(s => { s.showPreviousResults = v })} />
      </Row>
    </Section>

    <Section title={t('Room equipment')}>
      <Row icon="dumbbell" iconTint="var(--acc)" title={t('2J Fitness Center room mode')}
        subtitle={t('Adjusts the +/- buttons to this gym’s real dumbbells and machines.')}>
        <Switch checked={use2J} onChange={v => update(s => { s.use2JRoomEquipment = v })} />
      </Row>
    </Section>

    <Section title={t('Weight step button')}
      footer={use2J ? null : t('Applies to every exercise that uses that equipment.')}>
      {use2J ? <>
        <Row icon="dumbbell" iconTint="var(--blue)" title={t('Dumbbells')}
          value={t('{0} to {1} kg', DUMBBELL_WEIGHTS_2J[0], DUMBBELL_WEIGHTS_2J[DUMBBELL_WEIGHTS_2J.length - 1])} />
        <Row icon="scale" iconTint="var(--teal)" title={t('Machines')}
          value={t('steps of {0} kg', MACHINE_WEIGHTS_CONFIG.step)} />
        <Row icon="barbell" iconTint="var(--orange)" title={t('Barbell')}
          value={t('plates {0} to {1} kg', BARBELL_PLATES_2J[0], BARBELL_PLATES_2J[BARBELL_PLATES_2J.length - 1])} />
      </> : <div style={{ padding: '2px 2px 12px' }}>
        <IncrementSlider icon="barbell" tint="var(--orange)" label={t('Barbell')} unit={S.unit}
          value={inc.barbell} min={1} max={20} step={0.5} onChange={v => setInc('barbell', v)} />
        <IncrementSlider icon="dumbbell" tint="var(--blue)" label={t('Dumbbell')} unit={S.unit}
          value={inc.dumbbell} min={0.5} max={10} step={0.5} onChange={v => setInc('dumbbell', v)} />
        <IncrementSlider icon="scale" tint="var(--teal)" label={t('Machine / cable')} unit={S.unit}
          value={inc.machineOther} min={1} max={20} step={1} onChange={v => setInc('machineOther', v)} />
      </div>}
    </Section>

    {(wakeOK || !MOBILE) && <Section title={t('Other')}>
      <Row icon="sun" iconTint="var(--yellow)" title={t('Keep screen awake')}
        subtitle={wakeOK ? null : t('Not supported in this browser.')}>
        <Switch checked={wakeOK && S.keepAwake !== false} disabled={!wakeOK}
          onChange={v => update(s => { s.keepAwake = v })} />
      </Row>
    </Section>}
  </div>
}

function IncrementSlider({ icon, tint, label, value, unit, min, max, step, onChange }) {
  return <div style={{ marginBottom: 18 }}>
    <div className="row between" style={{ marginBottom: 8 }}>
      <span className="row" style={{ gap: 10 }}>
        <span className="lrow-i" style={{ '--tint': tint }}><Icon name={icon} /></span>
        <span className="lrow-t">{label}</span>
      </span>
      <span className="dim small">{value} {unit}</span>
    </div>
    <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
  </div>
}
