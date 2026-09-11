import { useNavigate, useParams } from 'react-router-dom'
import { useEffect } from 'react'
import { useStore } from '../store/useStore.js'
import { uid, exCount, routineCount } from '../lib/format.js'
import { t } from '../lib/i18n.js'
import { glyphPicker, confirmSheet, routinePickerSheet } from '../sheets.jsx'
import Icon from '../components/Icon.jsx'
import { glyphOf, DEFAULT_GLYPH } from '../lib/glyphs.js'
import { Button } from '../components/ui.jsx'
import { mediaUrl } from '../lib/media.js'

// A program is a named folder of routine ids — see useStore.js's DEF.programs comment. This
// screen is the folder's contents: add an existing loose routine to it, build a new one
// straight into it, or take one back out (the routine itself is never touched either way).
export default function ProgramEdit() {
  const nav = useNavigate()
  const { id } = useParams()
  const S = useStore(s => s.S)
  const update = useStore(s => s.update)
  const p = (S.programs || []).find(x => x.id === id)
  useEffect(() => { if (!p) nav('/plan') }, [!!p])
  if (!p) return null

  const routines = (p.routineIds || []).map(rid => S.routines.find(r => r.id === rid)).filter(Boolean)
  const grouped = new Set((S.programs || []).flatMap(pr => pr.routineIds || []))
  const loose = S.routines.filter(r => !grouped.has(r.id))

  const patch = fn => update(s => { fn(s.programs.find(x => x.id === id)) })
  const rename = v => patch(pr => { pr.name = v })

  const addNew = () => {
    const r = { id: uid(), name: t('New routine'), emoji: DEFAULT_GLYPH, ex: [] }
    update(s => {
      s.routines.push(r)
      s.programs.find(x => x.id === id).routineIds.push(r.id)
    })
    nav('/plan/r/' + r.id)
  }
  const addExisting = () => routinePickerSheet(loose, rid => patch(pr => {
    pr.routineIds = pr.routineIds || []
    if (!pr.routineIds.includes(rid)) pr.routineIds.push(rid)
  }))
  const removeFromProgram = rid => patch(pr => { pr.routineIds = (pr.routineIds || []).filter(x => x !== rid) })

  const deleteProgram = () => confirmSheet({
    title: t('Delete program?'),
    message: t('“{0}” will be removed — its routines stay, just no longer grouped together.', p.name),
    confirmText: t('Delete'), danger: true,
    onConfirm: () => { update(s => { s.programs = s.programs.filter(x => x.id !== id) }); nav('/plan') }
  })

  return <>
    <div className="hdr">
      <button className="iconbtn" onClick={() => nav('/plan')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div style={{ flex: 1, marginLeft: 8 }}><h1 className="capitalize">{p.name}</h1><div className="sub">{routineCount(routines.length)}</div></div>
    </div>

    <div className="row" style={{ gap: 10, marginBottom: 16 }}>
      <button style={{ width: 52, height: 52, borderRadius: 14, fontSize: 26, flex: 'none', overflow: 'hidden', border: 'none', padding: 0 }}
        className={p.image ? '' : 'lrow-i'}
        onClick={() => glyphPicker(p.emoji, g => patch(pr => { pr.emoji = g }), { image: p.image, onImage: id => patch(pr => { pr.image = id }) })}>
        {p.image ? <img src={mediaUrl(p.image)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <Icon name={glyphOf(p.emoji)} />}
      </button>
      <input className="input" style={{ flex: 1 }} value={p.name} maxLength={40} onChange={e => rename(e.target.value)} placeholder={t('Program name')} />
    </div>

    {routines.length ? <div className="list" style={{ marginBottom: 14 }}>
      {routines.map(r => <div key={r.id} className="item">
        {r.image
          ? <img src={mediaUrl(r.image)} alt="" style={{ width: 44, height: 44, borderRadius: 12, objectFit: 'cover', flex: 'none' }} onClick={() => nav('/plan/r/' + r.id)} />
          : <span className="lrow-i" onClick={() => nav('/plan/r/' + r.id)}><Icon name={glyphOf(r.emoji)} /></span>}
        <div className="grow" onClick={() => nav('/plan/r/' + r.id)}><div className="tt">{r.name}</div><div className="ss">{exCount(r.ex.length)}</div></div>
        <button className="iconbtn" aria-label={t('Remove from program')} onClick={() => removeFromProgram(r.id)}><Icon name="xmark" /></button>
      </div>)}
    </div> : <div className="empty" style={{ marginBottom: 14 }}><div className="ico"><Icon name="folder" /></div>{t('No routines in this program yet.')}</div>}

    <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
      <Button icon="plus" onClick={addNew}>{t('New routine')}</Button>
      {loose.length > 0 && <Button icon="folder" onClick={addExisting}>{t('Add existing routine')}</Button>}
    </div>
    <div style={{ height: 14 }} />
    <Button variant="danger" onClick={deleteProgram}>{t('Delete program')}</Button>
  </>
}
