// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Seguimiento V2 — staff follow-up of one member: which readings an assessment collects, how
// often it is reviewed, and a deterministic "since the last review" summary with factual alerts.
//
// Access model (no new permissions): only staff with the existing admin role — the same people
// GET /api/admin/user already shows the full workout history, weigh-ins and measurements to.
// The plain trainer role has no member-health access today and there is no trainer↔member
// relation to scope one to, so it gets none here either. Check-ins are new, member-authored
// wellbeing data: they enter the summary only when the member turned on S.shareCheckins.
//
import { pendingReviews } from './routine-review.js';
import { fatigueState, deloadProposal, activeDeload } from './fatigue.js';

// Everything here is counts, dates and differences. No scores, no labels, no diagnosis.

export const MEASURE_KEYS = ['neck', 'shoulders', 'chest', 'bicepsL', 'bicepsR', 'forearmL', 'forearmR', 'waist', 'hips',
  'thighL', 'thighR', 'calfL', 'calfR', 'bodyFat', 'muscleMass', 'waterPct', 'visceralFat', 'boneMass',
  'segFatArmL', 'segFatArmR', 'segFatLegL', 'segFatLegR', 'segFatTrunk',
  'segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR', 'segMuscleTrunk',
  'skinTriceps', 'skinSubscapular', 'skinSuprailiac', 'skinAbdominal'];

const BASIC = ['waist'];
const INTERMEDIATE = [...BASIC, 'hips', 'chest', 'bicepsL', 'bicepsR', 'thighL', 'thighR', 'bodyFat'];
const PRO = [...INTERMEDIATE, 'muscleMass', 'visceralFat', 'waterPct',
  'segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR', 'segMuscleTrunk',
  'skinTriceps', 'skinSubscapular', 'skinSuprailiac', 'skinAbdominal'];
// Weight is part of every template; it lives in S.bodyweight, not S.measurements.
export const TEMPLATES = { basic: BASIC, intermediate: INTERMEDIATE, pro: PRO };
export const CADENCES = { weekly: 7, biweekly: 14, monthly: 30 };

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const daysBetween = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / DAY);
const addDays = (iso, n) => new Date(Date.parse(iso + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);

// Validates a staff edit into the stored shape; returns { error } on bad input.
export function sanitizeFollowUp(body, prev, today) {
  const template = String(body.template || '');
  if (!TEMPLATES[template] && template !== 'custom') return { error: 'plantilla no válida' };
  let keys;
  if (template === 'custom') {
    keys = [...new Set((Array.isArray(body.keys) ? body.keys : []).filter(k => MEASURE_KEYS.includes(k)))];
  }
  const cadence = String(body.cadence || '');
  let days = CADENCES[cadence];
  if (cadence === 'custom') {
    days = Math.round(Number(body.days));
    if (!Number.isFinite(days) || days < 3 || days > 120) return { error: 'la frecuencia personalizada va de 3 a 120 días' };
  }
  if (!days) return { error: 'frecuencia no válida' };
  const startedAt = ISO.test(body.startedAt || '') ? body.startedAt : prev?.startedAt || today;
  const out = { template, cadence, days, startedAt, reviews: prev?.reviews || [] };
  // The encrypted private staff note is intentionally opaque to this config sanitizer. A
  // template/cadence edit must preserve it without ever copying plaintext into the roster.
  if (typeof prev?.privateNotesEncrypted === 'string') out.privateNotesEncrypted = prev.privateNotesEncrypted;
  if (keys) out.keys = keys;
  return { value: out };
}

export const templateKeys = f => (f?.template === 'custom' ? f.keys || [] : TEMPLATES[f?.template] || []);
export const lastReview = f => (f?.reviews?.length ? f.reviews[f.reviews.length - 1].d : null);
export const nextReview = f => (f ? addDays(lastReview(f) || f.startedAt, f.days) : null);

// Recording a review is idempotent per day and never touches the member's own state.
export function addReview(f, today, by) {
  const reviews = (f.reviews || []).filter(r => r.d !== today);
  reviews.push({ d: today, by });
  return { ...f, reviews: reviews.slice(-100) };
}

// Latest value at or before `iso`, and the latest overall, of a {d, v} series.
function atOrBefore(list, iso) {
  let best = null;
  for (const e of list || []) if (e.d <= iso && (!best || e.d >= best.d)) best = e;
  return best;
}
function latest(list) {
  let best = null;
  for (const e of list || []) if (!best || e.d > best.d || (e.d === best.d && (e.t || 0) >= (best.t || 0))) best = e;
  return best;
}
function change(list, from, val = e => e.v) {
  const end = latest(list);
  if (!end) return null;
  const start = atOrBefore(list, from);
  const r = { end: val(end), endDate: end.d };
  if (start && start.d !== end.d) { r.start = val(start); r.startDate = start.d; r.delta = Math.round((r.end - r.start) * 10) / 10; }
  return r;
}

function checkinStats(checkins, from, today) {
  const window = (checkins || []).filter(c => c.d > from && c.d <= today);
  const avg = k => {
    const v = window.map(c => c[k]).filter(Number.isFinite);
    return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null;
  };
  const recent = (checkins || []).filter(c => daysBetween(c.d, today) < 14 && c.d <= today);
  const zones = {};
  for (const c of recent) if (c.pain) for (const z of c.zones || []) zones[z] = (zones[z] || 0) + 1;
  return {
    count: window.length,
    avg: { energy: avg('energy'), sleep: avg('sleep'), fatigue: avg('fatigue') },
    highFatigue14: recent.filter(c => c.fatigue >= 4).length,
    pain14: Object.entries(zones).map(([zone, n]) => ({ zone, n })).sort((a, b) => b.n - a.n),
  };
}

// The trainer-facing summary. `S` is the member's decrypted state; `f` the follow-up (or null).
export function followUpSummary(S, f, today) {
  const from = lastReview(f) || f?.startedAt || addDays(today, -30);
  const workouts = (S.workouts || []).filter(w => w && ISO.test(w.d || '') && w.d > from && w.d <= today);
  const span = Math.max(1, daysBetween(from, today));
  const planned = Object.values(S.week || {}).filter(Boolean).length;
  const measurements = {};
  for (const k of f ? templateKeys(f) : []) {
    const c = change(S.measurements?.[k], from);
    measurements[k] = c;
  }
  const lastWorkout = (S.workouts || []).reduce((m, w) => (w?.d && (!m || w.d > m) ? w.d : m), null);
  const summary = {
    from, today, days: span,
    objective: typeof S.coach?.profile?.goal === 'string' ? S.coach.profile.goal.slice(0, 80) : null,
    workouts: workouts.length,
    perWeek: Math.round(workouts.length / span * 7 * 10) / 10,
    plannedPerWeek: planned || null,
    prs: workouts.reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0),
    lastWorkout,
    weight: change(S.bodyweight, from, e => e.w),
    measurements,
    checkinsShared: S.shareCheckins === true,
    checkins: S.shareCheckins === true ? checkinStats(S.checkins, from, today) : null,
    nextReview: nextReview(f),
    // Routine review loop (lib/routine-review.js): routines whose review is due, or advanced by a clear plateau. Derived from the member's own workouts.
    // Accumulated fatigue from the member's own logged effort (lib/fatigue.js): a trend over several sessions, never one bad day. Only the level and the numbers.
    fatigue: fatigueSummary(S, today),
    routineReviews: pendingReviews(S, today).slice(0, 3).map(r => ({ kind: r.kind || 'routine', routineId: r.routineId || null, programId: r.programId || null, name: r.name, week: r.week, days: r.days, early: r.early, late: r.late, reasons: r.reasons, adherence: r.adherence || null, plateau: r.plateau || null })),
  };
  return { summary, alerts: followUpAlerts(summary, f) };
}

