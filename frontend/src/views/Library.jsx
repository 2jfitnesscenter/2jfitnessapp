import { useStore } from '../store/useStore.js'
import { t } from '../lib/i18n.js'
import { exerciseBrowserSheet } from '../sheets.jsx'
import { Button } from '../components/ui.jsx'
import { MUSCLES, MUSCLE_NAME, musclePhotoUrl } from '../lib/muscles.js'

// The landing screen for Plan > Exercises: an illustrated chip per muscle group (male or
// female artwork per S.body, see public/muscles/) rather than the little body-map
// mannequin — tapping one opens the full browser (exerciseBrowserSheet) as its own sheet,
// already filtered to that muscle. "All exercises" is its own button rather than a tile,
// since "everything" isn't a muscle a chip can depict.
export default function Library() {
  const body = useStore(s => s.S.body)
  return <>
    <h4 className="sec" style={{ margin: '0 0 10px' }}>{t('By muscle')}</h4>
    <div className="mtiles">
      {MUSCLES.map(m => <button key={m} className="mtile" onClick={() => exerciseBrowserSheet(m)}>
        <span className="mtile-photo" style={{ backgroundImage: `url(${musclePhotoUrl(m, body)})` }} />
        <span className="mtile-name">{t(MUSCLE_NAME[m])}</span>
      </button>)}
      <button className="mtile" onClick={() => exerciseBrowserSheet('cardio')}>
        <span className="mtile-photo" style={{ backgroundImage: `url(${musclePhotoUrl('cardio', body)})` }} />
        <span className="mtile-name">{t('Cardio')}</span>
      </button>
    </div>
    <div style={{ height: 16 }} />
    <Button icon="exercises" onClick={() => exerciseBrowserSheet(null)}>{t('All exercises')}</Button>
  </>
}
