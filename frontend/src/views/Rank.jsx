import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, nameFor } from '../lib/i18n.js'
import { lastBW } from '../lib/history.js'
import { musclesOf, MUSCLE_NAME } from '../lib/muscles.js'
import { EXIDX } from '../lib/exercises.js'
import {
  TIERS, RANK_LIFTS, RANK_GROUPS, RANK_GROUP_KEYS, RANK_GROUP_NAME,
  liftRatio, rankOfLift, muscleRank, groupRank, globalRank, TIER_COLOR, rankLabel,
} from '../lib/rank.js'
import Icon from '../components/Icon.jsx'
import BodyMap from '../components/BodyMap.jsx'
import { Button } from '../components/ui.jsx'

function RankBadge({ rank, small }) {
  if (!rank) return <span className="dim small">{t('No data yet')}</span>
  return <span className="row" style={{ gap: 4, color: TIER_COLOR[rank.tier], flex: 'none' }}>
    <Icon name="shield" style={{ fontSize: small ? 13 : 16 }} />
    <span className="small" style={{ fontWeight: 600 }}>{rankLabel(rank)}</span>
  </span>
}

// Also opened straight from Settings ("Rangos") for anyone who wants to read how the system
// works without having logged a single set yet — so this never assumes S/bodyweight exist.
export function RankGuideSheet() {
  return <>
    <h3>{t('How strength rank works')}</h3>
    <h4 className="sec" style={{ marginTop: 0 }}>{t('About')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Your rank in each lift comes from your best set, weighed against your bodyweight — the same idea powerlifting uses to compare weight classes, so a lighter and a heavier lifter compete fairly. No need to test a true max: your normal working sets are enough.')}
    </div>
    <h4 className="sec">{t('How it’s calculated')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Exercise ranks that train a muscle combine into that muscle\'s rank, weighing exercises with more sets more heavily. Muscles combine into a group rank (chest, back, shoulders, arms, legs, core), and every group combines into one overall rank — a complete physique outweighs a single strong lift.')}
    </div>
    <h4 className="sec">{t('The 9 tiers')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 10 }}>
      {t('From {0} to {1}, each with three divisions — I, II and III. You move up a division, then the next one, before moving into the next tier. {2} is the top, for the very strongest lifts, and has no divisions.', t('Iron'), t('Champion'), t('Symmetric'))}
    </div>
    <div className="chips" style={{ marginBottom: 14 }}>
      {TIERS.map(tier => <span key={tier} className="chip nocap" style={{ color: TIER_COLOR[tier] }}>{t(tier)}</span>)}
    </div>
    <h4 className="sec">{t('What you need')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5, marginBottom: 14 }}>
      {t('Log your bodyweight, then log sets for any of {0} curated lifts (bench press, squat, deadlift, overhead press, pull-up, chin-up, dip, row, romanian deadlift, curl, calf raise) — each ranks on its own as soon as it has one. The overall rank needs at least {1} of them.', RANK_LIFTS.length, 6)}
    </div>
    <h4 className="sec">{t('Keep in mind')}</h4>
    <div className="small dim" style={{ lineHeight: 1.5 }}>
      {t('Ranks are checked against published strength standards, not against this gym\'s own members — there aren\'t enough accounts here for a real comparison yet. Treat the tiers as a rough guide and not a certified measurement.')}
    </div>
  </>
}

