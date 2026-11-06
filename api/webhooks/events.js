// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Outbound webhook events: which events exist, what a payload may contain, and how new events are found.

   OWNER-APPROVED FIELD LIST (docs/WEBHOOKS_SECURITY_REVIEW.md §5). The payload is exactly:
     { id, type, created, data: { date } }
   where `type` is one of WEBHOOK_EVENTS and `date` is the calendar day (YYYY-MM-DD) of the workout or weigh-in.
   No weight, health value, exercise name, routine name, note, duration, photo or identifier of the member is ever
   added. Widening this list needs a new owner decision; do not add fields here without one. */
import crypto from 'node:crypto';

export const WEBHOOK_EVENTS = Object.freeze(['workout.finished', 'weighin.recorded']);
export const DEFAULT_EVENTS = Object.freeze(['workout.finished']);
export const PAYLOAD_FIELDS = Object.freeze(['id', 'type', 'created', 'data']);
export const PAYLOAD_DATA_FIELDS = Object.freeze(['date']);

// Only events whose day is this recent are sent. A backup restore or an old import must never fan out as a burst.
export const FRESH_WINDOW_MS = 3 * 86400000;

const isIsoDay = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

/** The one builder of an outbound body. Returns the JSON text that is signed and sent. */
export function buildPayload({ type, eventId, created, date }) {
  if (!WEBHOOK_EVENTS.includes(type)) throw new Error('unknown webhook event');
  if (!isIsoDay(date)) throw new Error('bad date');
  return JSON.stringify({ id: String(eventId), type, created: new Date(created).toISOString(), data: { date } });
}

export const newEventId = () => 'evt_' + crypto.randomBytes(16).toString('base64url');

// Stable, non-reversible key for "this event was already emitted", so a re-sent state never fires twice.
export const dedupeKey = (uid, type, objectKey) => crypto.createHash('sha256').update(`${uid}\u0000${type}\u0000${objectKey}`).digest('hex');

/**
 * New events between two saved states of one member. `prev` null (first save of an account, or a restore) yields nothing.
 * Returns [{ type, date, key }] where `key` is the dedupe key. Only the day is read from a record.
 */
export function newEvents(uid, prev, next, now = Date.now()) {
  if (!prev || !next || typeof prev !== 'object' || typeof next !== 'object') return [];
  const out = [];
  const fresh = d => isIsoDay(d) && Date.parse(d + 'T00:00:00Z') >= now - FRESH_WINDOW_MS;

  const before = new Set((prev.workouts || []).map(w => w && w.id));
  for (const w of next.workouts || []) {
    if (!w || typeof w.id !== 'string' || before.has(w.id) || !fresh(w.d)) continue;
    out.push({ type: 'workout.finished', date: w.d, key: dedupeKey(uid, 'workout.finished', w.id) });
  }

  const seen = new Set((prev.bodyweight || []).map(e => e && `${e.d}|${e.t ?? ''}`));
  for (const e of next.bodyweight || []) {
    if (!e || !fresh(e.d)) continue;
    const k = `${e.d}|${e.t ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ type: 'weighin.recorded', date: e.d, key: dedupeKey(uid, 'weighin.recorded', k) });
  }
  return out;
}
