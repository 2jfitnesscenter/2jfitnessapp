// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Optional Constructor V2 metadata that rides on a member's routine/program.
 *
 * routine.blocks — which block instances the day was assembled from (a snapshot label per
 *   instance; the entries carry `blk`). Purely editorial: Workout, Bunker, Sync and
 *   Progressive Overload read the flat `ex` list exactly as before and ignore this.
 * routine.meta / program.meta — the goal, level and explicit restrictions the trainer built
 *   under, and the protocol version, so the builder can re-validate the same way later.
 * Everything is whitelisted; unknown values are dropped rather than stored.
 */
import { BLOCK_TYPES, GOALS, LEVELS, RESTRICTIONS, PROTOCOL_VERSION, validateAgainst2JProtocol, savePolicy, OVERRIDE_REASON_MIN, sanitizeTiming } from './protocol/index.js';
import { lookup } from './blocks-store.js';

const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');

export function sanitizeRoutineBlocks(blocks, ex) {
  const used = new Set((Array.isArray(ex) ? ex : []).map(e => e && e.blk).filter(Boolean));
  if (!Array.isArray(blocks)) return [];
  return blocks.slice(0, 20).filter(b => b && typeof b.iid === 'string' && used.has(b.iid)).map(b => ({
    iid: b.iid.slice(0, 24),
    src: str(b.src, 60) || null,
    name: str(b.name, 80) || null,
    type: BLOCK_TYPES.includes(b.type) ? b.type : 'strength',
    goal: GOALS.includes(b.goal) ? b.goal : null,
    level: LEVELS.includes(b.level) ? b.level : null,
    focus: str(b.focus, 20) || null,
    variant: /^[A-D]$/.test(b.variant || '') ? b.variant : null,
    style: str(b.style, 30) || null,
    v: /^\d+\.\d+$/.test(b.v || '') ? b.v : PROTOCOL_VERSION,
    // A guided block's pacing (Constructor V2.1) — clamped, and only for the timed types.
    ...withTiming(b),
  }));
}
const withTiming = b => {
  const timing = sanitizeTiming(b.timing, BLOCK_TYPES.includes(b.type) ? b.type : 'strength');
  return timing ? { timing } : {};
};
/** { instance id: type } from a routine's block labels — what the validator needs per day. */
export const blockTypesOf = blocks => Object.fromEntries((Array.isArray(blocks) ? blocks : []).filter(b => b && b.iid).map(b => [b.iid, b.type || 'strength']));

export function sanitizePlanMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {
    goal: GOALS.includes(meta.goal) ? meta.goal : null,
    level: LEVELS.includes(meta.level) ? meta.level : null,
    restrictions: Array.isArray(meta.restrictions) ? [...new Set(meta.restrictions.filter(r => RESTRICTIONS.includes(r)))] : [],
    v: PROTOCOL_VERSION,
  };
  // A trainer's conscious override of a methodological FAIL: what was overridden and why.
  const o = meta.override;
  if (o && typeof o === 'object' && typeof o.reason === 'string' && o.reason.trim().length >= OVERRIDE_REASON_MIN) {
    out.override = { reason: o.reason.trim().slice(0, 300), codes: (Array.isArray(o.codes) ? o.codes : []).filter(c => typeof c === 'string').slice(0, 20).map(c => c.slice(0, 40)), at: new Date().toISOString() };
  }
  if (!out.goal && !out.level && !out.restrictions.length) return null;
  return out;
}

/**
 * Server-side half of the manual-save policy (lib/protocol/validator.js savePolicy). Only applies
 * when the save carries protocol context (meta) — older trainer paths without it are unchanged.
 * Declared restrictions are never overridable here; a methodological FAIL needs meta.override.
 * @returns null | { status, error, validation }
 */
export function enforcePlanPolicy(days, meta, blockTypes = {}) {
  if (!meta) return null;
  const v = validateAgainst2JProtocol({ kind: days.length > 1 ? 'program' : 'routine', goal: meta.goal || 'general', level: meta.level || 'intermediate', days, entries: days[0] || [], blockTypes },
    { lookup, restrictions: meta.restrictions || [] });
  const p = savePolicy(v);
  if (p.blocked.length) return { status: 400, error: 'incumple una restricción declarada: retira el ejercicio o modifica la restricción del socio', validation: v };
  if (p.needsReason && !meta.override) return { status: 400, error: 'no encaja con el Protocolo 2J: guardar exige un override consciente con motivo', validation: v };
  return null;
}
