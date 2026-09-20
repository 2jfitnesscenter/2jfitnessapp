/* Server-side slice of frontend/src/lib/rp-volume.js + lib/muscles.js's target-muscle mapping —
 * duplicated rather than shared, same trade-off payload.js's own modeOf/cleanEx already make
 * for this codebase (two runtimes, no build step in common). Exists so the Coach's payload can
 * tell the model a member's actual MV/MEV/MAV/MRV weekly-set landmarks (when they've turned RP
 * Volume Zones on) and which of the 12 muscle groups each library exercise trains — without
 * either of those tables drifting out of sync with the ones the app itself renders zones from.
 * coach.test.js pins the two copies together against shared fixtures.
 */

export const LEVELS = ['beginner', 'intermediate', 'advanced'];

// Exact copy of frontend/src/lib/rp-volume.js's own RP_VOLUME_DEFAULTS — see that file's
// comment for the reasoning behind the numbers themselves.
export const RP_VOLUME_DEFAULTS = {
  beginner: {
    chest: { mv: 4, mev: 6, mav: 8, mrvMin: 12, mrvMax: 14 },
    back: { mv: 4, mev: 6, mav: 10, mrvMin: 12, mrvMax: 16 },
    trapezius: { mv: 3, mev: 4, mav: 6, mrvMin: 10, mrvMax: 13 },
    deltoids: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 16 },
    biceps: { mv: 2, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    triceps: { mv: 2, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    forearm: { mv: 0, mev: 0, mav: 4, mrvMin: 6, mrvMax: 10 },
    quadriceps: { mv: 4, mev: 6, mav: 8, mrvMin: 12, mrvMax: 14 },
    hamstring: { mv: 3, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    gluteal: { mv: 0, mev: 2, mav: 6, mrvMin: 8, mrvMax: 12 },
    calves: { mv: 2, mev: 4, mav: 6, mrvMin: 10, mrvMax: 12 },
    abs: { mv: 0, mev: 2, mav: 6, mrvMin: 8, mrvMax: 12 },
  },
  intermediate: {
    chest: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 20 },
    back: { mv: 6, mev: 10, mav: 14, mrvMin: 18, mrvMax: 22 },
    trapezius: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    deltoids: { mv: 6, mev: 8, mav: 16, mrvMin: 20, mrvMax: 24 },
    biceps: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    triceps: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    forearm: { mv: 0, mev: 2, mav: 6, mrvMin: 10, mrvMax: 14 },
    quadriceps: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 18 },
    hamstring: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 16 },
    gluteal: { mv: 2, mev: 4, mav: 8, mrvMin: 12, mrvMax: 16 },
    calves: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 18 },
    abs: { mv: 0, mev: 4, mav: 8, mrvMin: 12, mrvMax: 16 },
  },
  advanced: {
    chest: { mv: 8, mev: 10, mav: 14, mrvMin: 20, mrvMax: 24 },
    back: { mv: 8, mev: 12, mav: 16, mrvMin: 22, mrvMax: 26 },
    trapezius: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    deltoids: { mv: 8, mev: 12, mav: 18, mrvMin: 24, mrvMax: 28 },
    biceps: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    triceps: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    forearm: { mv: 0, mev: 4, mav: 8, mrvMin: 12, mrvMax: 18 },
    quadriceps: { mv: 8, mev: 10, mav: 14, mrvMin: 20, mrvMax: 22 },
    hamstring: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 20 },
    gluteal: { mv: 4, mev: 6, mav: 10, mrvMin: 14, mrvMax: 20 },
    calves: { mv: 6, mev: 8, mav: 12, mrvMin: 16, mrvMax: 22 },
    abs: { mv: 0, mev: 6, mav: 10, mrvMin: 14, mrvMax: 20 },
  },
};

