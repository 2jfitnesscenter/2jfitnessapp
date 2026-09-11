import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, nameFor } from '../lib/i18n.js'
import { fmtDate, fmtNum, uid, exCount } from '../lib/format.js'
import { setLabel, modeOf, exLine } from '../lib/history.js'
import { exOr, extractCustomDefs, mergeCustomDefs } from '../lib/exercises.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from '../components/Icon.jsx'
import { Button, Segmented, TextArea } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import {
  fetchSocialRoutines, publishSocialRoutine, rateSocialRoutine, deleteSocialRoutine,
  fetchWall, publishWallPost, deleteWallPost,
  fetchTrainerMembers, assignRoutineToMember
} from '../lib/social-api.js'

// Tap-to-rate when `onRate` is given, a plain readout otherwise (e.g. showing someone else's
// average). Rounds to the nearest whole star for the fill — half-stars would need a second
// icon/mask this hand-drawn set doesn't have, and a rounded average reads fine at this size.
function Stars({ value, onRate }) {
  const full = Math.round(value || 0)
  return <div className="row" style={{ gap: 2 }}>
    {[1, 2, 3, 4, 5].map(n => (
      <button key={n} className="iconbtn" style={{ width: 30, height: 30, color: n <= full ? 'var(--yellow)' : 'var(--label-2)', cursor: onRate ? 'pointer' : 'default' }}
        onClick={onRate ? () => onRate(n) : undefined} aria-label={String(n)}>
        <Icon name={n <= full ? 'starFill' : 'star'} />
      </button>
    ))}
  </div>
}

function RoutineCard({ post, onOpen }) {
  return <div className="item" onClick={() => onOpen(post)}>
    <span className="lrow-i"><Icon name={glyphOf(post.emoji)} /></span>
    <div className="grow">
      <div className="tt">{post.name}</div>
      <div className="ss capitalize">{post.authorName} · {exCount(post.ex.length)}</div>
    </div>
    {post.ratingCount ? <span className="tag acc"><Icon name="starFill" />{fmtNum(post.avgStars)} ({post.ratingCount})</span> : <span className="tag">{t('No ratings yet')}</span>}
    <Icon name="chevronRight" className="chev" />
  </div>
}

function PublishRoutineSheet({ routines, onPublish, close }) {
  return <>
    <h3>{t('Publish a routine')}</h3>
    <div className="muted small" style={{ margin: '6px 0 10px' }}>{t('Choose one of your own routines to share.')}</div>
    {routines.length ? <div className="list">
      {routines.map(r => <div key={r.id} className="item" onClick={() => { close(); onPublish(r) }}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
      </div>)}
    </div> : <div className="empty">{t('You have no routines yet.')}</div>}
  </>
}

function MemberPickerSheet({ members, onPick, close }) {
  const [q, setQ] = useState('')
  const ql = q.toLowerCase().trim()
  const f = ql ? members.filter(m => m.name.toLowerCase().includes(ql)) : members
  return <>
    <h3>{t('Assign to a member')}</h3>
    <div className="search" style={{ margin: '6px 0 10px' }}><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
      <input className="input" placeholder={t('Search {0} members…', members.length)} value={q} onChange={e => setQ(e.target.value)} /></div>
    <div className="list">
      {f.map(m => <div key={m.id} className="item capitalize" onClick={() => { close(); onPick(m.id) }}>
        <div className="grow"><div className="tt">{m.name}</div></div>
      </div>)}
      {!f.length && <div className="empty">{t('No match')}</div>}
    </div>
  </>
}

