/* The 2J protocol between a model's answer and anyone's plan.
 *
 * validate.js already guarantees shape, ids and the closed list of change types. This file adds
 * the methodology: the model receives the relevant protocol rules and the compatible official
 * blocks (reuse 2J's curation before inventing), and whatever it returns must pass
 * validateAgainst2JProtocol. A FAIL goes back to the model for the one repair round with the
 * concrete failures; a second FAIL fails the job — nothing FAIL is ever shown as a proposal,
 * let alone saved. PASS_WITH_REASON travels with the bundle so the review screen can show why.
 *
 * Authority (docs/TRAINING_PROTOCOL_2J.md): explicit restrictions > safety > protocol >
 * existing program > official library > the model. The model is the last layer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { validateAgainst2JProtocol, failuresForRepair, compactProtocol, instantiateBlock, RESTRICTIONS, LEVELS, PROTOCOL_VERSION } from '../lib/protocol/index.js';
import * as blocks from '../lib/blocks-store.js';

// Coach intake goals → protocol goals. "Fat loss" is not a muscle group or a circuit mandate:
// strength training keeps its job (2J-RULE-FATLOSS), so it maps to general.
export const GOAL_MAP = {
  hypertrophy: 'hypertrophy', strength: 'strength', toning: 'general', fatloss: 'general', longevity: 'general',
  padel: 'general', basketball: 'general', examfitness: 'general', power: 'power', plyometrics: 'power',
  general: 'general', endurance: 'endurance', beginner: 'beginner',
};

/** Goal, level, explicit restrictions and equipment for one request. */
export function protocolContext(S, profile, unavailableEq = []) {
  const p = profile || {};
  const goal = GOAL_MAP[p.goal] || 'general';
  // The level is the one declared (trainer brief or the member's own setting); experience
  // "new"/"returning" means beginner handling. Never re-rated from weights lifted.
  let level = LEVELS.includes(p.level) ? p.level
    : (p.experience === 'new' || p.experience === 'returning') ? 'beginner'
    : LEVELS.includes(S?.trainingLevel) ? S.trainingLevel : 'intermediate';
  const restrictions = (Array.isArray(p.restrictions) ? p.restrictions : []).filter(r => RESTRICTIONS.includes(r));
  return { goal, level, restrictions, unavailableEq };
}

/** What the model receives: the relevant rules only, plus official blocks it can reuse. */
export function protocolPayload(ctx, focus = []) {
  return {
    ...compactProtocol(ctx.goal, ctx.level),
    restrictions: ctx.restrictions,
    officialBlocks: blocks.compatibleOfficial({ goal: ctx.goal, level: ctx.level, focus, unavailableEq: ctx.unavailableEq }),
  };
}

/**
 * Expand `routine.blocks: ["off-…"]` into copied entries (snapshot), before validatePlan.
 * Returns { data, errors }. Unknown or inactive ids are errors for the repair round.
 */
export function expandBlocks(data) {
  const errors = [];
  if (!data || !Array.isArray(data.routines)) return { data, errors };
  const routines = data.routines.map((r, ri) => {
    if (!r || !Array.isArray(r.blocks) || !r.blocks.length) return r;
    const metas = [], ex = [];
    for (const id of r.blocks.slice(0, 4)) {
      const b = typeof id === 'string' ? blocks.find(id) : null;
      if (!b || !b.official || b.active === false) { errors.push(`routines[${ri}].blocks: "${id}" is not an active official block id from payload.protocol.officialBlocks`); continue; }
      const inst = instantiateBlock(b);
      metas.push(inst.meta);
      ex.push(...inst.ex);
    }
    return { ...r, ex: [...ex, ...(Array.isArray(r.ex) ? r.ex : [])], _blockMeta: metas };
  });
  return { data: { ...data, routines }, errors };
}

/** Validate a created plan as a whole program (the week, in order). */
const typesOf = routines => Object.fromEntries((routines || []).flatMap(r => (Array.isArray(r?.blocks) ? r.blocks : []).filter(x => x && x.iid).map(x => [x.iid, x.type || 'strength'])));

