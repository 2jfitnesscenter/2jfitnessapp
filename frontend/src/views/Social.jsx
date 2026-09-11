import { useEffect, useRef, useState } from 'react'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { t, nameFor } from '../lib/i18n.js'
import { fmtDate, fmtNum, uid, exCount, routineCount } from '../lib/format.js'
import { setLabel, modeOf, exLine } from '../lib/history.js'
import { exOr, extractCustomDefs, mergeCustomDefs } from '../lib/exercises.js'
import { glyphOf } from '../lib/glyphs.js'
import Icon from '../components/Icon.jsx'
import { Thumb } from '../components/Media.jsx'
import { Button, Segmented, TextArea, SelectRow } from '../components/ui.jsx'
import { confirmSheet } from '../sheets.jsx'
import {
  fetchSocialRoutines, publishSocialRoutine, rateSocialRoutine, deleteSocialRoutine,
  fetchSocialPrograms, publishSocialProgram, rateSocialProgram, deleteSocialProgram,
  fetchWall, publishWallPost, deleteWallPost, postWallComment, deleteWallComment,
  fetchTrainerMembers, assignRoutineToMember, assignProgramToMember
} from '../lib/social-api.js'
import { resizeImageFile, uploadImage, mediaUrl, refetchAsDataUrl } from '../lib/media.js'

// Same "spec sheet" fields api/server.js's readSpecFields accepts — level/goal are fixed
// choices (goal reuses lib/starter.js's own GOALS, same labels the quick-plan intake uses, so
// "Build muscle" means the same thing whether it came from there or a Social publish).
const LEVELS = ['beginner', 'intermediate', 'advanced']
const LEVEL_LABEL = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced' }
const GOALS_LIST = ['hypertrophy', 'toning', 'fatloss', 'power', 'plyometrics', 'longevity']
const GOAL_LABEL = { hypertrophy: 'Build muscle', toning: 'Tone up', fatloss: 'Lose fat', power: 'Power', plyometrics: 'Plyometrics', longevity: 'Health & longevity' }

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

