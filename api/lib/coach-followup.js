// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Coach & Seguimiento PRO V3 — the staff reading of ONE member, synthesised from data that already exists. Pure and deterministic: no I/O, no AI,
// nothing stored. It reuses the engines that own each fact (routine-review.js for cycles/plateau/program adherence, fatigue.js for accumulated fatigue,
// followup.js for the measurement schedule) and only adds what was missing: an explicit adherence definition, a triage with explained signals,
// the goal lens, and the compact facts the professional AI is allowed to see.
//
// Principles (docs/COACH_FOLLOWUP_V3.md): every signal carries the number that raised it; thresholds are INTERNAL HEURISTICS used to order a list for a
// human, never clinical statements (docs/COACH_FOLLOWUP_EVIDENCE.md); nothing here diagnoses, and nothing here changes a plan, a routine or a date.
import fs from 'node:fs';
import { routineReviews } from './routine-review.js';
import { fatigueState, deloadProposal, activeDeload } from './fatigue.js';
import { countsForProgression } from './workout-policy.js';
import { nextReview as measurementNext } from './followup.js';

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const day = iso => Date.parse(iso + 'T12:00:00Z');
const daysBetween = (a, b) => Math.round((day(b) - day(a)) / DAY);
const addDays = (iso, n) => new Date(day(iso) + n * DAY).toISOString().slice(0, 10);
const num = x => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const round5 = x => Math.round(x / 5) * 5;
const isWork = s => s && s.done && s.type !== 'warmup';
const clip = (s, n) => String(s ?? '').slice(0, n);

/* ---------------------------------------------------------------- thresholds (internal heuristics, one place) */
export const T = Object.freeze({
  ABSENCE_REVIEW: 14, ABSENCE_PRIORITY: 28,         // days since the last logged workout
  NEW_MEMBER_GRACE: 14,                             // a member younger than this is never flagged for having no workouts / low adherence
  ADHERENCE_REVIEW: 50, ADHERENCE_PRIORITY: 25,     // % of planned strength sessions in 28 days (only with ≥ 14 days of history and a known plan)
  ADHERENCE_MIN_PLANNED: 3,                         // never a percentage out of fewer than 3 planned sessions
  TREND_POINTS: 15,                                 // percentage points between the last 14 days and the 14 before
  PARTIAL_BELOW: 0.7,                               // a session with < 70 % of its planned working sets is "partial"
  REVIEW_OVERDUE_PRIORITY: 14,                      // a review left this many days
  CHECKIN_FATIGUE: 3, CHECKIN_DISCOMFORT: 3,        // occurrences in 14 days (same counts followup.js already uses)
  GOAL_DATE_NEAR: 14,
  BODY_MIN_READINGS: 3, BODY_MIN_SPAN: 21,          // weigh-ins needed before saying anything about the body-weight direction
  PERF_MIN_SESSIONS: 8,                             // sessions in 28 days before "no records" means something
});

/* ---------------------------------------------------------------- the words (English keys, translated by the app) */
export const SIGNAL_TEXT = Object.freeze({
  absence: ['No workouts in the last {0} days.', 'Get in touch and ask what is getting in the way.'],
  no_workouts_yet: ['Joined {0} days ago and has not logged a workout yet.', 'Check that the plan is clear and the first session is booked.'],
  adherence_low: ['Completed {0} of {1} planned sessions in the last 28 days.', 'Review weekly frequency and availability with the member.'],
  adherence_drop: ['Sessions per week fell from {0} to {1} over the last four weeks.', 'Ask whether the schedule or the load changed.'],
  missed_week: ['No planned session was completed in the last 7 days ({0} planned).', 'Check whether it was an exceptional week or the plan no longer fits.'],
  plateau: ['{0} of {1} exercises show no clear improvement in the current cycle.', 'Review progression, volume and exercise selection.'],
  review_due: ['{0} is due for review.', 'Open the review, check the evidence and decide what to adjust.'],
  review_overdue: ['{0} review is overdue by {1} days.', 'Open the review, check the evidence and decide what to adjust.'],
  measurement_review: ['Measurement review is overdue by {0} days.', 'Record the measurements and mark the review.'],
  checkin_fatigue: ['High fatigue reported {0} times in the last 14 days.', 'There are several fatigue signals; review recovery and load.'],
  checkin_discomfort: ['Discomfort in {0} reported {1} times in the last 14 days.', 'Ask about it and consider adapting the exercises involved.'],
  fatigue_trend: ['Several effort signals point the same way: accumulated fatigue is high.', 'Review recovery and load; a lighter week can be offered to the member.'],
  performance_drop: ['No new records in 28 days after {0} in the previous 28.', 'Look at recovery, sleep and load before changing the plan.'],
  goal_body: ['Body weight has not moved towards the target in {0} weeks ({1} readings).', 'Look at nutrition and activity context before changing the plan.'],
  goal_performance: ['No new records and no clear progression in 28 days, with {0} sessions.', 'Review progression and volume for the current goal.'],
  goal_date: ['The target date is in {0} days.', 'Check where the member stands against the goal.'],
  no_program: ['No routine or program is assigned.', 'Open the plan and assign or build a program.'],
  flagged: ['Marked for follow-up by staff.', 'Review the member and clear the mark when done.'],
  structure: ['{0} points in the plan structure to review.', 'Open the program and review the flagged structure.'],
});

