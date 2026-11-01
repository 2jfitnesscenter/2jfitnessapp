// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Deterministic judgement of bioimpedance readings — no AI in here. The vision model proposes
 * numbers; this module decides how far to trust them:
 *
 *   normalizeReading()  keeps only known keys, finite numbers, inside a human range (a value
 *                       outside is DROPPED, never clamped) and notes what it dropped;
 *   crossChecks()       physical relations between fields that a misread digit breaks
 *                       (fat kg + muscle kg cannot exceed body weight…);
 *   assessReading()     "can this single read be accepted as it is?";
 *   mergeReadings()     per-field majority across 2–3 reads, with a small tolerance for the
 *                       rounding noise of the same printed number (62.1 vs 62.0 agree, 17.3 vs
 *                       37.3 never do). A field without a majority becomes null = "review it".
 *
 * Nothing is invented: a value is either what at least two independent reads agree on, or what
 * one read printed AND every deterministic check accepts, or null.
 */

export const SCAN_KEYS = [
  'weight', 'bodyFat', 'muscleMass', 'waterPct', 'visceralFat', 'boneMass',
  'segFatArmL', 'segFatArmR', 'segFatLegL', 'segFatLegR', 'segFatTrunk',
  'segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR', 'segMuscleTrunk'
];

const SEG_FAT_RANGE = [0, 250];        // a ratio against the segment's own standard range, in %
const SEG_ARM_RANGE = [0.5, 15];       // segment muscle mass, in kg — see lib/measurements.js
const SEG_LEG_RANGE = [1, 25];
const SEG_TRUNK_RANGE = [5, 50];
export const RANGES = {
  weight: [20, 400], bodyFat: [1, 70], muscleMass: [5, 150], waterPct: [10, 90], visceralFat: [1, 60], boneMass: [0.5, 15],
  segFatArmL: SEG_FAT_RANGE, segFatArmR: SEG_FAT_RANGE, segFatLegL: SEG_FAT_RANGE, segFatLegR: SEG_FAT_RANGE, segFatTrunk: SEG_FAT_RANGE,
  segMuscleArmL: SEG_ARM_RANGE, segMuscleArmR: SEG_ARM_RANGE, segMuscleLegL: SEG_LEG_RANGE, segMuscleLegR: SEG_LEG_RANGE, segMuscleTrunk: SEG_TRUNK_RANGE
};

/** Two reads of the same printed number agree if they differ by no more than this. */
export function tolerance(key) {
  if (key === 'visceralFat') return 0;                 // a grade: a small integer, exact
  if (key.startsWith('segFat')) return 0.6;            // "116.2%": one decimal of a larger number
  return 0.15;                                         // 62.1 vs 62.0 is the same print, 62.1 vs 62.5 is not
}

const isFiniteNum = v => typeof v === 'number' && Number.isFinite(v);
const round1 = n => Math.round(n * 10) / 10;
const CONFIDENCES = ['high', 'medium', 'low'];

/**
 * @returns {{ values: object, dropped: string[], confidence: 'high'|'medium'|'low'|null }}
 */
export function normalizeReading(raw) {
  const values = {}, dropped = [];
  for (const key of SCAN_KEYS) {
    const v = raw?.[key];
    const num = typeof v === 'string' ? Number(v.replace(',', '.')) : v;
    if (!isFiniteNum(num)) { values[key] = null; continue; }
    const [lo, hi] = RANGES[key];
    if (num >= lo && num <= hi) values[key] = round1(num);
    else { values[key] = null; dropped.push(key); }
  }
  const c = typeof raw?.confidence === 'string' ? raw.confidence.toLowerCase() : null;
  return { values, dropped, confidence: CONFIDENCES.includes(c) ? c : null };
}

/**
 * Physical relations that a wrong digit usually breaks. Returns the checks that FAILED, each
 * with the fields involved; an empty list means "nothing contradicts anything".
 */
export function crossChecks(v) {
  const failed = [];
  const { weight, bodyFat, muscleMass, boneMass, waterPct } = v;
  if (isFiniteNum(weight) && isFiniteNum(muscleMass) && muscleMass >= weight) failed.push({ id: 'muscle_over_weight', keys: ['muscleMass'] });
  if (isFiniteNum(weight) && isFiniteNum(bodyFat) && isFiniteNum(muscleMass)) {
    const total = weight * bodyFat / 100 + muscleMass + (isFiniteNum(boneMass) ? boneMass : 0);
    if (total > weight * 1.03) failed.push({ id: 'fat_plus_muscle_over_weight', keys: ['bodyFat', 'muscleMass'] })   // the weight is the anchor of the check, not its suspect;
  }
  if (isFiniteNum(waterPct) && (waterPct < 25 || waterPct > 80)) failed.push({ id: 'water_implausible', keys: ['waterPct'] });
  const segMuscle = ['segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR', 'segMuscleTrunk'].map(k => v[k]);
  if (isFiniteNum(muscleMass) && segMuscle.every(isFiniteNum)) {
    const sum = segMuscle.reduce((a, b) => a + b, 0);
    if (sum < muscleMass * 0.5 || sum > muscleMass * 1.5) failed.push({ id: 'segments_vs_total_muscle', keys: ['muscleMass', ...['segMuscleArmL', 'segMuscleArmR', 'segMuscleLegL', 'segMuscleLegR', 'segMuscleTrunk']] });
  }
  return failed;
}

const CORE = ['weight', 'bodyFat', 'muscleMass'];

/**
 * Can this single read be accepted as it stands?
 * @returns {{ suspicious: boolean, reasons: string[], failedKeys: string[] }}
 */
export function assessReading({ values, dropped, confidence }) {
  const reasons = [];
  if (confidence && confidence !== 'high') reasons.push('self_reported_' + confidence);
  if (dropped.length) reasons.push('out_of_range');
  if (CORE.some(k => values[k] == null)) reasons.push('core_missing');
  const failed = crossChecks(values);
  for (const f of failed) reasons.push(f.id);
  return { suspicious: reasons.length > 0, reasons, failedKeys: [...new Set(failed.flatMap(f => f.keys))] };
}

/**
 * Per-field majority across the readings (each a { key: number|null } map).
 * @returns {{ values: object, review: string[], conflicts: string[] }}
 *   review    — fields where no majority exists (they come back null),
 *   conflicts — the same list, for deciding whether a further read can still help.
 */
export function mergeReadings(readings) {
  const need = Math.floor(readings.length / 2) + 1;
  const values = {}, review = [];
  for (const key of SCAN_KEYS) {
    const votes = readings.map(r => r[key]);
    const tol = tolerance(key);
    const groups = [];                                    // { members: number[]|null-marker, isNull }
    for (const v of votes) {
      if (!isFiniteNum(v)) { let g = groups.find(x => x.isNull); if (!g) groups.push(g = { isNull: true, members: [] }); g.members.push(null); continue; }
      const g = groups.find(x => !x.isNull && Math.abs(x.members[0] - v) <= tol + 1e-9);
      if (g) g.members.push(v); else groups.push({ isNull: false, members: [v] });
    }
    const winner = groups.find(g => g.members.length >= need);
    if (!winner) { values[key] = null; review.push(key); continue; }
    if (winner.isNull) { values[key] = null; continue; }
    const sorted = [...winner.members].sort((a, b) => a - b);
    values[key] = round1(sorted[Math.floor(sorted.length / 2)]);
  }
  return { values, review, conflicts: review };
}