// Display names for the 12 groups — matches frontend/src/lib/muscles.js's MUSCLE_GROUPS names
// exactly (English; the prompt is written in English and the model writes member-facing text
// in meta.lang itself, same as everywhere else in this payload).
export const GROUP_NAME = {
  trapezius: 'Traps', deltoids: 'Shoulders', chest: 'Chest', back: 'Back',
  biceps: 'Biceps', triceps: 'Triceps', forearm: 'Forearms', abs: 'Abs',
  gluteal: 'Glutes', quadriceps: 'Quads', hamstring: 'Hamstrings', calves: 'Calves',
};
const GROUP_KEYS = Object.keys(GROUP_NAME);

/** Same fallback rule as the client's own landmarksFor: an override for this group if the
 * member set one (Settings → calibration), else the level's default, defaulting to
 * 'intermediate' for an unset/invalid level. */
export function landmarksFor(trainingLevel, rpVolumeOverrides, groupKey) {
  const level = LEVELS.includes(trainingLevel) ? trainingLevel : 'intermediate';
  return (rpVolumeOverrides && rpVolumeOverrides[groupKey]) || RP_VOLUME_DEFAULTS[level][groupKey];
}

/** All 12 groups' landmarks for this member, or null if they haven't turned RP Volume Zones
 * on — mirrors the exact gate the app's own UI uses (S.enableRpVolumeZones), so the Coach never
 * reasons about a system the member doesn't have switched on and will never see a chip for. */
export function rpVolumeSnapshot(S) {
  if (!S || !S.enableRpVolumeZones) return null;
  const level = LEVELS.includes(S.trainingLevel) ? S.trainingLevel : 'intermediate';
  return {
    level,
    groups: GROUP_KEYS.map(key => ({ key, name: GROUP_NAME[key], ...landmarksFor(S.trainingLevel, S.rpVolumeOverrides, key) })),
  };
}

// tg-string -> one of the 12 group keys above. A trimmed copy of frontend/src/lib/muscles.js's
// own ALIAS + MUSCLE_GROUPS.slugs composition — only what's needed to resolve a *primary*
// target onto a group (the app's own secondary-muscle weighting has no equivalent here; the
// model doesn't need it to reason about roughly which group an exercise trains).
const TG_TO_GROUP = {
  pectorals: 'chest', chest: 'chest', 'upper chest': 'chest',
  'upper back': 'back', lats: 'back', 'latissimus dorsi': 'back', back: 'back', rhomboids: 'back', spine: 'back', 'lower back': 'back',
  traps: 'trapezius', trapezius: 'trapezius', 'levator scapulae': 'trapezius',
  delts: 'deltoids', deltoids: 'deltoids', shoulders: 'deltoids', 'rear deltoids': 'deltoids', 'rotator cuff': 'deltoids',
  biceps: 'biceps', brachialis: 'biceps',
  triceps: 'triceps',
  forearms: 'forearm', wrists: 'forearm', 'wrist flexors': 'forearm', 'wrist extensors': 'forearm', 'grip muscles': 'forearm',
  abs: 'abs', abdominals: 'abs', 'lower abs': 'abs', core: 'abs', obliques: 'abs', serratus: 'abs', 'serratus anterior': 'abs',
  glutes: 'gluteal', abductors: 'gluteal', adductors: 'gluteal', groin: 'gluteal', 'inner thighs': 'gluteal', 'hip flexors': 'gluteal',
  quads: 'quadriceps', quadriceps: 'quadriceps',
  hamstrings: 'hamstring',
  calves: 'calves', soleus: 'calves', shins: 'calves',
};
/** Which of the 12 groups a library exercise's `tg` (dataset target-muscle string) trains, or
 * null when it doesn't map onto anything drawable (matches ALIAS's own null entries — hands,
 * ankles, "cardiovascular system") or the exercise has no `tg` at all (a custom exercise). */
export function groupOfTarget(tg) {
  if (!tg) return null;
  return TG_TO_GROUP[String(tg).toLowerCase().trim()] || null;
}
