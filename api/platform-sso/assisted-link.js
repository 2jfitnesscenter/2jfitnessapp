// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* H13 — assisted activation of a Búnker<->Platform link (design: docs/H13_ASSISTED_LINK_ACTIVATION.md).
 *
 * A third kind of evidence of Training's OWN, next to the owner's passkey proof and provisioning: a one-use receipt issued by a person who holds the specific
 * permission `platform_link_issue`. That permission is NOT the admin flag: it comes only from PLATFORM_LINK_ISSUERS (server configuration), no route can grant
 * or widen it. Every issuance needs a fresh passkey step-up (one use), is limited per issuer and day, is written to the append-only ledger first, and is
 * consumed by Platform's signed `link/activate` call together with the reviewId of Platform's own approval. OFF unless PLATFORM_ASSISTED_LINK_ENABLED is set.
 */
import crypto from 'node:crypto';
import { z } from 'zod';
import { createLedger, validLedgerKey } from '../lib/append-ledger.js';

export const ASSIST_REASONS = Object.freeze(['lost_device', 'no_home_access', 'support_request', 'other']);
export const RECEIPT_TTL_MS = 24 * 3_600_000;
export const DAILY_ISSUE_LIMIT = 20;
export const MAX_OPEN_REQUESTS_PER_STAFF = 10;
export const STEP_UP_PURPOSE = 'platform-link-issue';
const CANARY_DAY_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Atlantic/Canary', year: 'numeric', month: '2-digit', day: '2-digit',
});

function canaryDay(instant) {
  const parts = Object.fromEntries(CANARY_DAY_FORMATTER.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}
const UUID = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
const userId = z.string().min(1).max(200).refine(value => value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value));
const pairSchema = z.object({ personId: UUID, trainingUserId: userId, reasonCode: z.enum(ASSIST_REASONS), note: z.string().max(80).refine(value => !/[\u0000-\u001f\u007f<>]/.test(value)).optional() }).strict();
const idSchema = z.object({ requestId: UUID, reason: z.string().max(80).refine(value => !/[\u0000-\u001f\u007f<>]/.test(value)).optional() }).strict();

const occupies = link => link && ['pending', 'active'].includes(link.state);

/**
 * @param config {{enabled: boolean, issuers: string[], ledgerFile: string, ledgerKey: string}}
 * @param stepUp {{valid: (req, user) => boolean, consume: (req, user) => boolean}} step-up of THIS purpose
 */
