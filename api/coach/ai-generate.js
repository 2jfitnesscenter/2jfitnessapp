// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* generate → parse → validate → 2J protocol gate → (repair) → result, for every flow that asks a
 * model for a routine or a review: the member Coach (jobs.js) and the trainer panel
 * (trainer-jobs.js) both call this instead of each carrying their own copy.
 *
 * The provider side (retry with backoff, fallback model, timeouts) is ai-run.js. This file adds
 * what only matters once an answer exists:
 *   - an answer that is not JSON / breaks the contract / fails validation / fails the protocol
 *     gate goes back to the model with the exact errors (prompts/repair.md) — up to MAX_REPAIRS
 *     times, and only while the shared budget has calls left;
 *   - a provider failure is NEVER mistaken for an answer, and a bad answer is never reported as a
 *     provider failure: the class tells the owner which one it was.
 * No prompt, answer or member data is logged here: counts and ids only.
 */
import { invokeWithRetry, aiLog, budgetCancelled, budgetExhausted } from './ai-run.js';
import { extractJSON, validatePlan, validateReview, contractOK } from './validate.js';
import { expandBlocks, gatePlan, gateReview, ctxFromPayload } from './protocol-gate.js';
import * as payloadLib from './payload.js';

export const MAX_REPAIRS = 2;

/**
 * @param o { flow, job, provider, adapter, kind:'create'|'review', payload, buildPrompt,
 *            args (adapter.invoke args minus prompt), policy, budget, track, onPhase, fallbacks }
 * @returns { ok: true, nochange?, reading?, bundle?, proposal? } | { ok: false, errorClass, detail?, final }
 *   errorClass: timeout | auth | missing | provider | unavailable | unusable | cancelled
 */
export async function generateWithRepair(o) {
  const { flow, job, provider, adapter, kind, payload, buildPrompt, args, policy, budget, track, onPhase, fallbacks } = o;
  const ctx = ctxFromPayload(payload);

  async function once(repair) {
    const prompt = buildPrompt(kind, payload, repair);
    const r = await invokeWithRetry(adapter, { ...args, prompt }, { flow, job, provider, repair: !!repair, budget, track, onPhase, fallbacks }, policy);
    if (r.failure) {
      const f = r.failure;
      // Said once, honestly: "still busy after several tries" is not "the owner must fix the setup".
      const errorClass = f.cancelled ? 'cancelled'
        : (f.transient || f.budget) && f.errorClass !== 'timeout' ? 'unavailable'
        : f.errorClass === 'empty' ? 'provider' : f.errorClass;
      return {
        ok: false, provider: true, errorClass,
        detail: [f.status, String(r.stderr || '').replace(/\s+/g, ' ').slice(0, 160)].filter(Boolean).join(' ') || null,
        attempts: r.attempts || 0, timeoutCount: r.timeoutCount || 0, usedFallback: !!r.usedFallback
      };
    }

    onPhase?.('validating');
    const parsed = extractJSON(r.text);
    if (parsed.error) {
      track?.badJson();
      aiLog('AI_PARSE_ERROR', { flow, job, chars: String(r.text || '').length });
      return { ok: false, errors: [parsed.error], raw: r.text, errorClass: 'unusable' };
    }
    if (!contractOK(parsed.value)) {
      track?.validationFailure();
      return { ok: false, errors: [`coach_contract must be ${payloadLib.CONTRACT}`], raw: r.text, errorClass: 'unusable' };
    }

    let v;
    if (kind === 'review') {
      v = validateReview(parsed.value, payload.plan);
      // A review may not introduce a 2J protocol FAIL the plan did not already have.
      if (v.ok && v.proposal) { const g = gateReview(v.proposal, payload.plan, ctx); v = g.ok ? { ok: true, proposal: g.proposal } : { ok: false, errors: g.errors }; }
    } else {
      // Official blocks first (reuse 2J curation), then shape/ids, then the protocol.
      const expanded = expandBlocks(parsed.value);
      v = expanded.errors.length ? { ok: false, errors: expanded.errors }
        : validatePlan(expanded.data, { workingWeights: payload.history?.workingWeights, daysPerWeek: payload.coachProfile?.daysPerWeek });
      if (v.ok) { const g = gatePlan(v.bundle, ctx); v = g.ok ? { ok: true, bundle: g.bundle } : { ok: false, errors: g.errors }; }
    }
    if (!v.ok) { track?.validationFailure(); return { ok: false, errors: v.errors, raw: r.text, errorClass: 'unusable' }; }
    if (v.nochange) return { ok: true, nochange: true, reading: v.reading };
    return { ok: true, ...(v.proposal ? { proposal: v.proposal } : { bundle: v.bundle }) };
  }

  let attempt = await once(null);
  for (let repairs = 0; !attempt.ok && !attempt.provider && repairs < MAX_REPAIRS; repairs++) {
    if (budgetCancelled(budget)) return { ok: false, errorClass: 'cancelled' };
    if (budgetExhausted(budget)) break;
    // Same rule as always: the model sees exactly which checks its answer failed, nothing else.
    aiLog('AI_REPAIR', { flow, job, round: repairs + 1, errors: attempt.errors?.length || 0 });
    onPhase?.('repairing');
    track?.repaired();
    attempt = await once({ previous: attempt.raw, errors: attempt.errors });
  }
  return attempt;
}
