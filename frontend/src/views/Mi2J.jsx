// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { t, nameFor } from '../lib/i18n.js'
import { fmtDate, fmtNum } from '../lib/format.js'
import { EXIDX } from '../lib/exercises.js'
import { mediaUrl } from '../lib/media.js'
import { TIER_COLOR, rankLabel, rankEmblemUrl, RANK_GROUP_NAME, RANK_LIFTS } from '../lib/rank.js'
import { BADGES } from '../lib/badges-data.js'
import { rankSnapshot, personalRecords, unlockedBadges, closestBadges } from '../lib/mi2j.js'
import { streakWeeks } from '../lib/history.js'
import Icon from '../components/Icon.jsx'
import { Avatar, Button } from '../components/ui.jsx'

// The carnet: who this member is inside 2J, at a glance. Everything is derived (lib/mi2j.js).
export function Carnet({ S, user, snap, onRanks, compact }) {
  const g = snap.global
  const streak = streakWeeks(S)
  const records = compact ? null : personalRecords(S).length
  // Compact (inside Profile's own entry button): no second identity block — the Profile header
  // already shows the photo and name — and no nested button.
  const RankTag = compact ? 'span' : 'button'
  const rankTag = <RankTag className="carnet-rank" onClick={compact ? undefined : onRanks} aria-label={t('Overall rank') + ': ' + (g.locked ? t('locked') : rankLabel(g))}>
    {g.locked
      ? <><span className="carnet-lock"><Icon name="lock" /><b>{g.rankedCount}/{g.needed}</b></span><span className="carnet-rl">{t('Overall rank')}</span></>
      : <><img src={rankEmblemUrl(g.tier, g.division)} alt="" /><span className="carnet-rl" style={{ color: TIER_COLOR[g.tier] }}>{rankLabel(g)}</span></>}
  </RankTag>
  return <div className={'carnet' + (compact ? ' compact' : '')} style={!g.locked ? { '--carnet': TIER_COLOR[g.tier] } : undefined}>
    {compact ? <div className="carnet-top">{rankTag}</div> : <div className="carnet-top">
      <Avatar name={user?.name || t('Guest')} size={58} image={user?.avatar ? mediaUrl(user.avatar) : null} />
      <div className="carnet-id">
        <div className="carnet-kicker">2J Fitness Center</div>
        <div className="carnet-name">{user?.name || t('Guest')}</div>
        {user?.created && <div className="carnet-since">{t('Member since {0}', fmtDate(user.created.slice(0, 10)))}</div>}
      </div>
      {rankTag}
    </div>}
    <div className="carnet-stats">
      <div><b><Icon name="flame" />{streak}</b><span>{t(streak === 1 ? 'week in a row' : 'weeks in a row')}</span></div>
      <div><b>{S.workouts.length}</b><span>{t('workouts')}</span></div>
      {records != null ? <div><b>{records}</b><span>{t('lifts with a record')}</span></div>
        : <div><b>{snap.rankedCount}/{RANK_LIFTS.length}</b><span>{t('lifts ranked')}</span></div>}
    </div>
  </div>
}

