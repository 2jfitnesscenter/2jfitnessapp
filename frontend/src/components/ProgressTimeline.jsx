// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useMemo } from 'react'
import { t } from '../lib/i18n.js'
import { fmtDate, fmtVol } from '../lib/format.js'
import { progressTimeline } from '../lib/timeline.js'
import { describeEvent } from './Mi2JEvents.jsx'
import { workoutDetailSheet } from '../sheets.jsx'
import Icon from './Icon.jsx'

/* Progress timeline (optional module — admin 'timeline' ∧ member preference ∧ data): the latest sessions, newest first,
   each with what it earned. Records are gold (the one place gold is allowed here), everything else uses the accent.
   Pure read of S.workouts; tapping a session opens the same detail sheet as everywhere else. */
export default function ProgressTimeline({ S, max = 6 }) {
  const items = useMemo(() => progressTimeline(S, { max }), [S.workouts, S.badges, S.ux, S.bodyweight, max])
  if (!items.length) return null
  return <div className="card v2-tl">
    <h2>{t('Progress timeline')}</h2>
    <ol className="v2-tl-list">
      {items.map((it, i) => {
        const w = S.workouts.find(x => x.id === it.id)
        return <li key={it.id} className="v2-tl-item v2-rise" style={{ animationDelay: Math.min(i, 5) * 40 + 'ms' }}>
          <span className={'v2-tl-dot' + (it.events.some(e => e.type === 'pr') ? ' gold' : '')} aria-hidden="true" />
          <button type="button" className="v2-tl-main" onClick={() => w && workoutDetailSheet(w)}>
            <span className="v2-tl-date">{fmtDate(it.d, true)}</span>
            <span className="v2-tl-name">{it.name}</span>
            <span className="v2-tl-sub">{t('{0} sets · {1}', it.sets, fmtVol(it.vol, S.unit))}</span>
          </button>
          {it.events.slice(0, 3).map(ev => {
            const d = describeEvent(ev, S.unit)
            return <div key={ev.id} className={'v2-tl-ev' + (ev.type === 'pr' ? ' gold' : '')}>
              <Icon name={d.icon || (ev.type === 'badge' ? 'medal' : 'chartLine')} />
              <span className="min0"><b>{d.title}</b>{d.result ? ' · ' + d.result : ''}</span>
            </div>
          })}
        </li>
      })}
    </ol>
  </div>
}