/* ---------------------------------------------------------------- library: is this exercise cardio? */
let BP = null;
function bodyPart(id) {
  if (!BP) {
    BP = new Map();
    try { for (const e of JSON.parse(fs.readFileSync(new URL('../coach/library.json', import.meta.url), 'utf8')).exercises || []) BP.set(e.id, e.bp); } catch { /* an unreadable library only means "everything is strength" */ }
  }
  return BP.get(id) || null;
}
const entriesOf = w => (Array.isArray(w?.entries) ? w.entries : []).filter(e => e && typeof e === 'object');

/** 'cardio' when every exercise of the session is cardio (library body part, or a custom exercise tagged cardio, e.g. a saved clock session); otherwise 'strength'. */
export function sessionKind(w, S) {
  const custom = new Map((S?.customEx || []).map(e => [e?.id, e?.bp]));
  const es = entriesOf(w);
  return es.length && es.every(e => (custom.get(e.id) ?? bodyPart(e.id)) === 'cardio') ? 'cardio' : 'strength';
}

/* ---------------------------------------------------------------- adherence */
/** Planned sessions per week by kind, from the member's own weekly plan (S.week), or the first week of the active program when there is none. */
export function weeklyPlan(S) {
  const ids = Object.values(S?.week || {}).filter(Boolean);
  if (ids.length) {
    const custom = new Map((S?.customEx || []).map(e => [e?.id, e?.bp]));
    let strength = 0, other = 0;
    for (const id of ids) {
      const r = (S?.routines || []).find(x => x?.id === id);
      const ex = Array.isArray(r?.ex) ? r.ex : [];
      if (r && ex.length && ex.every(e => (custom.get(e?.id) ?? bodyPart(e?.id)) === 'cardio')) other++; else strength++;
    }
    return { strength, other, known: true };
  }
  const program = (S?.programs || []).find(p => p?.id === S?.activeProgramId && !['paused', 'abandoned', 'completed'].includes(p?.status));
  const first = Array.isArray(program?.weeks) ? program.weeks[0] : null;
  const n = Array.isArray(first?.sessions) ? first.sessions.length : 0;
  return n ? { strength: n, other: 0, known: true } : { strength: 0, other: 0, known: false };
}

function windowStats(S, workouts, plan, to, days, startRef) {
  const from = addDays(to, -(days - 1));
  const inWin = workouts.filter(w => w.d >= from && w.d <= to);
  const effDays = startRef ? Math.max(0, Math.min(days, daysBetween(startRef, to) + 1)) : days;
  let full = 0, partial = 0, cardio = 0, moved = 0, excluded = 0;
  for (const w of inWin) {
    if (w.rescheduledFrom) moved++;
    if (!countsForProgression(w)) excluded++;
    if (sessionKind(w, S) === 'cardio') { cardio++; continue; }
    const planned = entriesOf(w).reduce((n, e) => n + (num(e?.target?.sets) || 0), 0);
    const done = entriesOf(w).reduce((n, e) => n + (Array.isArray(e.sets) ? e.sets : []).filter(isWork).length, 0);
    if (planned >= 3 && done < planned * T.PARTIAL_BELOW) partial++; else full++;
  }
  const planned = plan.known && effDays >= 7 ? Math.round(plan.strength * effDays / 7) : null;
  const raw = planned >= T.ADHERENCE_MIN_PLANNED ? Math.min(1, (full + partial * 0.5) / planned) : null;
  return { days, from, to, planned, full, partial, cardio, moved, excluded, pct: raw == null ? null : round5(raw * 100), raw };
}

