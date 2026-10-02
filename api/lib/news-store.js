// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Official news / notices shown on Home — admin-authored, read-only for everyone else.
 *
 * Global content: one small file, DATA/news.json, outside every member's synced state (like
 * guided.json / library-admin.json), so it never races Sync V2. The text is plain: **bold**, line
 * breaks and [label](https://link) — the client renders it with a tiny parser into React nodes, never
 * as HTML, and the server only bounds its length and strips control characters.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const FILE = () => path.join(process.env.DATA_DIR || '/data', 'news.json');
export const MAX_ITEMS = 50;
export const LIMITS = { title: 120, body: 2000 };
export const DEFAULT_ACCENT = '#7bd34a';
const HEX = /^#[0-9a-fA-F]{6}$/;
const IMAGE_ID = /^[a-zA-Z0-9_.-]{1,80}$/;

let cache = null;
function load() {
  if (cache) return cache;
  let s = {};
  try { s = JSON.parse(fs.readFileSync(FILE(), 'utf8')); } catch { /* absent = no news yet */ }
  cache = { v: 1, items: Array.isArray(s.items) ? s.items : [] };
  return cache;
}
function save() {
  const f = FILE(), tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache));
  fs.renameSync(tmp, f);
}
export function resetCache() { cache = null; }

const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n').trim().slice(0, max);
const timeOrNull = v => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Date.parse(String(v));
  return Number.isFinite(n) && n > 0 ? Math.round(n) : NaN;
};

/** Visible = active, already published and not expired. Pure. */
export function isVisible(n, now = Date.now()) {
  return !!n && n.active === true && (!n.publishAt || n.publishAt <= now) && (!n.expiresAt || n.expiresAt > now);
}
const byOrder = (a, b) => (a.order - b.order) || (a.createdAt - b.createdAt);
export const visible = (now = Date.now()) => load().items.filter(n => isVisible(n, now)).sort(byOrder);
export const all = () => load().items.slice().sort(byOrder);
export const byId = id => load().items.find(n => n.id === id) || null;

/**
 * Create (no id) or update (id) from a body. Returns { item, previousImage } | { error, status }.
 * Fields: title, body, accentColor, image (stored file id or null; the route stores uploads), active,
 * publishAt, expiresAt (ms, ISO or null). Partial updates keep what is not sent.
 */
export function upsert(input, now = Date.now()) {
  const s = load(), b = input && typeof input === 'object' ? input : {};
  const existing = b.id ? s.items.find(n => n.id === b.id) : null;
  if (b.id && !existing) return { error: 'esa noticia no existe', status: 404 };
  if (!existing && s.items.length >= MAX_ITEMS) return { error: 'demasiadas noticias (máx. ' + MAX_ITEMS + ')', status: 400 };
  const next = existing ? { ...existing } : {
    id: 'n_' + crypto.randomBytes(8).toString('hex'), title: '', body: '', accentColor: DEFAULT_ACCENT, image: null, active: false,
    order: s.items.reduce((m, n) => Math.max(m, n.order), 0) + 1, publishAt: null, expiresAt: null, createdAt: now,
  };
  if ('title' in b) next.title = clean(b.title, LIMITS.title);
  if ('body' in b) next.body = clean(b.body, LIMITS.body);
  if ('accentColor' in b) { if (!HEX.test(String(b.accentColor))) return { error: 'color de acento no válido', status: 400 }; next.accentColor = String(b.accentColor).toLowerCase(); }
  if ('image' in b) { if (b.image !== null && !IMAGE_ID.test(String(b.image))) return { error: 'imagen no válida', status: 400 }; next.image = b.image; }
  if ('active' in b) next.active = b.active === true;
  if ('publishAt' in b) { const t = timeOrNull(b.publishAt); if (Number.isNaN(t)) return { error: 'fecha de publicación no válida', status: 400 }; next.publishAt = t; }
  if ('expiresAt' in b) { const t = timeOrNull(b.expiresAt); if (Number.isNaN(t)) return { error: 'fecha de caducidad no válida', status: 400 }; next.expiresAt = t; }
  if (!next.title) return { error: 'la noticia necesita un título', status: 400 };
  if (!next.body && !next.image) return { error: 'la noticia necesita texto o imagen', status: 400 };
  if (next.publishAt && next.expiresAt && next.expiresAt <= next.publishAt) return { error: 'la caducidad debe ser posterior a la publicación', status: 400 };
  next.updatedAt = now;
  if (existing) s.items[s.items.indexOf(existing)] = next; else s.items.push(next);
  save();
  return { item: next, previousImage: existing && existing.image && existing.image !== next.image ? existing.image : null };
}

export function setActive(id, active, now = Date.now()) {
  const n = byId(id);
  if (!n) return { error: 'esa noticia no existe', status: 404 };
  n.active = active === true; n.updatedAt = now; save();
  return { item: n };
}

/** ids = the complete new order (every id exactly once). */
export function reorder(ids, now = Date.now()) {
  const s = load();
  if (!Array.isArray(ids) || ids.length !== s.items.length || new Set(ids).size !== ids.length || !ids.every(id => s.items.some(n => n.id === id)))
    return { error: 'el orden debe incluir todas las noticias una vez', status: 400 };
  ids.forEach((id, i) => { const n = s.items.find(x => x.id === id); if (n.order !== i + 1) { n.order = i + 1; n.updatedAt = now; } });
  save();
  return { news: all() };
}

export function remove(id) {
  const s = load(), n = s.items.find(x => x.id === id);
  if (!n) return { error: 'esa noticia no existe', status: 404 };
  s.items = s.items.filter(x => x.id !== id); save();
  return { ok: true, image: n.image };
}