function RoutineDetailSheet({ post: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [post, setPost] = useState(initial)
  const [busy, setBusy] = useState(false)
  const customMap = Object.fromEntries((post.customExDefs || []).map(d => [d.id, d]))
  const resolveEx = id => customMap[id] || exOr(id)
  const isOwn = post.authorId === user.id
  const canManage = isOwn || user.admin

  const rate = stars => {
    rateSocialRoutine(post.id, stars)
      .then(res => setPost(p => ({ ...p, avgStars: res.avgStars, ratingCount: res.ratingCount, myStars: res.myStars })))
      .catch(e => toast(e.message))
  }
  const copy = () => {
    const r = { id: uid(), name: post.name, emoji: post.emoji, ex: JSON.parse(JSON.stringify(post.ex)) }
    if (post.prog) r.prog = post.prog
    update(s => { s.routines.push(r); s.customEx = mergeCustomDefs(post.customExDefs, s.customEx) })
    toast(t('Added to your routines'))
    close()
  }
  const del = () => confirmSheet({
    title: t('Delete this routine?'), message: t('This removes it from Social for everyone.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteSocialRoutine(post.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })
  const assign = () => {
    setBusy(true)
    fetchTrainerMembers().then(members => {
      setBusy(false)
      openSheet(close2 => <MemberPickerSheet members={members} close={close2} onPick={memberId => {
        assignRoutineToMember(post.id, memberId).then(() => toast(t('Assigned to {0}', members.find(m => m.id === memberId)?.name || '')))
          .catch(e => toast(e.message))
      }} />)
    }).catch(e => { setBusy(false); toast(e.message) })
  }

  return <>
    <h3>{post.name}</h3>
    <div className="muted small capitalize" style={{ margin: '4px 0 10px' }}>
      {post.authorName} · {post.authorKind === 'trainer' ? t('Trainer') : t('Member')}
    </div>
    <div className="row between" style={{ margin: '0 0 4px' }}>
      <Stars value={post.avgStars || 0} />
      <span className="small muted">{post.ratingCount ? t('{0} ratings', post.ratingCount) : t('No ratings yet')}</span>
    </div>
    {!isOwn && <>
      <div className="dim small" style={{ margin: '8px 0 4px' }}>{t('Your rating')}</div>
      <Stars value={post.myStars || 0} onRate={rate} />
    </>}
    <h4 className="sec" style={{ marginTop: 14 }}>{t('Exercises')}</h4>
    <div className="list" style={{ marginBottom: 12 }}>
      {post.ex.map((e, i) => {
        const ex = resolveEx(e.id)
        return <div key={i} className="item">
          <div className="grow"><div className="tt capitalize">{nameFor(ex)}</div>
            <div className="ss">{exLine(e, S.unit)}</div></div>
        </div>
      })}
    </div>
    <Button variant="primary" style={{ width: '100%', marginBottom: 8 }} onClick={copy}>{t('Copy to my routines')}</Button>
    {user.trainer && isOwn && post.authorKind === 'trainer' &&
      <Button style={{ width: '100%', marginBottom: 8 }} disabled={busy} onClick={assign}>{t('Assign to a member')}</Button>}
    {canManage && <button className="btn danger" style={{ width: '100%' }} onClick={del}>{t('Delete')}</button>}
  </>
}

// Publishing a Wall post is a 3-step pick, never free text for the record itself: an exercise
// the member has actually trained → one specific done set logged for it → an optional note. The
// server re-checks the chosen set against the member's own history anyway (api/server.js), so
// this picker is what keeps the flow honest, not what enforces it.
function WallPublishSheet({ S, onPublished, close }) {
  const toast = useUI(s => s.toast)
  const [step, setStep] = useState('exercise')
  const [exId, setExId] = useState(null)
  const [chosen, setChosen] = useState(null)   // { d, s, mode }
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const trained = []
  const seen = new Set()
  for (let i = S.workouts.length - 1; i >= 0; i--) {
    S.workouts[i].entries.forEach(e => {
      if (!seen.has(e.id) && e.sets.some(s => s.done)) { seen.add(e.id); trained.push(e.id) }
    })
  }

  if (step === 'exercise') return <>
    <h3>{t('Pick an exercise')}</h3>
    <div className="list">
      {trained.map(id => {
        const ex = exOr(id)
        return <div key={id} className="item" onClick={() => { setExId(id); setStep('set') }}>
          <div className="grow"><div className="tt capitalize">{nameFor(ex)}</div></div>
          <Icon name="chevronRight" className="chev" />
        </div>
      })}
      {!trained.length && <div className="empty">{t('Log a workout first.')}</div>}
    </div>
  </>

  if (step === 'set') {
    const candidates = []
    S.workouts.forEach(w => {
      const entry = w.entries.find(e => e.id === exId)
      if (!entry) return
      const mode = modeOf({ ...(entry.target || {}), id: exId })
      entry.sets.forEach(s => { if (s.done) candidates.push({ d: w.d, s, mode }) })
    })
    candidates.reverse()
    return <>
      <h3>{t('Pick a set')}</h3>
      <div className="muted small capitalize" style={{ margin: '4px 0 10px' }}>{nameFor(exOr(exId))}</div>
      <div className="list">
        {candidates.map((c, i) => <div key={i} className="item" onClick={() => { setChosen(c); setStep('note') }}>
          <div className="grow"><div className="tt">{setLabel(exId, c.s, { mode: c.mode })}</div><div className="ss">{fmtDate(c.d, true)}</div></div>
        </div>)}
        {!candidates.length && <div className="empty">{t('No logged sets for this exercise.')}</div>}
      </div>
    </>
  }

  const publish = () => {
    setBusy(true)
    const value = chosen.mode === 'cardio' ? { min: chosen.s.min, speed: chosen.s.speed }
      : chosen.mode === 'time' ? { sec: chosen.s.sec, w: chosen.s.w || 0 }
      : { w: chosen.s.w, r: chosen.s.r }
    publishWallPost({ exId, exName: nameFor(exOr(exId)), mode: chosen.mode, value, sourceDate: chosen.d, note: note.trim().slice(0, 140) })
      .then(() => { toast(t('Posted to the Wall')); onPublished(); close() })
      .catch(e => { setBusy(false); toast(e.message) })
  }
  return <>
    <h3>{t('Add a note (optional)')}</h3>
    <div className="muted small capitalize" style={{ margin: '4px 0 10px' }}>{nameFor(exOr(exId))} · {setLabel(exId, chosen.s, { mode: chosen.mode })}</div>
    <TextArea value={note} onChange={e => setNote(e.target.value)} maxLength={140} rows={3} placeholder={t('e.g. “Bar felt light today”')} />
    <div style={{ height: 10 }} />
    <Button variant="primary" disabled={busy} onClick={publish}>{t('Post to the Wall')}</Button>
  </>
}

export default function Social() {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [tab, setTab] = useState('routines')
  const [routines, setRoutines] = useState(null)
  const [wall, setWall] = useState(null)

  const loadRoutines = () => fetchSocialRoutines().then(setRoutines).catch(e => toast(e.message))
  const loadWall = () => fetchWall().then(setWall).catch(e => toast(e.message))

  useEffect(() => { loadRoutines() }, [])
  useEffect(() => { if (tab === 'wall' && wall === null) loadWall() }, [tab])

  const publish = () => {
    if (!S.routines.length) { toast(t('You have no routines yet.')); return }
    openSheet(close => <PublishRoutineSheet routines={S.routines} close={close} onPublish={r => {
      publishSocialRoutine({ name: r.name, emoji: r.emoji, prog: r.prog, ex: r.ex, customExDefs: extractCustomDefs(r, S) })
        .then(() => { toast(t('Published')); loadRoutines() }).catch(e => toast(e.message))
    }} />)
  }
  const openDetail = post => openSheet(close => <RoutineDetailSheet post={post} onChanged={loadRoutines} close={close} />)
  const publishWall = () => openSheet(close => <WallPublishSheet S={S} close={close} onPublished={loadWall} />)
  const delWall = post => confirmSheet({
    title: t('Delete this post?'), confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteWallPost(post.id).then(loadWall).catch(e => toast(e.message))
  })

  const memberRoutines = (routines || []).filter(r => r.authorKind !== 'trainer')
  const trainerRoutines = (routines || []).filter(r => r.authorKind === 'trainer')

  return <div className="narrow">
    <div className="hdr">
      <div><h1>{t('Social')}</h1><div className="sub">{t('Share and discover, gym-wide')}</div></div>
    </div>
    <Segmented options={[{ value: 'routines', label: t('Routines') }, { value: 'wall', label: t('Wall') }, { value: 'trainers', label: t('Trainers') }]} value={tab} onChange={setTab} />
    <div style={{ height: 14 }} />

    {tab === 'routines' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Routines')}</h4>
        <Button size="sm" variant="tinted" icon="upload" onClick={publish}>{t('Publish')}</Button>
      </div>
      {routines === null ? <div className="muted small">{t('Loading…')}</div> :
        memberRoutines.length ? <div className="list">{memberRoutines.map(p => <RoutineCard key={p.id} post={p} onOpen={openDetail} />)}</div> :
          <div className="empty"><div className="ico"><Icon name="users" /></div>{t('No routines published yet.')}<br />{t('Be the first to share one.')}</div>}
    </>}

    {tab === 'wall' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Wall')}</h4>
        <Button size="sm" variant="tinted" icon="upload" onClick={publishWall}>{t('Post a record')}</Button>
      </div>
      {wall === null ? <div className="muted small">{t('Loading…')}</div> :
        wall.length ? <div className="list">{wall.map(p => <div key={p.id} className="item">
          <span className="lrow-i"><Icon name="trophy" /></span>
          <div className="grow">
            <div className="tt capitalize">{p.exName}</div>
            <div className="ss capitalize">{p.authorName} · {setLabel(p.exId, p.value, { mode: p.mode })} · {fmtDate(p.sourceDate, true)}</div>
            {p.note && <div className="ss dim">“{p.note}”</div>}
          </div>
          {(p.authorId === user.id || user.admin) && <button className="iconbtn" onClick={() => delWall(p)} aria-label={t('Delete')}><Icon name="trash" /></button>}
        </div>)}</div> :
          <div className="empty"><div className="ico"><Icon name="trophy" /></div>{t('No records posted yet.')}<br />{t('Post one from a workout you already logged.')}</div>}
    </>}

    {tab === 'trainers' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Trainers')}</h4>
        {user.trainer && <Button size="sm" variant="tinted" icon="upload" onClick={publish}>{t('Publish')}</Button>}
      </div>
      {routines === null ? <div className="muted small">{t('Loading…')}</div> :
        trainerRoutines.length ? <div className="list">{trainerRoutines.map(p => <RoutineCard key={p.id} post={p} onOpen={openDetail} />)}</div> :
          <div className="empty"><div className="ico"><Icon name="medal" /></div>{t('No trainer routines yet.')}</div>}
    </>}
    <div style={{ height: 20 }} />
  </div>
}