/** Planned vs done for 7 and 28 days plus the trend (last 14 days against the 14 before). `since` = the day the member's history can start (account creation). Never a percentage without a plan. */
export function adherence(S, today, since = null) {
  const workouts = (S?.workouts || []).filter(w => w && ISO.test(w.d || '') && w.d <= today);
  const firstWorkout = workouts.reduce((m, w) => (!m || w.d < m ? w.d : m), null);
  const startRef = [since, firstWorkout].filter(x => ISO.test(x || '')).sort()[0] || null;   // the earlier of the two: history can only be as old as the account or its first workout
  const plan = weeklyPlan(S);
  const d7 = windowStats(S, workouts, plan, today, 7, startRef);
  const d28 = windowStats(S, workouts, plan, today, 28, startRef);
  const last14 = windowStats(S, workouts, plan, today, 14, startRef);
  const prev14 = windowStats(S, workouts, plan, addDays(today, -14), 14, startRef);
  let trend = null;
  if (last14.raw != null && prev14.raw != null && startRef && daysBetween(startRef, today) >= 27) {
    const diff = (last14.raw - prev14.raw) * 100;
    trend = diff >= T.TREND_POINTS ? 'up' : diff <= -T.TREND_POINTS ? 'down' : 'flat';
  }
  const lastWorkout = workouts.reduce((m, w) => (!m || w.d > m ? w.d : m), null);
  const sessions = w => w.full + w.partial;
  return {
    plannedPerWeek: plan.known ? plan.strength : null, otherPerWeek: plan.known ? plan.other : null,
    d7: strip(d7), d28: strip(d28), trend,
    perWeek: { last: Math.round(sessions(last14) / 2 * 10) / 10, before: Math.round(sessions(prev14) / 2 * 10) / 10 },
    lastWorkout, daysSince: lastWorkout ? daysBetween(lastWorkout, today) : null,
    historyDays: startRef ? Math.max(0, daysBetween(startRef, today) + 1) : 0,
  };
}
const strip = ({ raw, ...w }) => w;

/* ---------------------------------------------------------------- progress */
export function progress(S, today, cycles) {
  const workouts = (S?.workouts || []).filter(w => w && ISO.test(w.d || '') && w.d <= today);
  const from28 = addDays(today, -27), from56 = addDays(today, -55);
  const prsIn = (a, b) => workouts.filter(w => w.d >= a && w.d <= b).reduce((n, w) => n + (Array.isArray(w.prs) ? w.prs.length : 0), 0);
  const live = (cycles || []).filter(c => c.status !== 'idle');
  const program = live.find(c => c.kind === 'program');
  const scope = program ? [program] : live;
  const evaluated = scope.map(c => c.progression).filter(Boolean);
  const status = evaluated.some(p => p.status === 'improving') ? 'improving' : evaluated.some(p => p.status === 'stable') ? 'stable' : 'insufficient';
  const plateaus = scope.map(c => c.plateau).filter(Boolean);
  const stalled = plateaus.reduce((n, p) => n + (p.stalled?.length || 0), 0);
  const evaluable = plateaus.reduce((n, p) => n + (p.evaluable || 0), 0);
  const w28 = workouts.filter(w => w.d >= from28);
  const bw = (Array.isArray(S?.bodyweight) ? S.bodyweight : []).filter(e => e && ISO.test(e.d || '') && num(e.w) != null && e.d >= from56 && e.d <= today).sort((a, b) => a.d.localeCompare(b.d));
  const body = bw.length >= 2 ? { n: bw.length, from: bw[0].d, to: bw[bw.length - 1].d, first: bw[0].w, last: bw[bw.length - 1].w, delta: Math.round((bw[bw.length - 1].w - bw[0].w) * 10) / 10, span: daysBetween(bw[0].d, bw[bw.length - 1].d) } : null;
  return {
    prs28: prsIn(from28, today), prsPrev28: prsIn(from56, addDays(today, -28)),
    progression: { status, improved: evaluated.reduce((n, p) => n + (p.improved || 0), 0), evaluated: evaluated.reduce((n, p) => n + (p.evaluated || 0), 0) },
    plateau: { clear: plateaus.some(p => p.clear), stalled, evaluable },
    sessions28: w28.filter(w => sessionKind(w, S) === 'strength').length, cardio28: w28.filter(w => sessionKind(w, S) === 'cardio').length,
    body,                                  // kept apart: body weight is context for the goal, never performance
    targetWeight: num(S?.targetW),
  };
}