export function gatePlan(bundle, ctx) {
  const byId = new Map(bundle.routines.map(r => [r.id, r]));
  const order = Object.keys(bundle.week || {}).sort().map(d => byId.get(bundle.week[d])).filter(Boolean);
  const days = (order.length ? order : bundle.routines).map(r => r.ex);
  // Guided blocks copied from the library (circuit/interval/HIIT/mobility) are judged as what they are.
  const blockTypes = typesOf(bundle.routines);
  const v = validateAgainst2JProtocol({ kind: 'program', goal: ctx.goal, level: ctx.level, days, protocolVersion: PROTOCOL_VERSION, blockTypes },
    { lookup: blocks.lookup, restrictions: ctx.restrictions, unavailableEq: ctx.unavailableEq });
  // A model gets no benefit of the doubt on declared restrictions: an exercise that cannot be
  // verified against them (outside the curated catalogue) goes back for a verifiable alternative.
  const unverifiable = v.issues.filter(i => i.code === 'restriction_unverified')
    .map(i => `Protocol 2J: [restriction_unverified] ${i.message} Use an exercise from the official 2J blocks instead.`);
  if (v.result === 'FAIL' || unverifiable.length) return { ok: false, errors: [...failuresForRepair(v).map(e => 'Protocol 2J: ' + e), ...unverifiable], validation: v };
  return {
    ok: true,
    bundle: { ...bundle, protocol: { v: PROTOCOL_VERSION, goal: ctx.goal, level: ctx.level, result: v.result,
      reasons: v.issues.filter(i => i.severity === 'reason').map(i => ({ code: i.code, params: i.params, message: i.message, reason: i.reason, reasonGiven: i.reasonGiven })) } },
  };
}

// Apply a validated change-set to a copy of the plan — only what matters to the protocol.
function simulate(plan, changes) {
  const routines = (plan?.routines || []).map(r => ({ ...r, ex: (r.ex || []).map(e => ({ ...e })) }));
  const find = id => routines.find(r => r.id === id);
  for (const c of changes) {
    const r = c.target?.routineId ? find(c.target.routineId) : null;
    const idx = r ? r.ex.findIndex(e => e.id === c.target.exId) : -1;
    switch (c.type) {
      case 'add-exercise': if (r) { const e = { ...c.after }; delete e.name; delete e.position; r.ex.splice(c.after.position ?? r.ex.length, 0, e); } break;
      case 'swap-exercise': if (idx >= 0) { const { name, ...a } = c.after; r.ex[idx] = { ...r.ex[idx], ...a }; } break;
      case 'remove-exercise': if (idx >= 0) r.ex.splice(idx, 1); break;
      case 'sets': if (idx >= 0) r.ex[idx].sets = c.after; break;
      case 'reps': if (idx >= 0) { r.ex[idx].reps = c.after; delete r.ex[idx].targetRepsMin; delete r.ex[idx].targetRepsMax; } break;
      case 'repsMin': if (idx >= 0) r.ex[idx].repsMin = c.after; break;
      case 'sec': if (idx >= 0) r.ex[idx].sec = c.after; break;
      case 'add-routine': routines.push({ id: 'new' + routines.length, ex: c.after.ex.map(({ name, ...e }) => e) }); break;
      case 'remove-routine': if (r) routines.splice(routines.indexOf(r), 1); break;
      default: break;
    }
  }
  return routines;
}

/**
 * A review may not introduce a FAIL the plan did not already have. Pre-existing problems are
 * the trainer's/member's plan (authority 4), not the model's to be blamed for.
 */
export function gateReview(proposal, plan, ctx) {
  const run = routines => validateAgainst2JProtocol({ kind: 'program', goal: ctx.goal, level: ctx.level, days: routines.map(r => r.ex), blockTypes: typesOf(routines) },
    { lookup: blocks.lookup, restrictions: ctx.restrictions, unavailableEq: ctx.unavailableEq });
  const sig = i => `${i.code}|${i.params.join('|')}`;
  const before = new Set(run(plan?.routines || []).issues.filter(i => i.severity === 'fail' || i.code === 'restriction_unverified').map(sig));
  const after = run(simulate(plan, proposal.changes || []));
  const introduced = after.issues.filter(i => (i.severity === 'fail' || i.code === 'restriction_unverified') && !before.has(sig(i)));
  if (introduced.length) return { ok: false, errors: introduced.map(i => `Protocol 2J: [${i.code}] ${i.message}`) };
  return { ok: true, proposal: { ...proposal, protocol: { v: PROTOCOL_VERSION, goal: ctx.goal, level: ctx.level, result: after.result } } };
}

// The gym's temporarily-unavailable equipment (server.js keeps this file), read fresh per job.
export function readUnavailableEq() {
  try {
    const arr = JSON.parse(fs.readFileSync(path.join(process.env.DATA_DIR || '/data', 'unavailable-equipment.json'), 'utf8'));
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
/** Rebuild the gate context from what the model was given — one source of truth per job. */
export const ctxFromPayload = payload => ({
  goal: payload?.protocol?.goal || 'general', level: payload?.protocol?.level || 'intermediate',
  restrictions: payload?.protocol?.restrictions || [], unavailableEq: readUnavailableEq(),
});
