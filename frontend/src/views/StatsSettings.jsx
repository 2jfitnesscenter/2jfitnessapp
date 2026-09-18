import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { SECONDARY_FACTORS } from '../lib/muscles.js'
import { Section, Row, Switch, SelectRow } from '../components/ui.jsx'

// Settings → Statistics. Both knobs here flow through lib/muscles.js's muscleOptsOf into
// every loadOf/musclesOf call that has `S` in scope — the muscle map, muscle recovery and the
// Progress screen's own muscle-balance card all read the same two settings, so turning
// secondaries off (or changing their weight) is consistent everywhere at once rather than a
// per-screen setting that could quietly disagree with itself.
export default function StatsSettings() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const countSecondary = S.countSecondaryMuscles !== false

  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Statistics')}</h1></div></div>

    <Section title={t('Muscle volume')} footer={t('Applies to the muscle map, muscle recovery and the Progress screen’s muscle balance.')}>
      <Row icon="figureStrength" iconTint="var(--acc)" title={t('Count secondary muscles in data')}
        subtitle={t('A bench press also credits triceps and shoulders, not just chest.')}>
        <Switch checked={countSecondary} onChange={v => update(s => { s.countSecondaryMuscles = v })} />
      </Row>
      {countSecondary && <SelectRow icon="scale" iconTint="var(--teal)" title={t('Secondary muscle factor')}
        sheetTitle={t('Secondary muscle factor')}
        value={S.secondaryMuscleFactor ?? 0.5} onChange={v => update(s => { s.secondaryMuscleFactor = v })}
        options={SECONDARY_FACTORS.map(f => ({ value: f, label: `× ${f}`, subtitle: t('{0} sets credit {1} sets to a secondary muscle', 4, Math.round(4 * f * 100) / 100) }))} />}
    </Section>
  </div>
}
