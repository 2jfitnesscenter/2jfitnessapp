// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { t } from '../lib/i18n.js'
import { workingSetsDone } from '../lib/workout-prefs.js'

/* Optional row of numbered chips at the top of the live workout (Settings → Training → Visual):
   one per exercise, filled when that exercise's working sets are all done, the current one ringed.
   Tapping a chip calls onGo(entryIndex) — the same `cur` jump the progress dots use. Presentation
   only: it reads the session and never writes a set. Plain function, no hooks, so it can be
   rendered or called directly. */
export default function ExerciseChips({ entries, cur, onGo }) {
  return <nav className="ex-chips" aria-label={t('Exercises')}>
    {entries.map((e, i) => {
      const done = workingSetsDone(e.sets)
      return <button key={i} type="button" aria-current={i === cur ? 'step' : undefined}
        aria-label={t('Exercise {0} / {1}', i + 1, entries.length) + (done ? ' · ' + t('done') : '')}
        className={'ex-chip' + (done ? ' done' : '') + (i === cur ? ' cur' : '')} onClick={() => onGo(i)}>{i + 1}</button>
    })}
  </nav>
}
