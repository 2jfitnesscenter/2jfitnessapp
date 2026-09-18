import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t } from '../lib/i18n.js'
import { fmtDate } from '../lib/format.js'
import { BADGE_CATEGORIES, CATEGORY_LABEL, CATEGORY_ICON, BADGES_BY_CATEGORY } from '../lib/badges-data.js'
import { evaluateBadges } from '../lib/badges.js'
import Icon from '../components/Icon.jsx'
import { Button } from '../components/ui.jsx'

// Tap-to-expand detail — description, and how close you are if it's still locked (the
// percentage the grid cell itself only hints at with a sliver of progress bar).
function BadgeDetail({ b, state, close }) {
  const unlocked = !!state?.unlockedAt
  const pct = Math.round((state?.progress || 0) * 100)
  return <div style={{ textAlign: 'center', padding: '8px 0' }}>
    <span className={'badgecell-i' + (unlocked ? ' on' : '')} style={{ width: 84, height: 84, fontSize: 36, margin: '0 auto 14px' }}>
      <Icon name={b.icon} />
      {!unlocked && <span className="badgecell-lock" style={{ width: 28, height: 28, fontSize: 14 }}><Icon name="lock" /></span>}
    </span>
    <h3 style={{ margin: '0 0 6px' }}>{t(b.title)}</h3>
    <div className="muted small" style={{ lineHeight: 1.5, marginBottom: 16 }}>{t(b.description)}</div>
    {unlocked ? (
      <div className="tag acc nocap" style={{ display: 'inline-flex' }}>{t('Unlocked {0}', fmtDate(state.unlockedAt.slice(0, 10), true))}</div>
    ) : (
      <>
        <div className="badgecell-bar" style={{ marginBottom: 6 }}><i style={{ width: pct + '%' }} /></div>
        <div className="dim small">{t('{0}% there', pct)}</div>
      </>
    )}
    <div style={{ height: 16 }} />
    <Button onClick={close}>{t('Close')}</Button>
  </div>
}
const badgeDetailSheet = (b, state) => useUI.getState().openSheet(close => <BadgeDetail b={b} state={state} close={close} />, { kind: 'center' })

function BadgeCell({ b, state }) {
  const unlocked = !!state?.unlockedAt
  const pct = Math.round((state?.progress || 0) * 100)
  return (
    <button className={'badgecell' + (unlocked ? ' on' : '')} onClick={() => badgeDetailSheet(b, state)}>
      <span className="badgecell-i">
        <Icon name={b.icon} />
        {!unlocked && <span className="badgecell-lock"><Icon name="lock" /></span>}
      </span>
      <span className="badgecell-t">{t(b.title)}</span>
      {unlocked
        ? <span className="badgecell-s">{fmtDate(state.unlockedAt.slice(0, 10))}</span>
        : <span className="badgecell-s">{t(b.description)}</span>}
      {!unlocked && pct > 0 && <div className="badgecell-bar"><i style={{ width: pct + '%' }} /></div>}
    </button>
  )
}

// A category's own header — its representative badge (the first one in it, biggest/brightest
// among its siblings — usually the lowest threshold, so it's realistically unlocked early)
// blown up large, plus how many of the category are unlocked so far.
function CategoryHeader({ cat, list, unlockedCount }) {
  const rep = list[0]
  return <div className="card" style={{ textAlign: 'center', marginBottom: 16 }}>
    <span className="badgecell-i" style={{ width: 72, height: 72, fontSize: 30, margin: '0 auto 10px' }}>
      <Icon name={CATEGORY_ICON[cat]} />
    </span>
    <h2 style={{ margin: '0 0 4px' }}>{t(CATEGORY_LABEL[cat])}</h2>
    <div className="muted small">{rep ? t(rep.description) : null}</div>
    <div className="dim small" style={{ marginTop: 6 }}>{t('{0} of {1} unlocked', unlockedCount, list.length)}</div>
  </div>
}

export default function Badges() {
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)

  // Catches up an existing profile's history the first time this screen opens — silently
  // (no celebration; see sheets.jsx's celebrateBadges, which only fires from a live finish
  // or a fresh import) — so someone who already had 50 workouts logged before this feature
  // shipped sees them correctly unlocked instead of waiting for their next session.
  useEffect(() => {
    const { badges, newlyUnlocked } = evaluateBadges(S)
    if (newlyUnlocked.length) update(s => { s.badges = badges }, false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const cats = BADGE_CATEGORIES.filter(c => BADGES_BY_CATEGORY[c].length)
  const [cat, setCat] = useState(cats[0])
  const list = BADGES_BY_CATEGORY[cat] || []
  const unlockedCount = list.filter(b => S.badges?.[b.id]?.unlockedAt).length

  return <div className="narrow">
    <div className="hdr"><div><h1>{t('Badges')}</h1></div></div>

    <div className="mstrip">
      {cats.map(c => {
        const n = BADGES_BY_CATEGORY[c].filter(b => S.badges?.[b.id]?.unlockedAt).length
        return (
          <button key={c} className={'mstrip-i' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>
            <span className="mstrip-photo mstrip-photo-plain"><Icon name={CATEGORY_ICON[c]} /></span>
            <span className="mstrip-name">{t(CATEGORY_LABEL[c])} ({n}/{BADGES_BY_CATEGORY[c].length})</span>
          </button>
        )
      })}
    </div>
    <div style={{ height: 10 }} />

    <CategoryHeader cat={cat} list={list} unlockedCount={unlockedCount} />

    <div className="badgegrid">
      {list.map(b => <BadgeCell key={b.id} b={b} state={S.badges?.[b.id]} />)}
    </div>
    <div style={{ height: 20 }} />
  </div>
}