/* ---------------------------------------------------------------- goal */
export const GOAL_KEYS = ['hypertrophy', 'toning', 'fatloss', 'power', 'plyometrics', 'longevity'];
const LENS = { fatloss: 'body', hypertrophy: 'performance', power: 'performance', plyometrics: 'performance', toning: 'performance', longevity: 'health' };
export const PRIORITIES = ['normal', 'high'];

/** The staff's own reading of the goal (additive, on the roster) when set; otherwise the member's. */
export function goalOf(S, f) {
  const g = f?.goalPlan;
  const own = typeof S?.coach?.profile?.goal === 'string' ? S.coach.profile.goal : null;
  const key = g?.primary || own;
  return {
    key: key && GOAL_KEYS.includes(key) ? key : null, raw: key || null, label: g?.label || null, targetDate: ISO.test(g?.targetDate || '') ? g.targetDate : null,
    priority: PRIORITIES.includes(g?.priority) ? g.priority : 'normal', source: g?.primary || g?.label || g?.targetDate ? 'staff' : own ? 'member' : null,
    lens: LENS[key] || null,
  };
}

/** Validates a staff goal edit; returns { value } or { error }. null clears one field. */
export function sanitizeGoal(body, prev) {
  const out = { ...(prev || {}) };
  if (Object.prototype.hasOwnProperty.call(body, 'primary')) {
    if (body.primary === null || body.primary === '') delete out.primary;
    else if (GOAL_KEYS.includes(body.primary)) out.primary = body.primary;
    else return { error: 'objetivo no válido' };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'label')) {
    const l = String(body.label ?? '').trim();
    if (l.length > 80) return { error: 'el objetivo admite hasta 80 caracteres' };
    if (l) out.label = l; else delete out.label;
  }
  if (Object.prototype.hasOwnProperty.call(body, 'targetDate')) {
    if (body.targetDate === null || body.targetDate === '') delete out.targetDate;
    else if (ISO.test(body.targetDate || '') && !Number.isNaN(day(body.targetDate))) out.targetDate = body.targetDate;
    else return { error: 'fecha objetivo no válida' };
  }
  if (Object.prototype.hasOwnProperty.call(body, 'priority')) {
    if (!PRIORITIES.includes(body.priority)) return { error: 'prioridad no válida' };
    out.priority = body.priority;
  }
  return Object.keys(out).length ? { value: out } : { value: undefined };
}

/* ---------------------------------------------------------------- signals + triage */
const createdDay = u => (typeof u?.created === 'string' && ISO.test(u.created.slice(0, 10)) ? u.created.slice(0, 10) : null);
const SEV = { info: 0, review: 1, priority: 2 };
const ORDER = ['absence', 'no_workouts_yet', 'review_overdue', 'measurement_review', 'checkin_discomfort', 'missed_week', 'adherence_low', 'adherence_drop', 'fatigue_trend',
  'checkin_fatigue', 'plateau', 'performance_drop', 'goal_body', 'goal_performance', 'review_due', 'structure', 'goal_date', 'no_program', 'flagged'];

function signal(id, severity, source, evidence, args = []) {
  const [explanation, suggestedAction] = SIGNAL_TEXT[id];
  return { id, severity, source, evidence, explanation, args, suggestedAction };
}

/**
 * All signals of one member, most important first. { S, u (roster entry), today, structure? } — `structure` = sanitized findings of the active plan (the
 * client computes them with analyzeRoutineStructure; the list view never has them). Each signal: { id, severity: 'review'|'priority'|'info', source, evidence,
 * explanation (English key), args, suggestedAction (English key) }.
 */
