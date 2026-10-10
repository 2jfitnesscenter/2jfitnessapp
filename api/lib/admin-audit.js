// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* What an administrator did, in the account-security log (lib/security-audit.js): one generic `admin_action` event per successful admin write, with
 * a `kind` (what), the member it touched when there is one (the event's userId), and at most a target id, a count or a short reason.
 * Never a value: no text, measurement, health data, note, token, key, code or file content ever goes into an event.
 *
 * Every admin write route is classified here, and a test (admin-audit.test.js) fails when a new `POST /api/admin/...` or bunker admin route is added without
 * a decision: audited, audited somewhere else, or deliberately not audited.
 */

const str = v => (typeof v === 'string' && v ? v : undefined);
const keys = o => (o && typeof o === 'object' && !Array.isArray(o) ? Object.keys(o) : []);
const member = b => str(b.id);
const ai = (target, reason) => ({ kind: 'ai_config', target, reason });
const integration = (target, reason) => ({ kind: 'integration_config', target, reason });

/** key → how to describe it. `user` = the member it touched, `target`/`count`/`reason` = the few facts allowed. */
export const AUDITED = Object.freeze({
  'POST /api/admin/user/trainers': { kind: 'trainers_assigned', user: member, count: b => (Array.isArray(b.trainerIds) ? b.trainerIds.length : 0) },
  'POST /api/admin/invites/new': { kind: 'invite_created' },
  'POST /api/admin/invites/revoke': { kind: 'invite_revoked' },
  'POST /api/admin/user/profile': { kind: 'profile_edited', user: member },
  'POST /api/admin/user/measurements': { kind: 'measurements_edited', user: member },
  'POST /api/admin/user/apply-starter-plan': { kind: 'starter_plan_applied', user: member },
  'POST /api/admin/user/features': { kind: 'member_features', user: member, count: b => ['enableTrainingZones', 'enableRpVolumeZones'].filter(k => typeof b[k] === 'boolean').length },
  'POST /api/admin/features': { kind: 'features_changed', count: b => keys(b.features).length, target: b => (keys(b.features).length === 1 ? keys(b.features)[0] : undefined) },
  'POST /api/admin/news/save': { kind: 'news_saved', target: b => str(b.id) },
  'POST /api/admin/news/active': { kind: 'news_toggled', target: b => str(b.id) },
  'POST /api/admin/news/delete': { kind: 'news_deleted', target: b => str(b.id) },
  'POST /api/admin/news/reorder': { kind: 'news_reordered' },
  'POST /api/admin/equipment/unavailable': { kind: 'equipment_availability', target: b => str(b.eq) },
  'POST /api/admin/exercises/hidden': { kind: 'exercise_visibility', target: b => str(b.id) },
  'POST /api/admin/gym-profile/official': { kind: 'gym_profile_official', count: b => (Array.isArray(b.availableEquipment) ? b.availableEquipment.length : 0) },
  'POST /api/admin/library/save': { kind: 'library_saved', target: b => str(b.id) },
  'POST /api/admin/recovery-requests/resolve': { kind: 'recovery_request_resolved' },
  'POST /api/admin/coach/config': ai('coach', 'config'),
  'POST /api/admin/coach/auth/key': ai('coach', 'auth_key'),
  'POST /api/admin/coach/auth/disconnect': ai('coach', 'auth_disconnect'),
  'POST /api/admin/coach/auth/setup-token': ai('coach', 'setup_token'),
  'POST /api/admin/coach/auth/chatgpt/device': ai('coach', 'chatgpt_device'),
  'POST /api/admin/trainer-ai/config': ai('trainer-ai', 'config'),
  'POST /api/admin/trainer-ai/auth/disconnect': ai('trainer-ai', 'auth_disconnect'),
  'POST /api/admin/trainer-ai/auth/setup-token': ai('trainer-ai', 'setup_token'),
  'POST /api/admin/aux-ai/config': ai('aux-ai', 'config'),
  'POST /api/admin/aux-ai/auth/key': ai('aux-ai', 'auth_key'),
  'POST /api/admin/aux-ai/auth/disconnect': ai('aux-ai', 'auth_disconnect'),
  'POST /api/admin/strava/config': integration('strava', 'config'),
  'POST /api/admin/strava/config/clear': integration('strava', 'clear'),
  'POST /api/admin/whoop/config': integration('whoop', 'config'),
  'POST /api/admin/whoop/config/clear': integration('whoop', 'clear'),
});

/** Bunker admin writes (the module audits them itself, because the kiosk admin token is verified there). */
export const BUNKER_AUDITED = Object.freeze({
  'POST /api/bunker/admin-checkin': { kind: 'bunker_checkin', user: b => str(b.uid) },
  'POST /api/bunker/admin/close': { kind: 'bunker_session_closed', user: b => str(b.uid) },
  'POST /api/bunker/admin/pause': { kind: 'bunker_session_paused', user: b => str(b.uid) },
  'POST /api/bunker/admin/edit-set': { kind: 'bunker_set_edited', user: b => str(b.uid) },
  'POST /api/bunker/admin/pin-reset': { kind: 'bunker_pin_reset', user: b => str(b.uid) },
  'POST /api/bunker/admin/room-key/reset': { kind: 'bunker_room_key_reset' },
  'POST /api/bunker/admin/settings': { kind: 'bunker_settings' },
});

/** Written elsewhere, already: role and account changes and recovery links (security events of their own), content removal, Shared Staff (its own audit). */
export const AUDITED_ELSEWHERE = Object.freeze([
  'POST /api/admin/user/role', 'POST /api/admin/user/disable', 'POST /api/admin/user/recovery-link', 'POST /api/admin/user/trainer',   // the last one delegates to role
  'POST /api/admin/social-reports/resolve',                                                                                         // content_removed
  'POST /api/admin/shared-device/revoke', 'POST /api/admin/shared-staff/pin',
]);

/** Deliberately not audited: they change nothing (connection tests, WebAuthn challenges) or belong to the Coach follow-up area, which has its own history. */
export const NOT_AUDITED = Object.freeze([
  'POST /api/admin/coach/test', 'POST /api/admin/trainer-ai/test', 'POST /api/admin/aux-ai/test',
  'POST /api/admin/shared-device/revoke/options', 'POST /api/admin/shared-staff/pin/options',
  'POST /api/admin/user/followup', 'POST /api/admin/user/followup/notes', 'POST /api/admin/user/review', 'POST /api/admin/user/routine-cycle', 'POST /api/admin/user/routine-reviewed',
]);

/** The event parts for a rule and a request body: { kind, userId, meta } (meta holds only the allow-listed facts). */
export function describeAction(rule, body) {
  const b = body && typeof body === 'object' ? body : {};
  const pick = f => (typeof f === 'function' ? f(b) : f);
  const meta = { kind: rule.kind };
  const target = pick(rule.target); if (target !== undefined) meta.target = target;
  const count = pick(rule.count); if (Number.isFinite(count)) meta.count = count;
  const reason = pick(rule.reason); if (reason) meta.reason = reason;
  return { userId: pick(rule.user) || null, meta };
}
