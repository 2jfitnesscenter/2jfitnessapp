// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Sliding-window limits for the social surfaces (friend requests, messages, comments, shares, reports). In memory and per person: a restart forgets
 * them, which is fine for a spam brake. The numbers are chosen so normal use never meets them (a chat with a friend, a few comments, a handful of shares).
 */
export function createLimiter({ now = Date.now, maxKeys = 20_000 } = {}) {
  const hits = new Map();   // key -> timestamps (ms), oldest first
  const sweep = t => { for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 3_700_000) hits.delete(k); };
  return {
    /** Counts one attempt against `max` per `windowMs`. { ok: true } or { ok: false, retryAfter } (seconds). */
    hit(key, max, windowMs) {
      const t = now();
      const list = (hits.get(key) || []).filter(x => t - x < windowMs);
      if (list.length >= max) { hits.set(key, list); return { ok: false, retryAfter: Math.max(1, Math.ceil((list[0] + windowMs - t) / 1000)) }; }
      list.push(t); hits.set(key, list);
      if (hits.size > maxKeys) sweep(t);
      return { ok: true };
    },
    reset() { hits.clear(); },
  };
}

/** The one place the numbers live. [bucket, max, windowMs] */
export const LIMITS = Object.freeze({
  friendRequest: ['friend-request', 15, 3_600_000],
  lookup: ['friend-lookup', 20, 600_000],
  messageBurst: ['message-burst', 20, 30_000],
  messageHour: ['message-hour', 300, 3_600_000],
  supportThread: ['support-thread', 5, 3_600_000],
  commentBurst: ['comment-burst', 10, 60_000],
  commentHour: ['comment-hour', 120, 3_600_000],
  topic: ['topic', 10, 3_600_000],
  share: ['share', 30, 3_600_000],
  report: ['report', 10, 3_600_000],
});
/** After a request is declined, the sender waits this long before asking the same person again. */
export const REQUEST_COOLDOWN_MS = 24 * 3_600_000;