function fatigueSummary(S, today) {
  const ctx = { checkins: S.shareCheckins === true };       // check-ins only when the member chose to share them
  const f = fatigueState(S, today, ctx);
  const dl = activeDeload(S, today);
  return { level: f.level, points: f.points, signals: f.signals.map(x => ({ code: x.code, n: x.n ?? null, hours: x.hours ?? null, pct: x.pct ?? null })),
    proposed: !!deloadProposal(S, today, ctx), deloadActive: dl ? { from: dl.from, until: dl.until } : null };
}

// Facts that may deserve a look, each with the number behind it. Never a diagnosis.
export function followUpAlerts(s, f) {
  const out = [];
  if (f && s.nextReview && s.nextReview < s.today) out.push({ code: 'review_overdue', days: daysBetween(s.nextReview, s.today) });
  if (!s.lastWorkout) out.push({ code: 'no_workouts_yet' });
  else if (daysBetween(s.lastWorkout, s.today) >= 14) out.push({ code: 'no_recent_workouts', days: daysBetween(s.lastWorkout, s.today) });
  if (s.fatigue?.level === 'high' && !s.fatigue.deloadActive) out.push({ code: 'fatigue_high', points: s.fatigue.points, signals: s.fatigue.signals, proposed: s.fatigue.proposed });
  for (const r of s.routineReviews || []) out.push({ code: 'routine_review', kind: r.kind || 'routine', routineId: r.routineId || null, programId: r.programId || null, name: r.name, week: r.week, early: r.early, late: r.late, reasons: r.reasons, adherence: r.adherence || null, plateau: r.plateau || null });
  if (s.checkins) {
    if (s.checkins.highFatigue14 >= 3) out.push({ code: 'high_fatigue', n: s.checkins.highFatigue14 });
    for (const p of s.checkins.pain14) if (p.n >= 3) out.push({ code: 'repeated_discomfort', zone: p.zone, n: p.n });
  }
  return out;
}
