// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStore } from '../store/useStore.js'
import { useUI } from '../store/useUI.js'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { mediaUrl, resizeImageFile } from '../lib/media.js'
import { ACCENT_PRESETS, DEFAULT_ACCENT, fromLocalInput, newsStatus, safeAccent, toLocalInput } from '../lib/news.js'
import { confirmSheet } from '../sheets.jsx'
import { Button, Switch } from '../components/ui.jsx'
import Icon from '../components/Icon.jsx'
import { NewsCard } from '../components/NewsBlock.jsx'

const post = (path, body) => api(path, { method: 'POST', body: JSON.stringify(body) })
const STATUS = { live: ['Live', 'var(--green)'], scheduled: ['Scheduled', 'var(--blue)'], expired: ['Expired', 'var(--orange)'], inactive: ['Off', 'var(--label-2)'] }

// Create / edit one notice. The live preview is the real card members see on Home.
function NewsEditor({ item, onSaved, close }) {
  const toast = useUI(s => s.toast)
  const fileRef = useRef(null)
  const [f, setF] = useState(() => ({
    title: item?.title || '', body: item?.body || '', accentColor: safeAccent(item?.accentColor || DEFAULT_ACCENT), active: item ? item.active : true,
    publishAt: toLocalInput(item?.publishAt), expiresAt: toLocalInput(item?.expiresAt),
  }))
  const [image, setImage] = useState(null)               // undefined/null = untouched · '' = removed · data URL = new
  const [removed, setRemoved] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (k, v) => setF(p => ({ ...p, [k]: v }))
  const shownImage = image || (removed ? null : mediaUrl(item?.image))
  const onFile = e => {
    const file = e.target.files?.[0]; e.target.value = ''
    if (file) resizeImageFile(file).then(d => { setImage(d); setRemoved(false) }).catch(err => toast(err.message))
  }
  const save = async () => {
    if (!f.title.trim()) return toast(t('Add a title'))
    const pub = fromLocalInput(f.publishAt), exp = fromLocalInput(f.expiresAt)
    if (pub && exp && exp <= pub) return toast(t('Expiry must be after publication'))
    const body = { ...(item ? { id: item.id } : {}), title: f.title, body: f.body, accentColor: f.accentColor, active: f.active, publishAt: pub, expiresAt: exp }
    if (image) body.imageData = image
    else if (removed) body.imageData = null
    setBusy(true)
    try { await post('/api/admin/news/save', body); toast(t('Saved')); onSaved(); close() } catch (e) { toast(e.message) } finally { setBusy(false) }
  }
  return <div>
    <h3 style={{ marginBottom: 10 }}>{item ? t('Edit notice') : t('New notice')}</h3>
    <label className="small muted">{t('Title')}</label>
    <input className="input" maxLength={120} value={f.title} onChange={e => set('title', e.target.value)} />
    <div style={{ height: 10 }} />
    <label className="small muted">{t('Text')}</label>
    <textarea className="input" rows={5} maxLength={2000} value={f.body} onChange={e => set('body', e.target.value)} style={{ resize: 'vertical' }} />
    <div className="small dim" style={{ marginTop: 4 }}>{t('Use **bold** and [label](https://link). New lines are kept.')}</div>
    <div style={{ height: 10 }} />
    <label className="small muted">{t('Accent colour')}</label>
    <div className="news-swatches">
      {ACCENT_PRESETS.map(c => <button key={c} type="button" className={f.accentColor === c ? 'on' : ''} style={{ background: c }} aria-label={c} onClick={() => set('accentColor', c)} />)}
      <input type="color" value={f.accentColor} onChange={e => set('accentColor', e.target.value)} aria-label={t('Accent colour')} />
    </div>
    <div style={{ height: 10 }} />
    <label className="small muted">{t('Image (optional)')}</label>
    <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={onFile} />
    {shownImage ? <div style={{ position: 'relative' }}>
      <img src={shownImage} alt="" style={{ width: '100%', aspectRatio: '16/7', objectFit: 'cover', borderRadius: 12, display: 'block' }} />
      <button className="iconbtn" style={{ position: 'absolute', top: 8, right: 8, background: 'rgba(0,0,0,.55)', color: '#fff' }}
        onClick={() => { setImage(null); setRemoved(true) }} aria-label={t('Remove image')}><Icon name="xmark" /></button>
    </div> : <Button icon="upload" onClick={() => fileRef.current?.click()}>{t('Add an image')}</Button>}
    <div style={{ height: 10 }} />
    <div className="row" style={{ gap: 10 }}>
      <div style={{ flex: 1, minWidth: 0 }}><label className="small muted">{t('Publish from')}</label>
        <input type="datetime-local" className="input" value={f.publishAt} onChange={e => set('publishAt', e.target.value)} /></div>
      <div style={{ flex: 1, minWidth: 0 }}><label className="small muted">{t('Expires')}</label>
        <input type="datetime-local" className="input" value={f.expiresAt} onChange={e => set('expiresAt', e.target.value)} /></div>
    </div>
    <div className="row between" style={{ margin: '12px 0' }}><span>{t('Visible to members')}</span><Switch checked={f.active} onChange={v => set('active', v)} /></div>
    <div className="small muted" style={{ margin: '6px 0' }}>{t('Preview')}</div>
    <NewsCard preview item={{ id: 'preview', title: f.title || t('Title'), body: f.body, accentColor: f.accentColor, imageUrl: shownImage }} />
    <div style={{ height: 12 }} />
    <Button variant="primary" disabled={busy} onClick={save}>{t('Save')}</Button>
  </div>
}

