// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Webhook engine: turns a member's saved state change into signed deliveries, off the request path.
   - enabled only when the server is started with WEBHOOKS_ENABLED=1 (default off); no member data is touched otherwise;
   - up to 4 attempts per event (waits 30 s, 2 min, 10 min between them), only for timeouts, network errors, 408, 429 and 5xx;
   - 3xx, other 4xx and blocked targets are final on the first attempt;
   - at most 30 attempts per endpoint per rolling hour; the excess is logged as rate_limited and dropped;
   - 10 final failures in a row switch the endpoint off (disabledReason "failures"); the owner re-enables it.
   Queued work lives in memory: a server restart drops retries that were still waiting (the log says so by absence). */
import { newEvents, newEventId, buildPayload } from './events.js';
import { sendSigned } from './delivery.js';

export const RETRY_DELAYS_MS = Object.freeze([30000, 120000, 600000]);
export const MAX_ATTEMPTS = 4;
export const RATE_PER_HOUR = 30;
const HOUR = 3600000;

const retryable = r => r.status === 'timeout' || r.status === 'network'
  || (r.status === 'http' && (r.httpCode >= 500 || r.httpCode === 429 || r.httpCode === 408));

export function createWebhookService({
  store, enabled = false, send = sendSigned, now = () => Date.now(),
  schedule = (fn, ms) => { const t = setTimeout(fn, ms); t.unref?.(); },
}) {
  const hits = new Map();   // endpoint id -> timestamps of recent attempts

  function withinRate(id, at) {
    const recent = (hits.get(id) || []).filter(t => at - t < HOUR);
    hits.set(id, recent);
    if (recent.length >= RATE_PER_HOUR) return false;
    recent.push(at);
    return true;
  }

  async function attempt(job) {
    try {
      const ep = store.byId(job.uid, job.webhookId);
      if (!ep || !ep.enabled) return;
      const at = now();
      const log = extra => store.logDelivery({ uid: job.uid, webhookId: job.webhookId, event: job.event, eventId: job.eventId, attempt: job.attempt, at, ...extra });
      if (!withinRate(ep.id, at)) { log({ status: 'rate_limited' }); return; }
      const secret = store.secretFor(ep);
      if (!secret) { log({ status: 'blocked' }); store.recordOutcome({ uid: job.uid, id: ep.id, ok: false, status: 'blocked', now: at }); return; }
      const result = await send({ url: ep.url, body: job.body, secret, eventId: job.eventId, now: now() });
      log({ status: result.status, httpCode: result.httpCode, durationMs: result.durationMs });
      if (result.status === 'ok') { store.recordOutcome({ uid: job.uid, id: ep.id, ok: true, status: 'ok', now: at }); return; }
      if (retryable(result) && job.attempt < MAX_ATTEMPTS) {
        const wait = RETRY_DELAYS_MS[job.attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
        schedule(() => attempt({ ...job, attempt: job.attempt + 1 }), wait);
        return;
      }
      store.recordOutcome({ uid: job.uid, id: ep.id, ok: false, status: result.status, now: at });
    } catch (err) {
      // Never let a delivery fault reach the request that caused it.
      console.error('webhook delivery', err && err.code || 'error');
    }
  }

  return {
    enabled: () => enabled === true,

    /** Called by the state store after every successful member-state write. Never throws, never waits for delivery. */
    onStateWritten(uid, prev, next) {
      if (!enabled || !uid) return;
      try {
        for (const ev of newEvents(uid, prev, next, now())) {
          const subs = store.subscribed(uid, ev.type);
          if (!subs.length) continue;
          if (!store.markSent(uid, ev.key)) continue;
          const eventId = newEventId();
          const body = buildPayload({ type: ev.type, eventId, created: now(), date: ev.date });
          for (const ep of subs) schedule(() => attempt({ uid, webhookId: ep.id, event: ev.type, eventId, body, attempt: 1 }), 0);
        }
      } catch (err) {
        console.error('webhook event', err && err.code || 'error');
      }
    },
  };
}
