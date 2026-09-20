/* Server-side copy of frontend/src/lib/training-zones.js's ZONES table — same duplication
 * trade-off as rp-volume.js in this same directory. Classifies a single SET's intensity
 * (%1RM/RIR), distinct from rp-volume.js's weekly per-muscle-group set count. Given to the
 * Coach only when a member has Training Zones on (S.enableTrainingZones), so it can phrase
 * each exercise's effort target in the same Z1-Z5 vocabulary the member's own logger already
 * shows them, instead of generic RIR/RPE language they have no matching chip for.
 */
export const ZONES = [
  { short: 'Z1', label: 'Recovery', pct: '< 60%', rir: '> 5', reps: '15+' },
  { short: 'Z2', label: 'Muscular endurance', pct: '60-70%', rir: '4-5', reps: '12-20+' },
  { short: 'Z3', label: 'Hypertrophy', pct: '70-80%', rir: '2-3', reps: '8-12' },
  { short: 'Z4', label: 'Strength', pct: '80-90%', rir: '1-2', reps: '4-6' },
  { short: 'Z5', label: 'Max strength', pct: '> 90%', rir: '0', reps: '1-3' },
];