export function signalsFor({ S, u, today, structure = null }) {
  const f = u?.followUp || null;
  const out = [];
  const created = createdDay(u);
  const adh = adherence(S, today, created);
  const cycles = routineReviews(S || {}, today);
  const prog = progress(S, today, cycles);
  const goal = goalOf(S, f);
  const age = created ? daysBetween(created, today) : null;
  const young = age != null && age < T.NEW_MEMBER_GRACE;
  const hasPlan = (S?.routines || []).length > 0 || (S?.programs || []).length > 0;

  if (!adh.lastWorkout) {
    if (!young && age != null && hasPlan) out.push(signal('no_workouts_yet', age >= T.ABSENCE_PRIORITY ? 'priority' : 'review', 'workouts', { daysSinceJoined: age }, [age]));
  } else if (adh.daysSince >= T.ABSENCE_REVIEW) {
    out.push(signal('absence', adh.daysSince >= T.ABSENCE_PRIORITY ? 'priority' : 'review', 'workouts', { daysSince: adh.daysSince, lastWorkout: adh.lastWorkout }, [adh.daysSince]));
  }
  const settled = !young && adh.historyDays >= 14;
  const d28 = adh.d28, d7 = adh.d7;
  if (settled && adh.lastWorkout && d28.planned != null && d28.pct != null && d28.pct < T.ADHERENCE_REVIEW && !out.some(s => s.id === 'absence' && s.severity === 'priority')) {
    out.push(signal('adherence_low', d28.pct < T.ADHERENCE_PRIORITY ? 'priority' : 'review', 'adherence', { planned: d28.planned, done: d28.full + d28.partial, partial: d28.partial, pct: d28.pct }, [d28.full + d28.partial, d28.planned]));
  }
  if (settled && adh.trend === 'down' && (d28.pct == null || d28.pct < 75) && !out.some(s => s.id === 'adherence_low' || s.id === 'absence')) {
    out.push(signal('adherence_drop', 'review', 'adherence', { before: adh.perWeek.before, last: adh.perWeek.last }, [adh.perWeek.before, adh.perWeek.last]));
  }
  if (settled && adh.lastWorkout && d7.planned >= 2 && d7.full + d7.partial === 0 && adh.daysSince < T.ABSENCE_REVIEW) {
    out.push(signal('missed_week', 'review', 'adherence', { planned: d7.planned }, [d7.planned]));
  }
  // Review cycles (programs and standalone routines): the same statuses Program Review / Routine Review already compute.
  for (const c of cycles) {
    if (c.status === 'due' || c.status === 'overdue' || c.status === 'early') {
      const late = c.status === 'overdue' || c.late;
      const over = Math.max(0, daysBetween(c.dueDate, today));
      out.push(late || over > 0 ? signal('review_overdue', over >= T.REVIEW_OVERDUE_PRIORITY ? 'priority' : 'review', 'review', { kind: c.kind, name: clip(c.name, 60), status: c.status, daysOver: over, week: c.week }, [clip(c.name, 60), over])
        : signal('review_due', 'review', 'review', { kind: c.kind, name: clip(c.name, 60), status: c.status, week: c.week, early: !!c.early }, [clip(c.name, 60)]));
    }
  }
  if (f) {
    const next = measurementNext(f);
    if (next && next < today) { const over = daysBetween(next, today); out.push(signal('measurement_review', over >= T.REVIEW_OVERDUE_PRIORITY ? 'priority' : 'review', 'review', { daysOver: over }, [over])); }
  }
  if (prog.plateau.clear) out.push(signal('plateau', 'review', 'progression', { stalled: prog.plateau.stalled, evaluable: prog.plateau.evaluable }, [prog.plateau.stalled, prog.plateau.evaluable]));
  const fat = fatigueState(S || {}, today, { checkins: S?.shareCheckins === true });
  if (fat.level === 'high' && !activeDeload(S || {}, today)) out.push(signal('fatigue_trend', 'review', 'effort', { points: fat.points, signals: fat.signals.map(x => x.code), deloadProposed: !!deloadProposal(S || {}, today, { checkins: S?.shareCheckins === true }) }));
  if (prog.prsPrev28 >= 2 && prog.prs28 === 0 && prog.sessions28 >= T.PERF_MIN_SESSIONS) out.push(signal('performance_drop', 'review', 'progression', { prs28: prog.prs28, prsPrev28: prog.prsPrev28, sessions: prog.sessions28 }, [prog.prsPrev28]));
  // Check-ins: only what the member chose to share.
  if (S?.shareCheckins === true) {
    const rec = (S.checkins || []).filter(c => ISO.test(c?.d || '') && daysBetween(c.d, today) < 14 && c.d <= today);
    const hi = rec.filter(c => c.fatigue >= 4).length;
    if (hi >= T.CHECKIN_FATIGUE) out.push(signal('checkin_fatigue', 'review', 'checkin', { count: hi }, [hi]));
    const zones = {};
    for (const c of rec) if (c.pain) for (const z of c.zones || []) zones[z] = (zones[z] || 0) + 1;
    for (const [zone, n] of Object.entries(zones)) if (n >= T.CHECKIN_DISCOMFORT) out.push(signal('checkin_discomfort', 'priority', 'checkin', { zone, count: n }, [zone, n]));
  }
  // The goal decides how progress is read: body-weight direction for fat loss, records/progression for performance goals; health goals only look at adherence.
  if (!young && goal.lens === 'body' && prog.body && prog.body.n >= T.BODY_MIN_READINGS && prog.body.span >= T.BODY_MIN_SPAN && prog.targetWeight != null && prog.targetWeight < prog.body.last && prog.body.delta >= 0) {
    out.push(signal('goal_body', 'review', 'goal', { delta: prog.body.delta, span: prog.body.span, readings: prog.body.n }, [Math.floor(prog.body.span / 7), prog.body.n]));
  }
  if (!young && goal.lens === 'performance' && prog.sessions28 >= T.PERF_MIN_SESSIONS && prog.prs28 === 0 && prog.progression.status === 'stable' && !out.some(s => s.id === 'performance_drop')) {
    out.push(signal('goal_performance', 'review', 'goal', { sessions: prog.sessions28 }, [prog.sessions28]));
  }
  if (goal.targetDate) {
    const left = daysBetween(today, goal.targetDate);
    if (left >= 0 && left <= T.GOAL_DATE_NEAR) out.push(signal('goal_date', 'review', 'goal', { daysLeft: left }, [left]));
  }
  if (!hasPlan && !young && (adh.lastWorkout || (age != null && age >= 7))) out.push(signal('no_program', 'review', 'plan', {}));
  if (Array.isArray(structure) && structure.length) {
    const n = structure.filter(x => x.severity === 'importante' || x.severity === 'revisar').length;
    if (n) out.push(signal('structure', 'review', 'structure', { findings: n }, [n]));
  }
  if (f?.flag) out.push(signal('flagged', 'review', 'staff', { at: f.flag.at || null }));
  return out.sort((a, b) => SEV[b.severity] - SEV[a.severity] || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
}

export const LEVELS = ['normal', 'review', 'priority'];
export const levelOf = signals => (signals.some(s => s.severity === 'priority') ? 'priority' : signals.some(s => s.severity === 'review') ? 'review' : 'normal');

/** The earliest review date that matters (cycles that are not already closed, plus the measurement schedule). */
export function nextReviewOf(S, u, today, cycles = routineReviews(S || {}, today)) {
  const dates = cycles.filter(c => c.status !== 'idle' && c.dueDate).map(c => c.dueDate);
  const m = u?.followUp ? measurementNext(u.followUp) : null;
  if (m) dates.push(m);
  return dates.length ? dates.sort()[0] : null;
}

/* ---------------------------------------------------------------- list row (one member, compact) + counts */
export function overviewRow({ S, u, today }) {
  const signals = signalsFor({ S, u, today });
  const level = levelOf(signals);
  const adh = adherence(S, today, createdDay(u));
  const goal = goalOf(S, u?.followUp);
  const next = nextReviewOf(S, u, today);
  const reviewIn = next ? daysBetween(today, next) : null;
  return {
    id: u.id, name: u.name, avatar: u.avatar || null, level, goal: { key: goal.key, label: goal.label, priority: goal.priority, source: goal.source },
    signals: signals.filter(s => s.severity !== 'info').slice(0, 2).map(({ id, severity, explanation, args }) => ({ id, severity, explanation, args })),
    signalCount: signals.filter(s => s.severity !== 'info').length,
    adherence: { pct28: adh.d28.pct, done28: adh.d28.full + adh.d28.partial, planned28: adh.d28.planned, pct7: adh.d7.pct, done7: adh.d7.full + adh.d7.partial, planned7: adh.d7.planned, trend: adh.trend },
    lastWorkout: adh.lastWorkout, daysSince: adh.daysSince, nextReview: next, reviewIn,
    flagged: !!u?.followUp?.flag, followUpActive: !!u?.followUp,
  };
}

/** attention = priority/review level · upcoming = normal but a review within 7 days · stable = everything else. Order inside each bucket is by importance, then date, then name. */
export function bucketRows(rows) {
  const out = { attention: [], upcoming: [], stable: [] };
  for (const r of rows) (r.level !== 'normal' ? out.attention : r.reviewIn != null && r.reviewIn <= 7 ? out.upcoming : out.stable).push(r);
  const byName = (a, b) => String(a.name || '').localeCompare(String(b.name || ''));
  out.attention.sort((a, b) => LEVELS.indexOf(b.level) - LEVELS.indexOf(a.level) || (b.goal.priority === 'high') - (a.goal.priority === 'high') || b.signalCount - a.signalCount || byName(a, b));
  out.upcoming.sort((a, b) => a.reviewIn - b.reviewIn || byName(a, b));
  out.stable.sort(byName);
  return { ...out, counts: { attention: out.attention.length, upcoming: out.upcoming.length, stable: out.stable.length } };
}

/* ---------------------------------------------------------------- the member sheet */
export function memberView({ S, u, today, structure = null }) {
  const cycles = routineReviews(S || {}, today);
  const signals = signalsFor({ S, u, today, structure });
  const created = createdDay(u);
  const adh = adherence(S, today, created);
  const prog = progress(S, today, cycles);
  const goal = goalOf(S, u?.followUp);
  const f = u?.followUp || null;
  const next = nextReviewOf(S, u, today, cycles);
  const fat = fatigueState(S || {}, today, { checkins: S?.shareCheckins === true });
  const shared = S?.shareCheckins === true;
  const rec = shared ? (S.checkins || []).filter(c => ISO.test(c?.d || '') && daysBetween(c.d, today) < 14 && c.d <= today) : [];
  const avg = k => { const v = rec.map(c => c[k]).filter(Number.isFinite); return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length * 10) / 10 : null; };
  const zones = {};
  for (const c of rec) if (c.pain) for (const z of c.zones || []) zones[z] = (zones[z] || 0) + 1;
  return {
    today, level: levelOf(signals), signals, goal, adherence: adh, progress: prog,
    review: { next, reviewIn: next ? daysBetween(today, next) : null, cycles: cycles.filter(c => c.status !== 'idle'), measurement: f ? { next: measurementNext(f), last: f.reviews?.length ? f.reviews[f.reviews.length - 1].d : null } : null },
    fatigue: { level: fat.level, points: fat.points, signals: fat.signals.map(x => x.code) },
    checkin: shared ? { shared: true, count: rec.length, avg: { energy: avg('energy'), sleep: avg('sleep'), fatigue: avg('fatigue') }, highFatigue14: rec.filter(c => c.fatigue >= 4).length, pain14: Object.entries(zones).map(([zone, n]) => ({ zone, n })).sort((a, b) => b.n - a.n) } : { shared: false },
    hasPlan: (S?.routines || []).length > 0 || (S?.programs || []).length > 0,
    created, joinedDays: created ? daysBetween(created, today) : null,
    analysis: analysisFrom({ signals, adh, prog, goal }),
  };
}