export default function Mi2J() {
  const nav = useNavigate()
  const S = useStore(s => s.S)
  const user = useStore(s => s.user)
  // One derivation per history change, not per render.
  const snap = useMemo(() => rankSnapshot(S), [S.workouts, S.bodyweight, S.tests, S.body])
  const records = useMemo(() => personalRecords(S), [S.workouts])
  const unlocked = unlockedBadges(S)
  const near = useMemo(() => closestBadges(S, 2), [S.workouts, S.badges, S.bodyweight])
  const empty = !S.workouts.length

  const tiles = [
    { to: '/rank', icon: 'shield', title: t('My ranks'), sub: snap.hasBW ? t('{0} of {1} groups ranked', snap.groups.filter(g => g.rank).length, snap.groups.length) : t('Log your bodyweight to start'), art: !snap.global.locked ? rankEmblemUrl(snap.global.tier, snap.global.division) : null },
    { to: '/badges', icon: 'sparkles', title: t('My achievements'), sub: t('{0} of {1} unlocked', unlocked.length, BADGES.length), art: unlocked[0]?.badge.image },
    { to: '/records', icon: 'trophy', title: t('My records'), sub: records.length ? t('{0} exercises', records.length) : t('After your first sessions') },
    { to: '/stats', icon: 'chartLine', title: t('Progress'), sub: t('Charts and history') },
  ]

  return <div className="narrow mi2j">
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/profile')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1>{t('My 2J')}</h1></div>
    </div>

    <Carnet S={S} user={user} snap={snap} onRanks={() => nav('/rank')} />

    <div className="m2-tiles">
      {tiles.map(x => <button key={x.to} className="m2-tile" onClick={() => nav(x.to)}>
        <span className="m2-art">{x.art ? <img src={x.art} alt="" /> : <Icon name={x.icon} />}</span>
        <span className="m2-t">{x.title}</span>
        <span className="m2-s">{x.sub}</span>
      </button>)}
    </div>

    {empty ? <div className="card m2-empty">
      <div className="m2-empty-ic"><Icon name="figureStrength" /></div>
      <div className="tt">{t('Your journey starts here')}</div>
      <div className="muted small">{t('Your records, ranks and achievements will appear here as you train.')}</div>
      <Button variant="primary" icon="play" onClick={() => nav('/workout')}>{t('Start training')}</Button>
    </div> : <>
      {snap.groups.some(g => g.rank) && <>
        <h4 className="sec">{t('My ranks')}</h4>
        <div className="m2-ranks" role="list">
          {snap.groups.filter(g => g.rank).map(g => <button role="listitem" key={g.key} className="m2-rank" onClick={() => nav('/rank')}
            aria-label={t(RANK_GROUP_NAME[g.key]) + ': ' + rankLabel(g.rank)}>
            <img src={rankEmblemUrl(g.rank.tier, g.rank.division)} alt="" />
            <span className="m2-rank-g">{t(RANK_GROUP_NAME[g.key])}</span>
            <span className="m2-rank-l" style={{ color: TIER_COLOR[g.rank.tier] }}>{rankLabel(g.rank)}</span>
          </button>)}
        </div>
      </>}

      {records.length > 0 && <>
        <h4 className="sec">{t('Latest records')}</h4>
        <div className="list">
          {records.slice(0, 3).map(r => <div key={r.id} className="item" onClick={() => nav('/records')}>
            <span className="lrow-i" style={{ background: 'color-mix(in srgb,var(--yellow) 18%,transparent)', color: 'var(--yellow)' }}><Icon name="trophy" /></span>
            <div className="grow"><div className="tt capitalize">{EXIDX[r.id] ? nameFor(EXIDX[r.id]) : r.id}</div>
              <div className="ss">{fmtNum(r.best.w)} {S.unit} × {r.best.r} · {fmtDate(r.best.d)}</div></div>
          </div>)}
        </div>
      </>}

      {(unlocked.length > 0 || near.length > 0) && <>
        <h4 className="sec">{t('Achievements')}</h4>
        <div className="m2-badges">
          {unlocked.slice(0, 3).map(({ badge, unlockedAt }) => <button key={badge.id} className="m2-badge on" onClick={() => nav('/badges')}>
            {badge.image ? <img src={badge.image} alt="" /> : <Icon name={badge.icon} />}
            <span className="m2-badge-t">{t(badge.title)}</span>
            <span className="m2-badge-s">{fmtDate(unlockedAt.slice(0, 10))}</span>
          </button>)}
          {near.map(({ badge, progress }) => <button key={badge.id} className="m2-badge" onClick={() => nav('/badges')}>
            {badge.image ? <img src={badge.image} alt="" /> : <Icon name={badge.icon} />}
            <span className="m2-badge-t">{t(badge.title)}</span>
            <span className="m2-badge-s">{t('{0}% there', Math.round(progress * 100))}</span>
          </button>)}
        </div>
      </>}
    </>}
    <div style={{ height: 20 }} />
  </div>
}
