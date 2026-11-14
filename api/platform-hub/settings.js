import crypto from 'node:crypto';
import { z } from 'zod';
import { PREFERENCE_KEYS, PRIVACY_CHOICES, PRIVACY_FLAGS } from '../notifications/store.js';

// F9c · Training settings that 2J Home may read and change for the member (2JHub contract §7, H-67/H-76): personalisation (accent, theme,
// text size), social notifications and privacy. Training stays the ONLY source of truth: Platform only forwards a signed call, never stores.
// Exact allowlist, strict bodies. Training and Health (guidance, effort per set, Apple Health, Health Connect, WHOOP, Strava), passkeys, device
// links, push (needs the device's own permission), PIN, tokens and admin settings are NOT reachable here.
//
// Values are applied with the same rules as Settings: accent/theme/text size are fields of the synced state (the SAME read/write path as every
// other server-side write, which bumps the sync revision — a stale device then gets SYNC_CONFLICT instead of silently undoing the change);
// notifications and privacy go through notifications/store.js setPreferences/setPrivacy with its own value lists.

/** Same keys as frontend/src/lib/format.js ACCENTS (a frontend test checks they never drift). */
export const HUB_ACCENTS = Object.freeze(['lime', 'grey', 'black', 'sky', 'red', 'violet', 'orange', 'yellow', 'teal', 'indigo', 'pink']);
/** Settings → Appearance → Theme ('system' follows the device) and → Text size (the four steps the Segmented offers). */
export const HUB_APPEARANCES = Object.freeze(['system', 'dark', 'light']);
export const HUB_TEXT_SCALES = Object.freeze([0.9, 1, 1.15, 1.3]);
/** Social notifications only: `push` is switched on per device in Training (it needs that device's permission). */
export const HUB_NOTIFICATION_KEYS = Object.freeze(PREFERENCE_KEYS.filter(key => key !== 'push'));

const bools = keys => z.object(Object.fromEntries(keys.map(key => [key, z.boolean()]))).strict();
const personalization = z.object({
  accent: z.enum(HUB_ACCENTS), appearance: z.enum(HUB_APPEARANCES), textScale: z.union(HUB_TEXT_SCALES.map(v => z.literal(v))),
}).strict();
const notifications = bools(HUB_NOTIFICATION_KEYS);
const privacy = z.object({
  profile: z.enum(PRIVACY_CHOICES.profile), activity: z.enum(PRIVACY_CHOICES.activity),
  ...Object.fromEntries(PRIVACY_FLAGS.map(key => [key, z.boolean()])),
}).strict();
export const settingsPatchSchema = z.object({
  v: z.literal(1), personalization: personalization.partial().strict().optional(), notifications: notifications.partial().strict().optional(), privacy: privacy.partial().strict().optional(),
}).strict().refine(patch => changedFields(patch).length > 0);

export const changedFields = patch => ['personalization', 'notifications', 'privacy'].flatMap(group => Object.keys(patch[group] || {}).map(key => `${group}.${key}`));

const KEY = /^[\x21-\x7e]{8,200}$/;
const KEEP_MS = 24 * 3600_000, KEEP_MAX = 2000;

export function createHubSettings({ db, saveDb, secEvent, json, readState, writeState, notifications: store, now = Date.now }) {
  db.platformHubSettingsKeys = db.platformHubSettingsKeys && typeof db.platformHubSettingsKeys === 'object' && !Array.isArray(db.platformHubSettingsKeys) ? db.platformHubSettingsKeys : {};

  /** What Settings shows, with the same fallbacks (accent || 'lime', theme light/dark else 'system', textScale || 1). */
  function read(uid) {
    const state = readState(uid) || {};
    const prefs = store.preferencesFor(uid), priv = store.privacyFor(uid);
    return {
      v: 1,
      personalization: {
        accent: HUB_ACCENTS.includes(state.accent) ? state.accent : 'lime',
        appearance: state.theme === 'light' || state.theme === 'dark' ? state.theme : 'system',
        textScale: HUB_TEXT_SCALES.includes(state.textScale) ? state.textScale : 1,
      },
      notifications: Object.fromEntries(HUB_NOTIFICATION_KEYS.map(key => [key, prefs[key] !== false])),
      privacy: {
        profile: priv.profile, activity: priv.activity,
        ...Object.fromEntries(PRIVACY_FLAGS.map(key => [key, priv[key] === true])),
      },
    };
  }

  /** Synchronous read-modify-write (no await): last write wins, never a stale copy of other fields. */
  function apply(uid, patch) {
    const p = patch.personalization;
    if (p && Object.keys(p).length) {
      const state = readState(uid) || {};
      if ('accent' in p) state.accent = p.accent;
      if ('appearance' in p) state.theme = p.appearance;
      if ('textScale' in p) state.textScale = p.textScale;
      writeState(uid, state);
    }
    if (patch.notifications && Object.keys(patch.notifications).length) store.setPreferences(uid, patch.notifications);
    if (patch.privacy && Object.keys(patch.privacy).length) store.setPrivacy(uid, patch.privacy);
  }

  function prune() {
    const keys = db.platformHubSettingsKeys, limit = now() - KEEP_MS;
    const entries = Object.entries(keys).filter(([, value]) => Date.parse(value.at) >= limit).sort((a, b) => (a[1].at < b[1].at ? -1 : 1)).slice(-KEEP_MAX);
    db.platformHubSettingsKeys = Object.fromEntries(entries);
  }

  return {
    get(res, user) { return json(res, 200, read(user.id)); },

    patch(req, res, user, raw) {
      if (String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') return json(res, 400, { error: 'invalid_request' });
      const key = req.headers['idempotency-key'];
      if (typeof key !== 'string' || !KEY.test(key)) return json(res, 400, { error: 'idempotency_key_required' });
      let patch;
      try { patch = settingsPatchSchema.parse(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw))); } catch { return json(res, 400, { error: 'invalid_request' }); }
      const hash = crypto.createHash('sha256').update(raw).digest('hex');
      const slot = `${user.id}:${key}`;
      const seen = db.platformHubSettingsKeys[slot];
      if (seen) return seen.hash === hash ? json(res, 200, read(user.id)) : json(res, 422, { error: 'idempotency_key_reused' });
      try { apply(user.id, patch); } catch (error) {
        if (error?.status === 503) return json(res, 503, { error: 'unavailable' });   // unreadable state: nothing is overwritten
        throw error;
      }
      const fields = changedFields(patch);
      db.platformHubSettingsKeys[slot] = { hash, at: new Date(now()).toISOString() };
      prune();
      // What changed (field names count and groups), never the values.
      secEvent('platform_hub_settings_changed', { userId: user.id, meta: { count: fields.length, kind: [...new Set(fields.map(f => f.split('.')[0]))].join(',') } });
      saveDb();
      return json(res, 200, read(user.id));
    },

    /** Account erasure: drop this member's idempotency slots (they carry the account id). */
    forget(uid) {
      for (const slot of Object.keys(db.platformHubSettingsKeys)) if (slot.startsWith(`${uid}:`)) delete db.platformHubSettingsKeys[slot];
    },
  };
}
