// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The running Premium program as the rest of the server may read it: one compact summary (from the shared model that owns the method) and the structured
// facts an AI is allowed to see. Pure, no I/O, and deliberately free of any staff-trail module so the member's own AI payload can use it.
import { summarize } from './premium-model.js';

const clip = (s, n) => String(s ?? '').slice(0, n);

/** Compact summary of the running Premium program, or null. The state is the member's own; a malformed one reads as "no program", never as an error. */
export function premiumOf(S) {
  try { return S?.premium?.active ? summarize(S.premium.active, Array.isArray(S.workouts) ? S.workouts : []) : null; } catch { return null; }
}

/** The method the member follows, as structured facts (no name of the person, no workout JSON): context for an AI, never an order to change it. */
export const premiumFacts = p => ({
  program: clip(p.name, 60), programVersion: p.version, status: p.status, phase: p.phase ? clip(p.phase, 30) : null, cycle: p.cycle, week: p.week, weeks: p.weeks,
  session: p.session, progressInCycle: { done: p.completedInCycle, total: p.totalInCycle },
  methodState: p.methodState, adherence: p.adherence?.pct ?? null, lastAmrap: (p.lastAmrap || []).slice(-3), incidents: p.incidents,
});
