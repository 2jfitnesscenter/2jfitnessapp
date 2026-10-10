// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* The exercises the model gets to choose from — a deterministic, compact candidate list instead of
 * the whole catalogue.
 *
 * The Library stays the authority: every row is [id, name, movement, equipment, muscleGroup, flags]
 * read from it, never classified here and never re-derived by the model. What this module decides is
 * only WHICH rows travel: for every movement the plan can need, the best few (Recommended 2J first),
 * with one option per kind of equipment so a swap always has an alternative, and every muscle group
 * covered. The ids the model returns are still checked against the full library by validate.js, so a
 * smaller list can never let an invalid id through — it only keeps 1,300 names out of every request.
 *
 * Same input, same output: ranking is the pool's own order (Recommended first, gym-compatible first),
 * ties never depend on object key order.
 */
import { classify } from '../lib/protocol/classify.js';
import { RESTRICTION_FLAG } from '../lib/protocol/rules.js';

export const COLUMNS = ['id', 'name', 'movement', 'equipment', 'muscleGroup', 'flags'];   // flags: R = Recommended 2J, C = the member's own custom exercise
const MUSCLE_GROUPS = ['chest', 'back', 'trapezius', 'deltoids', 'biceps', 'triceps', 'forearm', 'abs', 'gluteal', 'quadriceps', 'hamstring', 'calves'];
const RESISTANCE = new Set(['squat', 'lunge', 'hinge', 'hip_thrust', 'hip_extension', 'hip_abduction', 'hip_adduction', 'knee_extension', 'knee_flexion', 'calf_raise',
  'horizontal_push', 'chest_fly', 'dip', 'vertical_push', 'lateral_raise', 'front_raise', 'elbow_extension', 'horizontal_pull', 'vertical_pull', 'pullover', 'rear_delt',
  'shrug', 'elbow_flexion', 'wrist', 'shoulder_rotation', 'core_anti_extension', 'core_flexion', 'core_rotation', 'core_lateral']);
const COMPOUND = new Set(['squat', 'lunge', 'hinge', 'hip_thrust', 'horizontal_push', 'vertical_push', 'horizontal_pull', 'vertical_pull']);
const NON_RESISTANCE = ['mobility', 'conditioning', 'cardio', 'olympic', 'jump', 'carry'];

export const LIMITS = {
  perMovement: 5,         // candidates per resistance movement (a 2-day plan asks for fewer, a 5-day plan for more)
  perGroupMin: 6,         // every muscle group keeps at least this many (when the pool has them)
  perNonResistance: 3,    // mobility, conditioning, cardio, olympic, jump, carry — unless the goal asks for them
  totalMin: 60,           // below this the slice widens on its own
  smallPool: 80,          // a pool this small is sent whole: there is nothing to save
};

/** How many candidates each movement gets, from the protocol goal, the days per week and what the plan already uses. */
function quotas({ goal = 'general', daysPerWeek = null, planMovements = new Set() }) {
  const base = daysPerWeek && daysPerWeek <= 2 ? LIMITS.perMovement - 1 : daysPerWeek && daysPerWeek >= 5 ? LIMITS.perMovement + 1 : LIMITS.perMovement;
  const q = new Map();
  for (const m of RESISTANCE) q.set(m, COMPOUND.has(m) && ['strength', 'power', 'hypertrophy'].includes(goal) ? base + 2 : base);
  for (const m of NON_RESISTANCE) q.set(m, LIMITS.perNonResistance);
  if (goal === 'endurance') { q.set('cardio', 8); q.set('conditioning', 8); q.set('mobility', 4) }
  if (goal === 'power') { q.set('olympic', 6); q.set('jump', 6) }
  if (goal === 'general' || goal === 'beginner') { q.set('mobility', 5); q.set('cardio', 5); q.set('conditioning', 4); q.set('carry', 3) }
  for (const m of planMovements) q.set(m, (q.get(m) || LIMITS.perNonResistance) + 4);          // a review needs alternatives for what the plan already uses
  return q;
}