export default function AdminNews() {
  const nav = useNavigate()
  const user = useStore(s => s.user)
  const toast = useUI(s => s.toast)
  const openSheet = useUI(s => s.openSheet)
  const [rows, setRows] = useState(null)
  const load = () => api('/api/admin/news').then(d => setRows(d.news)).catch(e => { setRows([]); toast(e.message || t('Failed to load')) })
  useEffect(() => { if (user?.admin) load() }, [])
  if (!user?.admin) return null
  const act = (p, body) => post(p, body).then(load).catch(e => toast(e.message))
  const move = (i, d) => {
    const ids = rows.map(r => r.id); const j = i + d
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    act('/api/admin/news/reorder', { ids })
  }
  const edit = item => openSheet(close => <NewsEditor item={item} onSaved={load} close={close} />)
  const del = n => confirmSheet({ title: t('Delete this notice?'), message: n.title, confirmText: t('Delete'), danger: true, onConfirm: () => act('/api/admin/news/delete', { id: n.id }) })
  const now = Date.now()
  return <main className="narrow">
    <header className="hdr"><button className="iconbtn" onClick={() => nav('/admin')} aria-label={t('Back')}><Icon name="chevronLeft" /></button>
      <div><h1>{t('News / Notices')}</h1><div className="sub">{t('Shown on Home to every member while they are live.')}</div></div></header>
    <Button variant="primary" icon="plus" onClick={() => edit(null)}>{t('New notice')}</Button>
    <div style={{ height: 12 }} />
    {rows === null ? <div className="muted small">{t('Loading…')}</div> : rows.length ? <div className="list" style={{ display: 'grid', gap: 10 }}>
      {rows.map((n, i) => { const [label, tint] = STATUS[newsStatus(n, now)]; return <article className="news-admin-row" key={n.id}>
        <span className="dot" style={{ background: safeAccent(n.accentColor) }} />
        <div className="grow">
          <div className="ttl">{n.title}</div>
          <div className="small" style={{ color: tint }}>{t(label)}</div>
        </div>
        <Switch checked={n.active} onChange={v => act('/api/admin/news/active', { id: n.id, active: v })} />
        <button className="iconbtn" disabled={i === 0} onClick={() => move(i, -1)} aria-label={t('Move up')}><Icon name="arrowUp" /></button>
        <button className="iconbtn" disabled={i === rows.length - 1} onClick={() => move(i, 1)} aria-label={t('Move down')}><Icon name="arrowDown" /></button>
        <button className="iconbtn" onClick={() => edit(n)} aria-label={t('Edit')}><Icon name="pencil" /></button>
        <button className="iconbtn" onClick={() => del(n)} aria-label={t('Delete')}><Icon name="trash" /></button>
      </article> })}
    </div> : <div className="empty"><div className="ico"><Icon name="bell" /></div>{t('No notices yet')}</div>}
  </main>
}
