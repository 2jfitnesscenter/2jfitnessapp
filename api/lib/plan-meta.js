/* Optional Constructor V2 metadata that rides on a member's routine/program.
 *
 * routine.blocks — which block instances the day was assembled from (a snapshot label per
 *   instance; the entries carry `blk`). Purely editorial: Workout, Bunker, Sync and
 *   Progressive Overload read the flat `ex` list exactly as before and ignore this.
 * routine.meta / program.meta — the goal, level and explicit restrictions the trainer built
 *   under, and the protocol version, so the builder can re-validate the same way later.
 * Everything is whitelisted; unknown values are dropped rather than stored.
 */
import { BLOCK_TYPES, GOALS, LEVELS, RESTRICTIONS, PROTOCOL_VERSION } from './protocol/index.js';

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
  }));
}

export function sanitizePlanMeta(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const out = {
    goal: GOALS.includes(meta.goal) ? meta.goal : null,
    level: LEVELS.includes(meta.level) ? meta.level : null,
    restrictions: Array.isArray(meta.restrictions) ? [...new Set(meta.restrictions.filter(r => RESTRICTIONS.includes(r)))] : [],
    v: PROTOCOL_VERSION,
  };
  if (!out.goal && !out.level && !out.restrictions.length) return null;
  return out;
}