const violates = (e, restrictions) => {
  if (!restrictions.length) return false;
  const flags = classify(e.id, id => (id === e.id ? e : null)).flags || [];
  return restrictions.some(r => flags.includes(RESTRICTION_FLAG[r]));
};

/**
 * @param {Array} pool       the visible library already ranked (Recommended first, gym-compatible first) plus the member's customs
 * @param {object} ctx       { goal, daysPerWeek, restrictions[], priorityGroups[] (muscle-group keys), planIds[], equipmentOf(e), gym: string[]|null }
 * @returns {{ columns, rows, meta }}  meta: { pool, sent, strategy, widened, uncovered }
 */
export function compactLibrary(pool, ctx = {}) {
  const restrictions = (ctx.restrictions || []).filter(r => RESTRICTION_FLAG[r]);
  const equipmentOf = ctx.equipmentOf || (e => e.eq || '');
  const planIds = new Set(ctx.planIds || []);
  const eligible = pool.filter(e => e.custom || planIds.has(e.id) || (!violates(e, restrictions) && (!ctx.gym || ctx.gym.includes(equipmentOf(e)))));
  const row = e => [e.id, e.n, e.mv || '', e.eq || '', e.muscleGroup || '', (e.rec ? 'R' : '') + (e.custom ? 'C' : '')];
  const finish = (picked, strategy, widened = false) => {
    const order = new Map(eligible.map((e, i) => [e.id, i]));
    const rows = [...picked].sort((a, b) => order.get(a.id) - order.get(b.id)).map(row);
    const have = new Set(rows.map(r => r[4]));
    return { columns: COLUMNS, rows, meta: { pool: pool.length, eligible: eligible.length, sent: rows.length, strategy, widened, uncovered: MUSCLE_GROUPS.filter(g => !have.has(g) && eligible.some(e => e.muscleGroup === g)) } };
  };
  if (eligible.length <= LIMITS.smallPool) return finish(eligible, 'whole-small-pool');

  const byId = new Map(eligible.map(e => [e.id, e]));
  const planMovements = new Set([...planIds].map(id => byId.get(id)?.mv).filter(Boolean));
  const priority = new Set(ctx.priorityGroups || []);
  const picked = new Map();
  const take = e => { if (e && !picked.has(e.id)) picked.set(e.id, e) };
  for (const e of eligible) if (e.custom || planIds.has(e.id)) take(e);                         // never drop what the member or the plan already uses

  const build = extra => {
    const q = quotas({ goal: ctx.goal, daysPerWeek: ctx.daysPerWeek, planMovements });
    const byMovement = new Map();
    for (const e of eligible) { if (e.custom) continue; const m = e.mv || ''; if (!byMovement.has(m)) byMovement.set(m, []); byMovement.get(m).push(e) }
    for (const [m, list] of [...byMovement].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (!m) continue;
      const want = (q.get(m) ?? LIMITS.perNonResistance) + extra;
      let got = list.filter(e => picked.has(e.id)).length;
      // one option per kind of equipment first (best ranked of each), so a swap always has an alternative
      const seen = new Set(list.filter(e => picked.has(e.id)).map(e => e.eq));
      for (const e of list) { if (got >= want) break; if (!seen.has(e.eq) && !picked.has(e.id)) { take(e); seen.add(e.eq); got++ } }
      for (const e of list) { if (got >= want) break; if (!picked.has(e.id)) { take(e); got++ } }
    }
    for (const g of MUSCLE_GROUPS) {                                                              // every muscle group stays reachable
      const min = (priority.has(g) ? LIMITS.perGroupMin * 2 : LIMITS.perGroupMin) + extra;
      let got = [...picked.values()].filter(e => e.muscleGroup === g).length;
      for (const e of eligible) { if (got >= min) break; if (e.muscleGroup === g && !picked.has(e.id)) { take(e); got++ } }
    }
  };
  build(0);
  let widened = false;
  for (let extra = 1; picked.size < LIMITS.totalMin && picked.size < eligible.length && extra <= 40; extra++) { build(extra); widened = true }
  return finish([...picked.values()], 'coverage', widened);
}
