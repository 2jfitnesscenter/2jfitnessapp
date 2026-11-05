// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Member-owned webhook endpoints, their encrypted signing secrets, the delivery log and the dedupe set.
   Lives in its own file (webhooks.json) under DATA_DIR, never in the member state, so it stays out of Sync V2.
   The secret is stored only as an AES-256-GCM blob (webhook-security.js); it is returned once, at creation or
   rotation, and never by any reader in this module. The delivery log holds status and event id only, never a body. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isJsonRecord, readJsonStore } from '../lib/json-store.js';
import { validateWebhookUrl, encryptWebhookSecret, decryptWebhookSecret, generateWebhookSecret } from '../lib/webhook-security.js';
import { WEBHOOK_EVENTS, DEFAULT_EVENTS } from './events.js';

export const MAX_ENDPOINTS_PER_MEMBER = 3;
export const MAX_DELIVERIES_PER_MEMBER = 500;
export const MAX_SENT_KEYS = 5000;
export const FAILURES_BEFORE_DISABLE = 10;

const clean = (value, n) => String(value ?? '').slice(0, n);

export function createWebhookStore({ dataDir = process.env.DATA_DIR || '/data' } = {}) {
  const FILE = path.join(dataDir, 'webhooks.json');
  const disk = readJsonStore(FILE, {
    initial: { endpoints: [], deliveries: [], sent: [] },
    validate: v => isJsonRecord(v) && (v.endpoints === undefined || Array.isArray(v.endpoints))
      && (v.deliveries === undefined || Array.isArray(v.deliveries)) && (v.sent === undefined || Array.isArray(v.sent)),
  });
  const state = { endpoints: disk.endpoints || [], deliveries: disk.deliveries || [], sent: disk.sent || [] };   // sent: [{ u: uid, k: dedupe key }]
  const sentSet = new Set(state.sent.map(x => x.k));

  function save() {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, FILE);
  }

  // Public view: never the secret, never the blob, never the full URL (the host is enough to recognise it).
  const view = ep => ({
    id: ep.id, host: ep.host, events: [...ep.events], enabled: ep.enabled === true, createdAt: ep.createdAt,
    failures: ep.failures || 0, lastStatus: ep.lastStatus || null, lastAt: ep.lastAt || null,
    disabledReason: ep.disabledReason || null,
  });
  const hostOf = url => new URL(url).hostname;

  const api = {
    FILE,
    list: uid => state.endpoints.filter(e => e.userId === uid).map(view),
    /** Raw record for the engine (internal). */
    byId: (uid, id) => state.endpoints.find(e => e.userId === uid && e.id === id) || null,
    /** Internal: every enabled endpoint of every member that subscribes to `type`. */
    subscribed: (uid, type) => state.endpoints.filter(e => e.userId === uid && e.enabled && e.events.includes(type)),
    secretFor: ep => decryptWebhookSecret(ep.secretBlob),
    count: uid => state.endpoints.filter(e => e.userId === uid).length,

    create({ uid, url, events, now = Date.now() }) {
      const v = validateWebhookUrl(url);
      if (!v.ok) return { error: v.code, message: v.message };
      const list = events === undefined || events === null ? [...DEFAULT_EVENTS] : (Array.isArray(events) ? events : null);
      if (!list || list.length === 0 || list.some(t => !WEBHOOK_EVENTS.includes(t))) return { error: 'WEBHOOK_EVENTS_INVALID', message: 'Unknown event type.' };
      if (api.count(uid) >= MAX_ENDPOINTS_PER_MEMBER) return { error: 'WEBHOOK_LIMIT', message: 'Too many endpoints.' };
      const secret = generateWebhookSecret();
      const ep = {
        id: 'wh_' + crypto.randomBytes(9).toString('base64url'), userId: uid, url: v.url, host: hostOf(v.url),
        events: [...new Set(list)], enabled: true, createdAt: now, secretBlob: encryptWebhookSecret(secret),
        failures: 0, lastStatus: null, lastAt: null, disabledReason: null,
      };
      state.endpoints.push(ep); save();
      return { endpoint: view(ep), secret };
    },

    update({ uid, id, enabled, events }) {
      const ep = api.byId(uid, id);
      if (!ep) return { error: 'WEBHOOK_NOT_FOUND' };
      if (events !== undefined) {
        if (!Array.isArray(events) || events.length === 0 || events.some(t => !WEBHOOK_EVENTS.includes(t))) return { error: 'WEBHOOK_EVENTS_INVALID' };
        ep.events = [...new Set(events)];
      }
      if (enabled !== undefined) {
        ep.enabled = enabled === true;
        if (ep.enabled) { ep.failures = 0; ep.disabledReason = null; }
        else ep.disabledReason = ep.disabledReason || 'owner';
      }
      save();
      return { endpoint: view(ep) };
    },

    rotate({ uid, id }) {
      const ep = api.byId(uid, id);
      if (!ep) return { error: 'WEBHOOK_NOT_FOUND' };
      const secret = generateWebhookSecret();
      ep.secretBlob = encryptWebhookSecret(secret);
      save();
      return { endpoint: view(ep), secret };
    },

    remove({ uid, id }) {
      const before = state.endpoints.length;
      state.endpoints = state.endpoints.filter(e => !(e.userId === uid && e.id === id));
      if (state.endpoints.length === before) return { error: 'WEBHOOK_NOT_FOUND' };
      save();
      return { ok: true };
    },

    /** Engine bookkeeping: outcome of one final delivery attempt. Returns true when the endpoint was switched off. */
    recordOutcome({ uid, id, ok, status, now = Date.now() }) {
      const ep = api.byId(uid, id);
      if (!ep) return false;
      ep.lastStatus = clean(status, 24); ep.lastAt = now;
      let disabled = false;
      if (ok) ep.failures = 0;
      else {
        ep.failures = (ep.failures || 0) + 1;
        if (ep.failures >= FAILURES_BEFORE_DISABLE && ep.enabled) { ep.enabled = false; ep.disabledReason = 'failures'; disabled = true; }
      }
      save();
      return disabled;
    },

    logDelivery({ uid, webhookId, event, eventId, status, httpCode = null, durationMs = 0, attempt = 1, at = Date.now() }) {
      state.deliveries.push({ at, uid, webhookId, event: clean(event, 40), eventId: clean(eventId, 60), status: clean(status, 24), httpCode, durationMs: Math.max(0, Math.round(durationMs)), attempt });
      const own = state.deliveries.filter(d => d.uid === uid);
      if (own.length > MAX_DELIVERIES_PER_MEMBER) {
        const drop = new Set(own.slice(0, own.length - MAX_DELIVERIES_PER_MEMBER));
        state.deliveries = state.deliveries.filter(d => !drop.has(d));
      }
      save();
    },

    deliveriesFor: uid => state.deliveries.filter(d => d.uid === uid).slice(-100).reverse()
      .map(({ uid: _u, ...rest }) => rest),

    /** Dedupe: returns false when this key was already emitted, true (and remembers it) otherwise. */
    markSent(uid, key) {
      if (sentSet.has(key)) return false;
      sentSet.add(key); state.sent.push({ u: uid, k: key });
      if (state.sent.length > MAX_SENT_KEYS) { const gone = state.sent.splice(0, state.sent.length - MAX_SENT_KEYS); gone.forEach(x => sentSet.delete(x.k)); }
      save();
      return true;
    },

    /** Account erasure: endpoints, their encrypted secrets, the delivery log and dedupe keys that name this member. */
    removeUser(uid) {
      const before = state.endpoints.length + state.deliveries.length + state.sent.length;
      const gone = new Set(state.endpoints.filter(e => e.userId === uid).map(e => e.id));
      state.endpoints = state.endpoints.filter(e => e.userId !== uid);
      state.deliveries = state.deliveries.filter(d => d.uid !== uid && !gone.has(d.webhookId));
      state.sent = state.sent.filter(x => x.u !== uid);
      sentSet.clear(); state.sent.forEach(x => sentSet.add(x.k));
      const removed = before - state.endpoints.length - state.deliveries.length - state.sent.length;
      if (removed) save();
      return { endpoints: gone.size, removed };
    },

    /** Account export: endpoint metadata and the member's own log. Never the secret. */
    exportUser: uid => ({ endpoints: state.endpoints.filter(e => e.userId === uid).map(view), deliveries: api.deliveriesFor(uid) }),
  };
  return api;
}