/* ---------------------------------------------------------------- HECHO / INFERENCIA / SUGERENCIA (deterministic, always available; the AI only rewrites it) */
export function analysisFrom({ signals, adh, prog, goal }) {
  const facts = [];
  if (adh.d28.planned != null) facts.push({ id: 'f_adherence', text: 'Completed {0} of {1} planned sessions in the last 28 days.', args: [adh.d28.full + adh.d28.partial, adh.d28.planned] });
  else if (adh.d28.full + adh.d28.partial) facts.push({ id: 'f_sessions', text: 'Logged {0} sessions in the last 28 days.', args: [adh.d28.full + adh.d28.partial] });
  if (adh.lastWorkout) facts.push({ id: 'f_last', text: 'Last workout was {0} days ago.', args: [adh.daysSince] });
  facts.push({ id: 'f_prs', text: '{0} new records in the last 28 days.', args: [prog.prs28] });
  const inference = signals.filter(s => s.severity !== 'info').map(s => ({ id: 'i_' + s.id, text: s.explanation, args: s.args }));
  const suggestion = [...new Map(signals.filter(s => s.severity !== 'info').map(s => [s.suggestedAction, { id: 's_' + s.id, text: s.suggestedAction, args: [] }])).values()].slice(0, 3);
  return { facts: facts.slice(0, 4), inference: inference.slice(0, 4), suggestion, goal: goal.key || null };
}