// A file input that reads the chosen photo and hands back a resized JPEG data URL (see
// lib/media.js's resizeImageFile) — this is what keeps an upload small without a bigger
// request-body cap or any server-side image library. `value` may start pre-filled with the
// routine/program's own already-uploaded cover (see PublishDetailsSheet).
function ImagePicker({ value, onChange }) {
  const inputRef = useRef(null)
  const toast = useUI(s => s.toast)
  const onFile = e => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    resizeImageFile(file).then(onChange).catch(err => toast(err.message))
  }
  return <div>
    <input ref={inputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
    {value ? <div style={{ position: 'relative' }}>
      <img src={value} alt="" style={{ width: '100%', maxHeight: 200, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
      <button className="iconbtn" style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.55)', color: '#fff' }}
        onClick={() => onChange(null)} aria-label={t('Remove image')}><Icon name="xmark" /></button>
    </div> : <Button icon="upload" onClick={() => inputRef.current?.click()}>{t('Add a photo (optional)')}</Button>}
  </div>
}

// Hero image bleeding to the sheet's own edges (the sheet has 18px of horizontal padding —
// negative-margined out here) + a centered "spec sheet" (level · goal, days/week · duration —
// whichever of those four were actually filled in) + rating + author, shared by both the
// routine and the program detail sheets so a plan reads the same whichever kind it is.
function DetailHeader({ post, isProgram, isOwn, onRate }) {
  const img = mediaUrl(post.image)
  const line1 = [post.level && t(LEVEL_LABEL[post.level]), post.goal && t(GOAL_LABEL[post.goal])].filter(Boolean).join(' · ')
  const line2 = [isProgram && post.daysPerWeek && t('{0} days/week', post.daysPerWeek), post.duration].filter(Boolean).join(' · ')
  return <>
    {img && <img src={img} alt="" style={{ width: 'calc(100% + 36px)', margin: '0 -18px 14px', height: 200, objectFit: 'cover', display: 'block' }} />}
    <h3 style={{ textAlign: 'center' }}>{post.name}</h3>
    {!!(line1 || line2) && <div style={{ textAlign: 'center', marginTop: -8, marginBottom: 10 }}>
      {line1 && <div className="small dim">{line1}</div>}
      {line2 && <div className="small dim">{line2}</div>}
    </div>}
    <div className="row" style={{ justifyContent: 'center', gap: 8, margin: '0 0 4px' }}>
      <Stars value={post.avgStars || 0} />
      {post.ratingCount >= 5 && <span className="tag acc">{t('Popular')}</span>}
    </div>
    <div style={{ textAlign: 'center', marginBottom: 10 }} className="small muted">
      {post.ratingCount ? t('{0} ratings', post.ratingCount) : t('No ratings yet')}
    </div>
    <div className="row" style={{ justifyContent: 'center', gap: 6, marginBottom: 10 }}>
      <span className="lrow-i" style={{ width: 26, height: 26, fontSize: 13 }}><Icon name="person" /></span>
      <span className="small capitalize">{t('By {0}', post.authorName)}</span>
      <span className="tag" style={{ marginLeft: 2 }}>{post.authorKind === 'trainer' ? t('Trainer') : t('Member')}</span>
    </div>
    {post.description && <div className="small" style={{ margin: '10px 0', lineHeight: 1.5 }}>{post.description}</div>}
    {!isOwn && <div style={{ margin: '10px 0' }}>
      <div className="dim small" style={{ marginBottom: 4, textAlign: 'center' }}>{t('Your rating')}</div>
      <div className="row" style={{ justifyContent: 'center' }}><Stars value={post.myStars || 0} onRate={onRate} /></div>
    </div>}
    {isOwn && <div className="dim small" style={{ margin: '10px 0', textAlign: 'center' }}>{isProgram ? t("You can't rate your own program.") : t("You can't rate your own routine.")}</div>}
  </>
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

// Image-led when one was uploaded — bigger than a routine card on purpose, the same way the
// Lyfta-style reference cards Juanjo shared stand out from a plain list row.
function ProgramCard({ post, onOpen }) {
  const img = mediaUrl(post.image)
  return <div className="item" style={{ flexDirection: 'column', alignItems: 'stretch', padding: img ? 0 : undefined, overflow: 'hidden' }} onClick={() => onOpen(post)}>
    {img && <img src={img} alt="" style={{ width: '100%', height: 130, objectFit: 'cover' }} />}
    <div className="row" style={{ padding: img ? '10px 14px 12px' : 0, width: '100%' }}>
      {!img && <span className="lrow-i"><Icon name={glyphOf(post.emoji)} /></span>}
      <div className="grow">
        <div className="tt">{post.name}</div>
        <div className="ss capitalize">{post.authorName} · {routineCount(post.routines.length)}</div>
      </div>
      {post.ratingCount ? <span className="tag acc"><Icon name="starFill" />{fmtNum(post.avgStars)} ({post.ratingCount})</span> : <span className="tag">{t('No ratings yet')}</span>}
      <Icon name="chevronRight" className="chev" />
    </div>
  </div>
}

function PickTypeSheet({ onRoutine, onProgram, close }) {
  return <>
    <h3>{t('What do you want to publish?')}</h3>
    <div className="list">
      <div className="item" onClick={() => { close(); onRoutine() }}>
        <span className="lrow-i"><Icon name="dumbbell" /></span>
        <div className="grow"><div className="tt">{t('A routine')}</div><div className="ss">{t("One session — a single day's training.")}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
      <div className="item" onClick={() => { close(); onProgram() }}>
        <span className="lrow-i"><Icon name="folder" /></span>
        <div className="grow"><div className="tt">{t('A full program')}</div><div className="ss">{t('Several routines grouped together.')}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>
    </div>
  </>
}

function PickRoutineSheet({ routines, onPick, close }) {
  return <>
    <h3>{t('Choose a routine')}</h3>
    {routines.length ? <div className="list">
      {routines.map(r => <div key={r.id} className="item" onClick={() => { close(); onPick(r) }}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
      </div>)}
    </div> : <div className="empty">{t('You have no routines yet.')}</div>}
  </>
}

function PickProgramSheet({ programs, onPick, close }) {
  return <>
    <h3>{t('Choose a program')}</h3>
    {programs.length ? <div className="list">
      {programs.map(p => <div key={p.id} className="item" onClick={() => { close(); onPick(p) }}>
        <span className="lrow-i"><Icon name={glyphOf(p.emoji)} /></span>
        <div className="grow"><div className="tt">{p.name}</div><div className="ss">{routineCount((p.routineIds || []).length)}</div></div>
      </div>)}
    </div> : <div className="empty">{t('You have no programs yet.')}</div>}
  </>
}

// Last step of publishing, for both kinds — an optional cover photo and a short explanation
// (why this one, who it's for) before the actual publish call.
function PublishDetailsSheet({ kind, source, S, onPublished, close }) {
  const toast = useUI(s => s.toast)
  const [image, setImage] = useState(null)
  const [description, setDescription] = useState('')
  const [level, setLevel] = useState('')
  const [goal, setGoal] = useState('')
  const [duration, setDuration] = useState('')
  const [daysPerWeek, setDaysPerWeek] = useState(3)
  const [busy, setBusy] = useState(false)

  // Already set a cover on this routine/program from Plan? Pre-fill it here (still replaceable/
  // removable) — refetched as its own data URL rather than reusing the stored filename, so the
  // Social post gets an independent copy neither side's later delete can break for the other.
  useEffect(() => {
    if (source.image) refetchAsDataUrl(source.image).then(setImage).catch(() => {})
  }, [])

  const publish = () => {
    const programRoutines = kind === 'program'
      ? (source.routineIds || []).map(rid => S.routines.find(r => r.id === rid)).filter(Boolean) : null
    if (kind === 'program' && !programRoutines.length) { toast(t('Add a routine to a program before publishing it.')); return }
    setBusy(true)
    const extra = { description: description.trim() }
    if (image) extra.image = image
    if (level) extra.level = level
    if (goal) extra.goal = goal
    if (duration.trim()) extra.duration = duration.trim()
    if (kind === 'program' && daysPerWeek) extra.daysPerWeek = daysPerWeek
    const req = kind === 'routine'
      ? publishSocialRoutine({ name: source.name, emoji: source.emoji, prog: source.prog, ex: source.ex, customExDefs: extractCustomDefs(source, S), ...extra })
      : publishSocialProgram({
        name: source.name, emoji: source.emoji,
        routines: programRoutines.map(r => ({ name: r.name, emoji: r.emoji, prog: r.prog, ex: r.ex, customExDefs: extractCustomDefs(r, S) })),
        ...extra
      })
    req.then(() => { toast(t('Published')); onPublished(); close() }).catch(e => { setBusy(false); toast(e.message) })
  }

  return <>
    <h3>{source.name}</h3>
    <div className="dim small" style={{ margin: '4px 0 14px' }}>{kind === 'program' ? t('Full program') : t('Routine')}</div>
    <ImagePicker value={image} onChange={setImage} />
    <div style={{ height: 14 }} />

    <div className="dim small" style={{ marginBottom: 6 }}>{t('Level (optional)')}</div>
    <Segmented options={[{ value: '', label: t('Any') }, ...LEVELS.map(l => ({ value: l, label: t(LEVEL_LABEL[l]) }))]} value={level} onChange={setLevel} />
    <div style={{ height: 12 }} />

    <SelectRow title={t('Goal (optional)')} sheetTitle={t('Goal')} value={goal}
      options={[{ value: '', label: t('None') }, ...GOALS_LIST.map(g => ({ value: g, label: t(GOAL_LABEL[g]) }))]}
      onChange={setGoal} />
    <div style={{ height: 12 }} />

    {kind === 'program' && <>
      <div className="dim small" style={{ marginBottom: 6 }}>{t('Days per week (optional)')}</div>
      <Segmented options={[2, 3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))} value={daysPerWeek} onChange={setDaysPerWeek} />
      <div style={{ height: 12 }} />
    </>}

    <div className="dim small" style={{ marginBottom: 4 }}>{t('Duration (optional)')}</div>
    <input className="input" value={duration} onChange={e => setDuration(e.target.value)} maxLength={30} placeholder={t('e.g. “4 months”')} />
    <div style={{ height: 12 }} />

    <div className="dim small" style={{ marginBottom: 4 }}>{t('Description (optional)')}</div>
    <TextArea value={description} onChange={e => setDescription(e.target.value)} maxLength={300} rows={3} placeholder={t('Why this one, who it’s for…')} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy} onClick={publish}>{t('Publish')}</Button>
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
      .then(res => {
        setPost(p => ({ ...p, avgStars: res.avgStars, ratingCount: res.ratingCount, myStars: res.myStars }))
        onChanged()   // background refresh so the card behind this sheet shows the new average too
      })
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
    <DetailHeader post={post} isProgram={false} isOwn={isOwn} onRate={rate} />
    <h4 className="sec">{t('Exercises')}</h4>
    <div className="list" style={{ marginBottom: 12 }}>
      {post.ex.map((e, i) => {
        const ex = resolveEx(e.id)
        return <div key={i} className="item">
          <Thumb ex={ex} />
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

function ProgramDetailSheet({ post: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [post, setPost] = useState(initial)
  const [busy, setBusy] = useState(false)
  const isOwn = post.authorId === user.id
  const canManage = isOwn || user.admin

  const rate = stars => {
    rateSocialProgram(post.id, stars)
      .then(res => {
        setPost(p => ({ ...p, avgStars: res.avgStars, ratingCount: res.ratingCount, myStars: res.myStars }))
        onChanged()
      })
      .catch(e => toast(e.message))
  }
  const copy = () => {
    const newIds = []
    update(s => {
      post.routines.forEach(r => {
        const nr = { id: uid(), name: r.name, emoji: r.emoji, ex: JSON.parse(JSON.stringify(r.ex)) }
        if (r.prog) nr.prog = r.prog
        s.routines.push(nr)
        newIds.push(nr.id)
        s.customEx = mergeCustomDefs(r.customExDefs, s.customEx)
      })
      s.programs = s.programs || []
      s.programs.push({ id: uid(), name: post.name, emoji: post.emoji, routineIds: newIds })
    })
    toast(t('Added to your programs'))
    close()
  }
  const del = () => confirmSheet({
    title: t('Delete this program?'), message: t('This removes it from Social for everyone.'),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteSocialProgram(post.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })
  const assign = () => {
    setBusy(true)
    fetchTrainerMembers().then(members => {
      setBusy(false)
      openSheet(close2 => <MemberPickerSheet members={members} close={close2} onPick={memberId => {
        assignProgramToMember(post.id, memberId).then(() => toast(t('Assigned to {0}', members.find(m => m.id === memberId)?.name || '')))
          .catch(e => toast(e.message))
      }} />)
    }).catch(e => { setBusy(false); toast(e.message) })
  }

  return <>
    <DetailHeader post={post} isProgram={true} isOwn={isOwn} onRate={rate} />
    <h4 className="sec">{t('Workouts in this program')}</h4>
    <div className="list" style={{ marginBottom: 12 }}>
      {post.routines.map((r, i) => <div key={i} className="item"
        onClick={() => openSheet(close2 => <RoutineExercisesSheet routine={r} unit={S.unit} close={close2} />)}>
        <span className="lrow-i"><Icon name={glyphOf(r.emoji)} /></span>
        <div className="grow"><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <Icon name="chevronRight" className="chev" />
      </div>)}
    </div>
    <Button variant="primary" style={{ width: '100%', marginBottom: 8 }} onClick={copy}>{t('Copy to my programs')}</Button>
    {user.trainer && isOwn && post.authorKind === 'trainer' &&
      <Button style={{ width: '100%', marginBottom: 8 }} disabled={busy} onClick={assign}>{t('Assign to a member')}</Button>}
    {canManage && <button className="btn danger" style={{ width: '100%' }} onClick={del}>{t('Delete')}</button>}
  </>
}

// Read-only drill-down from a program into one of its routines — the exercise photos are what
// make this worth a tap rather than just showing the exercise count on the row above.
function RoutineExercisesSheet({ routine, unit }) {
  const customMap = Object.fromEntries((routine.customExDefs || []).map(d => [d.id, d]))
  const resolveEx = id => customMap[id] || exOr(id)
  return <>
    <h3>{routine.name}</h3>
    <div className="list">
      {routine.ex.map((e, i) => {
        const ex = resolveEx(e.id)
        return <div key={i} className="item">
          <Thumb ex={ex} />
          <div className="grow"><div className="tt capitalize">{nameFor(ex)}</div><div className="ss">{exLine(e, unit)}</div></div>
        </div>
      })}
    </div>
  </>
}

function WallDetailSheet({ post: initial, onChanged, close }) {
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const [post, setPost] = useState(initial)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const send = () => {
    const v = text.trim()
    if (!v) return
    setBusy(true)
    postWallComment(post.id, v).then(res => {
      setPost(p => ({ ...p, comments: [...(p.comments || []), res.comment] }))
      setText('')
      setBusy(false)
    }).catch(e => { setBusy(false); toast(e.message) })
  }
  const removeComment = c => {
    deleteWallComment(post.id, c.id)
      .then(() => setPost(p => ({ ...p, comments: (p.comments || []).filter(x => x.id !== c.id) })))
      .catch(e => toast(e.message))
  }
  const delPost = () => confirmSheet({
    title: t('Delete this post?'), confirmText: t('Delete'), danger: true,
    onConfirm: () => deleteWallPost(post.id).then(() => { toast(t('Deleted')); onChanged(); close() }).catch(e => toast(e.message))
  })

  return <>
    <div className="row" style={{ gap: 10, marginBottom: 10 }}>
      <Thumb ex={exOr(post.exId)} />
      <div className="grow">
        <div className="tt capitalize">{post.exName}</div>
        <div className="ss capitalize">{post.authorName} · {setLabel(post.exId, post.value, { mode: post.mode })} · {fmtDate(post.sourceDate, true)}</div>
      </div>
    </div>
    {post.note && <div className="small" style={{ margin: '0 0 14px', lineHeight: 1.5 }}>“{post.note}”</div>}
    <h4 className="sec">{t('Comments')}</h4>
    <div className="list" style={{ gap: 0, marginBottom: 10 }}>
      {(post.comments || []).map(c => <div key={c.id} className="row between" style={{ padding: '9px 2px', borderBottom: '1px solid var(--sep)' }}>
        <div style={{ minWidth: 0 }}>
          <div className="small capitalize" style={{ fontWeight: 600 }}>{c.authorName}</div>
          <div className="small">{c.text}</div>
        </div>
        {(c.authorId === user.id || user.admin) &&
          <button className="iconbtn" onClick={() => removeComment(c)} aria-label={t('Delete')}><Icon name="trash" /></button>}
      </div>)}
      {!(post.comments || []).length && <div className="muted small" style={{ padding: '6px 2px' }}>{t('No comments yet.')}</div>}
    </div>
    <div className="row" style={{ gap: 8 }}>
      <input className="input" style={{ flex: '1 1 auto', minWidth: 0 }} value={text} maxLength={300} placeholder={t('Add a comment…')}
        onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') send() }} />
      <Button variant="primary" style={{ flex: 'none' }} disabled={busy || !text.trim()} onClick={send}>{t('Send')}</Button>
    </div>
    {(post.authorId === user.id || user.admin) && <>
      <div style={{ height: 10 }} />
      <button className="btn danger" style={{ width: '100%' }} onClick={delPost}>{t('Delete post')}</button>
    </>}
  </>
}

export default function Social() {
  const user = useStore(s => s.user)
  const S = useStore(s => s.S)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [tab, setTab] = useState('routines')
  const [routines, setRoutines] = useState(null)
  const [programs, setPrograms] = useState(null)
  const [wall, setWall] = useState(null)

  const loadRoutines = () => fetchSocialRoutines().then(setRoutines).catch(e => toast(e.message))
  const loadPrograms = () => fetchSocialPrograms().then(setPrograms).catch(e => toast(e.message))
  const loadFeed = () => { loadRoutines(); loadPrograms() }
  const loadWall = () => fetchWall().then(setWall).catch(e => toast(e.message))

  useEffect(() => { loadFeed() }, [])
  useEffect(() => { if (tab === 'wall' && wall === null) loadWall() }, [tab])

  const openPublishDetails = (kind, source) =>
    openSheet(close => <PublishDetailsSheet kind={kind} source={source} S={S} close={close} onPublished={loadFeed} />)
  const publish = () => openSheet(close => <PickTypeSheet close={close}
    onRoutine={() => {
      if (!S.routines.length) { toast(t('You have no routines yet.')); return }
      openSheet(close2 => <PickRoutineSheet routines={S.routines} close={close2} onPick={r => openPublishDetails('routine', r)} />)
    }}
    onProgram={() => {
      const withRoutines = (S.programs || []).filter(p => (p.routineIds || []).length > 0)
      if (!withRoutines.length) { toast(t('Add a routine to a program before publishing it.')); return }
      openSheet(close2 => <PickProgramSheet programs={withRoutines} close={close2} onPick={p => openPublishDetails('program', p)} />)
    }} />)

  const openDetail = post => openSheet(close => post.kind === 'program'
    ? <ProgramDetailSheet post={post} onChanged={loadFeed} close={close} />
    : <RoutineDetailSheet post={post} onChanged={loadFeed} close={close} />)

  const publishWall = () => openSheet(close => <WallPublishSheet S={S} close={close} onPublished={loadWall} />)
  const openWallDetail = post => openSheet(close => <WallDetailSheet post={post} onChanged={loadWall} close={close} />)

  const feed = routines === null || programs === null ? null :
    [...routines.map(r => ({ ...r, kind: 'routine' })), ...programs.map(p => ({ ...p, kind: 'program' }))]
      .sort((a, b) => b.createdAt - a.createdAt)
  const memberFeed = feed ? feed.filter(p => p.authorKind !== 'trainer') : null
  const trainerFeed = feed ? feed.filter(p => p.authorKind === 'trainer') : null

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
      {memberFeed === null ? <div className="muted small">{t('Loading…')}</div> :
        memberFeed.length ? <div className="list">{memberFeed.map(p => p.kind === 'program'
          ? <ProgramCard key={p.id} post={p} onOpen={openDetail} />
          : <RoutineCard key={p.id} post={p} onOpen={openDetail} />)}</div> :
          <div className="empty"><div className="ico"><Icon name="users" /></div>{t('No routines published yet.')}<br />{t('Be the first to share one.')}</div>}
    </>}

    {tab === 'wall' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Wall')}</h4>
        <Button size="sm" variant="tinted" icon="upload" onClick={publishWall}>{t('Post a record')}</Button>
      </div>
      {wall === null ? <div className="muted small">{t('Loading…')}</div> :
        wall.length ? <div className="list">{wall.map(p => <div key={p.id} className="item" onClick={() => openWallDetail(p)}>
          <Thumb ex={exOr(p.exId)} />
          <div className="grow">
            <div className="tt capitalize">{p.exName}</div>
            <div className="ss capitalize">{p.authorName} · {setLabel(p.exId, p.value, { mode: p.mode })} · {fmtDate(p.sourceDate, true)}</div>
            {p.note && <div className="ss dim">“{p.note}”</div>}
          </div>
          <Icon name="chevronRight" className="chev" />
        </div>)}</div> :
          <div className="empty"><div className="ico"><Icon name="trophy" /></div>{t('No records posted yet.')}<br />{t('Post one from a workout you already logged.')}</div>}
    </>}

    {tab === 'trainers' && <>
      <div className="row between" style={{ marginBottom: 10 }}>
        <h4 className="sec" style={{ margin: 0 }}>{t('Trainers')}</h4>
        {user.trainer && <Button size="sm" variant="tinted" icon="upload" onClick={publish}>{t('Publish')}</Button>}
      </div>
      {trainerFeed === null ? <div className="muted small">{t('Loading…')}</div> :
        trainerFeed.length ? <div className="list">{trainerFeed.map(p => p.kind === 'program'
          ? <ProgramCard key={p.id} post={p} onOpen={openDetail} />
          : <RoutineCard key={p.id} post={p} onOpen={openDetail} />)}</div> :
          <div className="empty"><div className="ico"><Icon name="medal" /></div>{t('No trainer routines yet.')}</div>}
    </>}
    <div style={{ height: 20 }} />
  </div>
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
