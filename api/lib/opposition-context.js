// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// The running Oposiciones plan as the rest of the server may read it: one compact summary (from the shared model that owns the method) and the structured
// facts an AI is allowed to see. Pure, no I/O. A malformed state reads as "no plan", never as an error.
import { summarizePlan } from './opposition-model.js';
import { adherenceOf } from './premium-model.js';

const clip = (s, n) => String(s ?? '').slice(0, n);

/** Plan-level adherence: the finished blocks (kept in the plan) plus the block under way (from the Premium instance that runs it). null while nothing was due yet. */
export function planAdherence(S, now = Date.now()) {
  const plan = S?.opposition?.plan;
  if (!plan) return null;
  let done = 0, expected = 0;
  for (const b of plan.blocks || []) { done += Number(b.completed) || 0; expected += Number(b.planned) || 0; }
  const inst = S?.premium?.active;
  if (inst && String(inst.programId || '').startsWith('opposition-' + plan.id)) {
    const a = adherenceOf(inst, Array.isArray(S.workouts) ? S.workouts : [], now);
    done += a.done; expected += a.expected;
  }
  return expected > 0 ? Math.min(100, Math.round(done * 100 / expected)) : null;
}

/** Compact summary of the member's plan, or null. */
export function oppositionOf(S, now = Date.now()) {
  try {
    const plan = S?.opposition?.plan;
    if (!plan || plan.status === 'finished') return null;
    return summarizePlan(plan, { adherence: planAdherence(S, now), now });
  } catch { return null; }
}

/** What an AI may see: the plan's facts and the official thresholds that apply, never a name, a birth date, the sex or age, or any free text the member typed. */
export const oppositionFacts = o => ({
  oppositionId: clip(o.oppositionId, 60), oppositionName: clip(o.name, 120), oppositionVersion: o.oppositionVersion, sourceDate: o.sourceDate,
  examDate: o.examDate, monthsPlan: o.monthsPlan, weeksLeft: o.weeksLeft, phase: o.phase, week: o.calendarWeek, weeksTotal: o.weeksTotal, block: o.block, ambition: o.ambition,
  levelGlobal: o.levelGlobal, levelEstimated: o.levelEstimated, levelByCapacity: o.levelByCapacity,
  testResults: o.testResults, weakPoints: (o.weakPoints || []).slice(0, 6), officialThresholds: o.officialThresholds,
  testStatus: Object.fromEntries((o.tests || []).filter(t => t.status).map(t => [t.id, t.status])),
  missingData: (o.missingData || []).slice(0, 10), adherence: o.adherence, alerts: (o.alerts || []).slice(0, 3), restrictionAreas: (o.restrictions || []).slice(0, 6),
});