/* ---------------------------------------------------------------- the professional AI: compact facts, hard size limit */
export const AI_PAYLOAD_MAX = 6000;     // characters of JSON sent to the provider, never the raw state
export const SEV_LABEL = { review: 'review', priority: 'priority' };
const cleanStructure = list => (Array.isArray(list) ? list : []).slice(0, 8)
  .filter(x => x && typeof x === 'object' && ['importante', 'revisar', 'info'].includes(x.severity))
  .map(x => ({ id: clip(x.id, 80), category: clip(x.category, 30), severity: x.severity }));
export { cleanStructure };

/**
 * Facts for the professional AI. Built from the sheet — never from raw state: no name, no id, no notes of any kind (staff notes stay out of every AI by policy),
 * no workout JSON, no catalogue. Check-in numbers only when the member shared them. Trimmed field by field until it fits AI_PAYLOAD_MAX.
 */
export function aiFacts(view, { structure = null, recent = [] } = {}) {
  const a = view.adherence, p = view.progress;
  const facts = {
    v: 1, today: view.today,
    goal: { key: view.goal.key, label: view.goal.label ? clip(view.goal.label, 80) : null, targetDate: view.goal.targetDate, priority: view.goal.priority },
    adherence: { plannedPerWeek: a.plannedPerWeek, d7: slim(a.d7), d28: slim(a.d28), trend: a.trend, perWeek: a.perWeek, daysSince: a.daysSince },
    progress: { prs28: p.prs28, prsPrev28: p.prsPrev28, progression: p.progression, plateau: p.plateau, sessions28: p.sessions28, cardio28: p.cardio28 },
    body: p.body && view.goal.lens === 'body' ? { delta: p.body.delta, span: p.body.span, n: p.body.n, toTarget: p.targetWeight != null ? Math.round((p.body.last - p.targetWeight) * 10) / 10 : null } : null,
    fatigue: view.fatigue,
    review: { next: view.review.next, pending: view.review.cycles.filter(c => ['due', 'overdue', 'early'].includes(c.status)).slice(0, 3).map(c => ({ kind: c.kind, status: c.status, week: c.week, days: c.days, reasons: (c.reasons || []).slice(0, 4).map(r => r.code) })) },
    signals: view.signals.filter(s => s.severity !== 'info').slice(0, 6).map(s => ({ id: s.id, severity: s.severity, source: s.source, evidence: s.evidence })),
    structure: cleanStructure(structure),
    checkin: view.checkin.shared ? { avg: view.checkin.avg, highFatigue14: view.checkin.highFatigue14, pain14: view.checkin.pain14.slice(0, 3) } : null,
    recent: recent.slice(0, 5).map(e => ({ kind: clip(e.kind, 30), d: clip(e.d, 10) })),
  };
  const size = () => JSON.stringify(facts).length;
  for (const drop of ['recent', 'structure', 'checkin', 'body']) if (size() > AI_PAYLOAD_MAX) facts[drop] = drop === 'recent' || drop === 'structure' ? [] : null;
  while (size() > AI_PAYLOAD_MAX && facts.signals.length > 2) facts.signals.pop();
  return facts;
}
const slim = ({ planned, full, partial, cardio, moved, excluded, pct }) => ({ planned, full, partial, cardio, moved, excluded, pct });

