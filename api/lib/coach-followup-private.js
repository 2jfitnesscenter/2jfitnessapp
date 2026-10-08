// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The staff-only side of Seguimiento V3: dated notes and the decision timeline. It extends the ENCRYPTED blob Seguimiento V2 already keeps on the roster entry
// (followUp.privateNotesEncrypted, same key, same version 1) with two additive lists — `entries` (notes) and richer `events` — so nothing legacy stops working:
// an old reader still finds `notes` (string) and `events` (with at/action/by). Nothing in this file ever reaches member state, Sync, the personal AI,
// Social, exports or the professional AI payload (api/lib/coach-followup.js builds that from facts only).

export const EVENT_KINDS = ['goal_changed', 'review_rescheduled', 'recommendation_accepted', 'recommendation_rejected', 'program_changed', 'rescheduled', 'flag_set', 'flag_cleared', 'note_added'];
export const DECISION_KINDS = ['recommendation_accepted', 'recommendation_rejected', 'program_changed', 'rescheduled'];
const EVENT_CAP = 150, NOTE_CAP = 80;
export const NOTE_MAX = 1000;
const ISO_AT = /^\d{4}-\d{2}-\d{2}T/;
const clip = (s, n) => String(s ?? '').slice(0, n);

export const emptyPrivate = () => ({ version: 1, notes: '', events: [], entries: [] });

/** Validates a decrypted blob; null when it is not the version-1 shape (the caller then refuses to overwrite it). */
export function normalizePrivate(d) {
  if (!d || typeof d !== 'object' || d.version !== 1 || typeof d.notes !== 'string' || !Array.isArray(d.events)) return null;
  const entries = (Array.isArray(d.entries) ? d.entries : []).filter(e => e && typeof e.id === 'string' && typeof e.text === 'string' && typeof e.at === 'string' && typeof e.by === 'string');
  return { ...d, entries };
}

const cleanRef = ref => (ref && typeof ref === 'object' && ['program', 'routine'].includes(ref.kind) && typeof ref.id === 'string' ? { kind: ref.kind, id: clip(ref.id, 80) } : undefined);

/** Appends one event (returns a new blob). kind ∈ EVENT_KINDS; `text` is the staff's reason, kept short. */
export function pushEvent(d, { kind, by, ref, text, at = new Date().toISOString() }) {
  if (!EVENT_KINDS.includes(kind)) throw new Error('evento no válido');
  const ev = { at, by: String(by), action: kind, kind, ...(cleanRef(ref) ? { ref: cleanRef(ref) } : {}), ...(text ? { text: clip(text, 300) } : {}) };
  return { ...d, events: [...d.events, ev].slice(-EVENT_CAP) };
}

/** A dated note, optionally tied to a review (program/routine). Also leaves one compact event so the timeline shows it. */
export function addNote(d, { by, text, ref, id, at = new Date().toISOString() }) {
  const t = String(text ?? '').trim();
  if (!t) return { error: 'la nota está vacía' };
  if (t.length > NOTE_MAX) return { error: `la nota debe tener hasta ${NOTE_MAX} caracteres` };
  const entry = { id, at, by: String(by), text: t, ...(cleanRef(ref) ? { ref: cleanRef(ref) } : {}) };
  const next = { ...d, entries: [...d.entries, entry].slice(-NOTE_CAP) };
  return { value: pushEvent(next, { kind: 'note_added', by, ref, text: t.slice(0, 80), at }), entry };
}

export function deleteNote(d, noteId, by) {
  const found = d.entries.find(e => e.id === noteId);
  if (!found) return { error: 'esa nota no existe' };
  return { value: { ...d, entries: d.entries.filter(e => e.id !== noteId) } };
}

/**
 * The professional timeline, newest first: what staff decided and what happened to the plan. Review closures and plan changes are DERIVED from state the member
 * already owns (S.programReviews, S.routineReviews, version snapshots, follow-up reviews) so nothing is stored twice; the rest comes from the private events.
 * `names` maps staff ids to names. Note edits and AI runs are deliberately not events (noise).
 */
export function timeline({ S, f, priv, names = {}, limit = 25 }) {
  const out = [];
  const who = by => (by && names[by]) || null;
  const nameOf = (kind, id) => (kind === 'program' ? (S?.programs || []) : (S?.routines || [])).find(x => x?.id === id)?.name || null;
  for (const [id, r] of Object.entries(S?.programReviews || {})) if (r?.lastReviewAt) out.push({ d: r.lastReviewAt, kind: 'review_done', ref: { kind: 'program', id, name: nameOf('program', id) }, by: who(r.by) });
  for (const [id, r] of Object.entries(S?.routineReviews || {})) if (r?.reviewedAt) out.push({ d: r.reviewedAt, kind: 'review_done', ref: { kind: 'routine', id, name: nameOf('routine', id) }, by: who(r.by) });
  for (const r of f?.reviews || []) if (r?.d) out.push({ d: r.d, kind: 'measurement_review', by: who(r.by) });
  const versions = [];
  for (const [bag, kind] of [['programVersions', 'program'], ['routineVersions', 'routine']]) {
    for (const [id, list] of Object.entries(S?.[bag] || {})) {
      const last = Array.isArray(list) ? list[list.length - 1] : null;
      if (Number.isFinite(last?.versionedAt)) versions.push({ d: new Date(last.versionedAt).toISOString().slice(0, 10), kind: 'plan_changed', ref: { kind, id, name: nameOf(kind, id) } });
    }
  }
  out.push(...versions.sort((a, b) => b.d.localeCompare(a.d)).slice(0, 4));
  for (const e of priv?.events || []) {
    if (!EVENT_KINDS.includes(e.kind) || !ISO_AT.test(e.at || '')) continue;       // legacy note_updated / note_cleared are not decisions
    out.push({ d: e.at.slice(0, 10), at: e.at, kind: e.kind, ref: e.ref || null, text: e.text || null, by: who(e.by) });
  }
  return out.sort((a, b) => (b.at || b.d + 'T12').localeCompare(a.at || a.d + 'T12')).slice(0, limit);
}