export default function Rank() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const openSheet = useUI(s => s.openSheet)
  const [openGroup, setOpenGroup] = useState(null)
  const [openMuscle, setOpenMuscle] = useState(null)

  const bw = lastBW(S)

  const header = <div className="hdr">
    <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
    <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('Strength rank')}</h1></div>
    <button className="iconbtn" onClick={() => openSheet(() => <RankGuideSheet />)} aria-label={t('How strength rank works')}><Icon name="info" /></button>
  </div>

  if (!bw) return <div className="narrow">
    {header}
    <div className="empty"><div className="ico"><Icon name="shield" /></div>{t('Log your bodyweight to see your strength rank')}</div>
    <Button onClick={() => nav('/profile')}>{t('Profile')}</Button>
  </div>

  const global = globalRank(S)
  const colorOf = slug => { const r = muscleRank(S, slug); return r ? TIER_COLOR[r.tier] : 'var(--surface-3)' }

  return <div className="narrow">
    {header}

    <div className="card" style={{ textAlign: 'center' }}>
      {global.locked ? <>
        <div style={{ fontSize: 44, display: 'flex', justifyContent: 'center', color: 'var(--label-2)' }}><Icon name="shield" /></div>
        <div className="tt" style={{ fontWeight: 600, marginTop: 8 }}>{t('Ranked {0} of {1} exercises', global.rankedCount, RANK_LIFTS.length)}</div>
        <div className="muted small" style={{ marginTop: 2 }}>{t('Log {0} more to unlock your overall rank', global.needed - global.rankedCount)}</div>
      </> : <>
        <div style={{ fontSize: 52, display: 'flex', justifyContent: 'center', color: TIER_COLOR[global.tier] }}><Icon name="shield" /></div>
        <div style={{ fontWeight: 700, fontSize: 22, marginTop: 6, color: TIER_COLOR[global.tier] }}>{rankLabel(global)}</div>
        <div className="muted small" style={{ marginTop: 2 }}>{t('Overall rank')}</div>
      </>}
    </div>

    <BodyMap colorOf={colorOf} body={S.body} />

    <div style={{ height: 8 }} />
    {RANK_GROUP_KEYS.map(g => {
      const gr = groupRank(S, g)
      const isOpen = openGroup === g
      return <div key={g} className="card" style={{ marginBottom: 10 }}>
        <button className="row between" style={{ width: '100%' }} onClick={() => { setOpenGroup(isOpen ? null : g); setOpenMuscle(null) }}>
          <span className="tt">{t(RANK_GROUP_NAME[g])}</span>
          <span className="row" style={{ gap: 10 }}>
            <RankBadge rank={gr} />
            <Icon name={isOpen ? 'chevronUp' : 'chevronDown'} style={{ fontSize: 14 }} />
          </span>
        </button>
        {isOpen && <div style={{ marginTop: 8 }}>
          {RANK_GROUPS[g].map(slug => {
            const mr = muscleRank(S, slug)
            const mOpen = openMuscle === slug
            const lifts = RANK_LIFTS.filter(l => (musclesOf(EXIDX[l.id]) || {})[slug])
            return <div key={slug} style={{ borderTop: 'var(--hair) solid var(--sep)' }}>
              <button className="row between" style={{ width: '100%', padding: '10px 0' }} onClick={() => setOpenMuscle(mOpen ? null : slug)}>
                <span className="small" style={{ fontWeight: 600 }}>{t(MUSCLE_NAME[slug])}</span>
                <span className="row" style={{ gap: 10 }}>
                  <RankBadge rank={mr} small />
                  {lifts.length > 0 && <Icon name={mOpen ? 'chevronUp' : 'chevronDown'} style={{ fontSize: 12 }} />}
                </span>
              </button>
              {mOpen && (lifts.length ? <div style={{ paddingBottom: 8 }}>
                {lifts.map(l => {
                  const ex = EXIDX[l.id]
                  const lr = rankOfLift(l.id, liftRatio(S, l.id), S.body)
                  return <div key={l.id} className="row between" style={{ padding: '5px 0 5px 10px' }}>
                    <span className="small capitalize">{nameFor(ex)}</span>
                    <RankBadge rank={lr} small />
                  </div>
                })}
              </div> : <div className="small dim" style={{ paddingBottom: 8 }}>{t('No data yet')}</div>)}
            </div>
          })}
        </div>}
      </div>
    })}
    <div style={{ height: 20 }} />
  </div>
}