export function createAssistedLink({ config, db, saveDb, json, readBody, requireStaff, requirePasskeySession, stepUp, store, now = Date.now }) {
  db.platformAssist = db.platformAssist && typeof db.platformAssist === 'object' && !Array.isArray(db.platformAssist) ? db.platformAssist : {};
  const legacy = db.platformAssist;
  const hasLegacyState = Array.isArray(legacy.requests) || Array.isArray(legacy.receipts);
  const state = {
    ...(config.enabled || hasLegacyState ? store.readAssistedLinkState() : { requests: [], receipts: [] }),
    head: legacy.head && typeof legacy.head === 'object' ? legacy.head : null,
  };
  // Lossless migration from the earlier db.json implementation. Conflicting IDs fail closed.
  if (hasLegacyState) {
    const mergeBy = (current, old, key) => {
      const merged = new Map(current.map(item => [item[key], item]));
      for (const item of Array.isArray(old) ? old : []) {
        const existing = merged.get(item?.[key]);
        if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw Object.assign(new Error('Conflicting legacy assisted-link state'), { code: 'ASSISTED_LINK_STATE_CONFLICT' });
        if (!existing) merged.set(item?.[key], item);
      }
      return [...merged.values()];
    };
    state.requests = mergeBy(state.requests, legacy.requests, 'requestId');
    state.receipts = mergeBy(state.receipts, legacy.receipts, 'receiptId');
    store.saveAssistedLinkState({ requests: state.requests, receipts: state.receipts });
    delete legacy.requests;
    delete legacy.receipts;
    saveDb();
  }

  let ledger = null;
  if (config.enabled && validLedgerKey(config.ledgerKey)) ledger = createLedger({ file: config.ledgerFile, key: config.ledgerKey, now });
  const issuers = Object.freeze([...new Set(config.issuers)]);

  /** Enabled, key present and the chain intact. Anything else stops issuance AND consumption (fail closed). */
  const healthy = () => !!ledger && ledger.verify(state.head).ok;
  const record = event => { state.head = ledger.append(event, state.head); legacy.head = state.head; };
  const persist = () => {
    store.saveAssistedLinkState({ requests: state.requests, receipts: state.receipts });
    saveDb();
  };
  const isIssuer = user => !!user && issuers.includes(user.id);

  const gate = res => {
    if (!config.enabled) { json(res, 404, { error: 'not_found' }); return false; }
    if (!healthy()) { json(res, 503, { error: 'assist_unavailable' }); return false; }
    return true;
  };

  const liveReceipt = receipt => !receipt.consumedAt && Date.parse(receipt.expiresAt) > now();

  /** Why this (person, Training user) pair cannot be handled now, or null. */
  function conflict(personId, trainingUserId, exceptRequestId = null) {
    const target = db.users.find(user => user.id === trainingUserId);
    if (!target || target.disabled) return { status: 404, code: 'training_user_not_found' };
    if (occupies(target.platformLink)) return { status: 409, code: 'link_conflict' };
    if (db.users.some(other => other.id !== target.id && occupies(other.platformLink) && other.platformLink.personId === personId)) return { status: 409, code: 'link_conflict' };
    const sameSubject = item => item.personId === personId || item.trainingUserId === trainingUserId;
    if (state.requests.some(item => item.status === 'open' && item.requestId !== exceptRequestId && sameSubject(item))) return { status: 409, code: 'already_requested' };
    if (state.receipts.some(item => liveReceipt(item) && sameSubject(item))) return { status: 409, code: 'receipt_outstanding' };
    return null;
  }

  async function parse(req, res, schema) {
    let body; try { body = await readBody(req); } catch { json(res, 400, { error: 'invalid_request' }); return null; }
    const parsed = schema.safeParse(body);
    if (!parsed.success) { json(res, 400, { error: 'invalid_request' }); return null; }
    return parsed.data;
  }

  /** Common path of "approve a request" and "issue directly". Everything is checked before the step-up is spent. */
  function issue(req, res, issuer, data, request = null) {
    const target = db.users.find(user => user.id === data.trainingUserId);
    const found = conflict(data.personId, data.trainingUserId, request?.requestId ?? null);
    if (found) return json(res, found.status, { error: found.code });
    if (target.id === issuer.id) { try { record({ type: 'assist_denied', actorId: issuer.id, personId: data.personId, trainingUserId: data.trainingUserId, result: 'own_account' }); saveDb(); } catch { /* the denial stands regardless */ } return json(res, 403, { error: 'own_account' }); }
    if (!stepUp.valid(req, issuer)) return json(res, 403, { error: 'confirma con tu passkey para continuar', code: 'step_up_required' });
    if (ledger.countOnCanaryDay('assist_approved', issuer.id, canaryDay(now())) >= DAILY_ISSUE_LIMIT) {
      try { record({ type: 'assist_denied', actorId: issuer.id, personId: data.personId, trainingUserId: data.trainingUserId, result: 'daily_limit' }); saveDb(); } catch { /* the denial stands regardless */ }
      return json(res, 429, { error: 'daily_limit' });
    }
    if (!stepUp.consume(req, issuer)) return json(res, 403, { error: 'confirma con tu passkey para continuar', code: 'step_up_required' });
    const receipt = {
      receiptVersion: 2, kind: 'admin_assisted', receiptId: crypto.randomUUID(), personId: data.personId, trainingUserId: data.trainingUserId,
      issuedBy: issuer.id, reasonCode: data.reasonCode, issuedAt: new Date(now()).toISOString(), expiresAt: new Date(now() + RECEIPT_TTL_MS).toISOString(), consumedAt: null,
      ...(request ? { requestId: request.requestId } : {}),
    };
    try { record({ type: 'assist_approved', actorId: issuer.id, personId: receipt.personId, trainingUserId: receipt.trainingUserId, receiptId: receipt.receiptId, requestId: request?.requestId, reasonCode: receipt.reasonCode }); }
    catch { return json(res, 503, { error: 'assist_unavailable' }); }
    state.receipts.push(receipt);
    if (request) { delete request.note; request.status = 'approved'; request.receiptId = receipt.receiptId; request.decidedBy = issuer.id; request.decidedAt = receipt.issuedAt; }
    try { persist(); } catch { return json(res, 503, { error: 'assist_unavailable' }); }
    return json(res, 201, { receiptId: receipt.receiptId, expiresAt: receipt.expiresAt });
  }

  const routes = {
    // Any trainer or administrator can ASK. It records the request and nothing else.
    'POST /api/admin/platform-link/assist-requests': async (req, res) => {
      if (!gate(res)) return;
      const staff = requireStaff(req, res); if (!staff) return;
      const data = await parse(req, res, pairSchema); if (!data) return;
      if (data.trainingUserId === staff.id) return json(res, 403, { error: 'own_account' });
      if (state.requests.filter(item => item.status === 'open' && item.requestedBy === staff.id).length >= MAX_OPEN_REQUESTS_PER_STAFF) return json(res, 429, { error: 'too_many_open_requests' });
      const found = conflict(data.personId, data.trainingUserId);
      if (found) return json(res, found.status, { error: found.code });
      const request = { requestId: crypto.randomUUID(), personId: data.personId, trainingUserId: data.trainingUserId, reasonCode: data.reasonCode, ...(data.note ? { note: data.note } : {}), requestedBy: staff.id, createdAt: new Date(now()).toISOString(), status: 'open' };
      try { record({ type: 'assist_requested', actorId: staff.id, personId: request.personId, trainingUserId: request.trainingUserId, requestId: request.requestId, reasonCode: request.reasonCode }); }
      catch { return json(res, 503, { error: 'assist_unavailable' }); }
      state.requests.push(request);
      try { persist(); } catch { return json(res, 503, { error: 'assist_unavailable' }); }
      return json(res, 201, { requestId: request.requestId });
    },

    // Only the permission holders see the open requests: identifiers and the reason code only. The free-text note is NEVER returned (and is dropped once the request is decided).
    'GET /api/admin/platform-link/assist-requests': async (req, res) => {
      if (!gate(res)) return;
      const user = requirePasskeySession(req, res); if (!user) return;
      if (!isIssuer(user)) return json(res, 403, { error: 'not_issuer' });
      return json(res, 200, { requests: state.requests.filter(item => item.status === 'open').map(({ requestId, personId, trainingUserId }) => ({ requestId, personId, trainingUserId })) });
    },

    'POST /api/admin/platform-link/assist-requests/approve': async (req, res) => {
      if (!gate(res)) return;
      const issuer = requirePasskeySession(req, res); if (!issuer) return;
      if (!isIssuer(issuer)) return json(res, 403, { error: 'not_issuer' });
      const data = await parse(req, res, idSchema); if (!data) return;
      const request = state.requests.find(item => item.requestId === data.requestId && item.status === 'open');
      if (!request) return json(res, 404, { error: 'request_not_found' });
      return issue(req, res, issuer, request, request);
    },

    'POST /api/admin/platform-link/assist-requests/reject': async (req, res) => {
      if (!gate(res)) return;
      const issuer = requirePasskeySession(req, res); if (!issuer) return;
      if (!isIssuer(issuer)) return json(res, 403, { error: 'not_issuer' });
      const data = await parse(req, res, idSchema); if (!data) return;
      const request = state.requests.find(item => item.requestId === data.requestId && item.status === 'open');
      if (!request) return json(res, 404, { error: 'request_not_found' });
      try { record({ type: 'assist_rejected', actorId: issuer.id, personId: request.personId, trainingUserId: request.trainingUserId, requestId: request.requestId }); }
      catch { return json(res, 503, { error: 'assist_unavailable' }); }
      delete request.note; request.status = 'rejected'; request.decidedBy = issuer.id; request.decidedAt = new Date(now()).toISOString();
      try { persist(); } catch { return json(res, 503, { error: 'assist_unavailable' }); }
      return json(res, 200, { ok: true });
    },

    // A holder may also issue without a prior request.
    'POST /api/admin/platform-link/assist': async (req, res) => {
      if (!gate(res)) return;
      const issuer = requirePasskeySession(req, res); if (!issuer) return;
      if (!isIssuer(issuer)) return json(res, 403, { error: 'not_issuer' });
      const data = await parse(req, res, pairSchema); if (!data) return;
      return issue(req, res, issuer, data);
    },
  };

  /**
   * Called by Platform's signed link/activate with origin 'admin_assisted'. Consumes the receipt (one use) and writes the ledger first.
   * @returns {{status: 'ok', receipt: object} | {status: 'disabled'|'unavailable'|'missing'}}
   */
  function consume({ receiptId, reviewId, personId, trainingUserId, revokedAt = null }) {
    if (!config.enabled) return { status: 'disabled' };
    if (!healthy()) return { status: 'unavailable' };
    const receipt = state.receipts.find(item => item.receiptId === receiptId && item.personId === personId && item.trainingUserId === trainingUserId);
    if (!receipt || !liveReceipt(receipt)) return { status: 'missing' };
    if (revokedAt && !(Date.parse(receipt.issuedAt) > Date.parse(revokedAt))) return { status: 'missing' };   // after a revocation only a NEW receipt counts
    try { record({ type: 'assist_consumed', actorId: receipt.issuedBy, personId, trainingUserId, receiptId, requestId: receipt.requestId, reviewId, reasonCode: receipt.reasonCode }); }
    catch { return { status: 'unavailable' }; }
    receipt.consumedAt = new Date(now()).toISOString();
    receipt.reviewId = reviewId;
    try { persist(); } catch {
      receipt.consumedAt = null;
      delete receipt.reviewId;
      return { status: 'unavailable' };
    }
    return { status: 'ok', receipt };
  }

  /** Writes "who promoted whom to administrator" to the ledger when it is available; never blocks the promotion itself (the step-up already did). */
  function noteAdminPromotion(actorId, targetId) {
    if (!ledger) return;
    try { record({ type: 'admin_promoted', actorId, trainingUserId: targetId, result: 'ok' }); } catch { /* the security log still has role_changed */ }
  }

  return Object.freeze({ routes, consume, noteAdminPromotion, isIssuer, enabled: config.enabled });
}

/** PLATFORM_LINK_ISSUERS="uid1,uid2" -> ["uid1","uid2"] */
export const parseIssuers = value => String(value || '').split(',').map(item => item.trim()).filter(Boolean);
