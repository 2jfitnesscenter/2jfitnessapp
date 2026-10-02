// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useRef, useState } from 'react'
import { api } from '../lib/api.js'
import { t } from '../lib/i18n.js'
import { mediaUrl } from '../lib/media.js'
import { safeAccent, visibleNews, parseNewsText } from '../lib/news.js'
import { useStore } from '../store/useStore.js'
import './news.css'

// The notice text as React nodes — **bold**, line breaks, https links. No HTML is ever injected.
export function NewsText({ text }) {
  const lines = parseNewsText(text)
  return <>{lines.map((segs, i) => <p key={i} className={segs.length ? undefined : 'news-gap'}>
    {segs.map((s, j) => s.type === 'bold' ? <strong key={j}>{s.text}</strong>
      : s.type === 'link' ? <a key={j} href={s.href} target="_blank" rel="noopener noreferrer">{s.text}</a>
        : <span key={j}>{s.text}</span>)}
  </p>)}</>
}

// One notice: accent border/glow, optional image on top, title and text. Tap to expand/collapse long text.
export function NewsCard({ item, preview = false }) {
  const [open, setOpen] = useState(false)
  const accent = safeAccent(item.accentColor)
  const img = item.imageUrl || mediaUrl(item.image)
  const long = (item.body || '').length > 160 || (item.body || '').split('\n').length > 3
  return <article className={'news-card' + (open ? ' open' : '')} style={{ '--news-accent': accent }} data-news-id={item.id}>
    {img && <img className="news-img" src={img} alt="" loading="lazy" />}
    <div className="news-body">
      <h3>{item.title}</h3>
      {!!item.body && <div className="news-text"><NewsText text={item.body} /></div>}
      {long && !preview && <button type="button" className="news-more" onClick={() => setOpen(o => !o)}>{open ? t('Show less') : t('Read more')}</button>}
    </div>
  </article>
}

// The block itself: nothing when there is nothing visible, one compact card, or a snap-scrolling
// carousel with a discreet position indicator. `items` are already-fetched notices (see NewsBlock).
export function NewsCarousel({ items, now = Date.now() }) {
  const list = visibleNews(items, now)
  const [idx, setIdx] = useState(0)
  const ref = useRef(null)
  if (!list.length) return null
  const onScroll = e => {
    const el = e.currentTarget
    setIdx(Math.max(0, Math.min(list.length - 1, Math.round(el.scrollLeft / Math.max(1, el.clientWidth * 0.9)))))
  }
  const go = i => ref.current?.children[i]?.scrollIntoView?.({ behavior: 'smooth', inline: 'start', block: 'nearest' })
  return <section className={'news-block' + (list.length > 1 ? ' multi' : '')} aria-label={t('2J news')}>
    <div className="news-track" ref={ref} onScroll={list.length > 1 ? onScroll : undefined}>
      {list.map(n => <NewsCard key={n.id} item={n} />)}
    </div>
    {list.length > 1 && <div className="news-dots" role="tablist" aria-label={t('News position')}>
      {list.map((n, i) => <button key={n.id} type="button" role="tab" aria-selected={i === idx} aria-label={t('News {0} of {1}', i + 1, list.length)}
        className={i === idx ? 'on' : ''} onClick={() => go(i)} />)}
    </div>}
  </section>
}

// Home entry point: loads the visible notices (read-only, any signed-in member), keeps a per-user
// offline copy and filters by publish/expiry on the client too, so an expired notice never lingers.
export default function NewsBlock() {
  const uid = useStore(s => s.user?.id)
  const key = 'news_v1:' + (uid || 'anon')
  const [items, setItems] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || '[]') } catch { return [] } })
  useEffect(() => {
    if (!uid) return
    let live = true
    api('/api/news').then(d => {
      if (!live || !Array.isArray(d?.news)) return
      setItems(d.news)
      try { localStorage.setItem(key, JSON.stringify(d.news)) } catch { /* private mode */ }
    }).catch(() => { /* offline: keep the last copy */ })
    return () => { live = false }
  }, [uid])
  if (!uid) return null
  return <NewsCarousel items={items} />
}