/* ---------------------------------------------------------------- AI answer: shape + safety, else the caller falls back to analysisFrom() */
export const AI_TAGS = ['fact', 'inference', 'suggestion'];
export const AI_ACTIONS = ['open_program', 'create_proposal', 'add_note', 'review_date'];
const FORBIDDEN = /diagnos|sobreentren|overtrain|injur|lesi[oó]n|enfermedad|disease|patolog|trastorno|disorder|medicaci|medicat|\bcure\b|\bcura\b/i;
const line = x => (typeof x === 'string' && x.trim() && x.length <= 240 && !FORBIDDEN.test(x) ? x.trim() : null);
const tagged = (list, max) => {
  const out = [];
  for (const x of Array.isArray(list) ? list : []) {
    const text = line(x?.text), tag = x?.tag;
    if (text && AI_TAGS.includes(tag)) out.push({ tag, text });
    if (out.length >= max) break;
  }
  return out;
};
/** { ok, value } with at most 3 summary lines, 3–5 key data, ≤ 3 review points and concrete proposals; anything outside the shape (or with medical wording) is refused. */
export function validateAiAnswer(raw) {
  if (!raw || typeof raw !== 'object' || raw.coach_followup !== 1) return { ok: false, error: 'formato no válido' };
  const summary = (Array.isArray(raw.summary) ? raw.summary : []).map(line).filter(Boolean).slice(0, 3);
  const keyData = tagged(raw.keyData, 5);
  const review = tagged(raw.review, 3);
  const proposal = [];
  for (const x of Array.isArray(raw.proposal) ? raw.proposal : []) {
    const text = line(x?.text);
    if (text && AI_ACTIONS.includes(x?.action)) proposal.push({ action: x.action, tag: 'suggestion', text });
    if (proposal.length >= 3) break;
  }
  if (!summary.length || keyData.length < 3) return { ok: false, error: 'respuesta incompleta' };
  if (raw.apply || raw.changes || raw.plan) return { ok: false, error: 'la IA no puede proponer cambios aplicables' };
  return { ok: true, value: { summary, keyData, review, proposal } };
}
