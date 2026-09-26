// Copyright (C) 2026 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Coverage matrix of the official 2J block library — protocol v1.0.
 *
 * Human-reviewable data, not generated combinations: every row was chosen on purpose, and the
 * rows that would be useless were left out (no fat-loss "muscle group", no power for every
 * muscle, no three levels where the difference would be artificial, no A/B/C that only swaps
 * one exercise). scripts/build-official-blocks.mjs turns each row into a prescribed block with
 * the protocol's own prescribe(), validates it, and refuses to write the library if anything
 * FAILs or if variants of one family are clones.
 *
 * Row:  [focus, goal, level, variant, style, exercises, opts?]
 *   exercises: library ids; a nested array is a superset (done back-to-back);
 *              'id:time=40' = timed hold, 'id:cardio=20@6' = minutes @ speed, 'id:role=metabolic'.
 *   opts.type:  'strength' (default) | 'superset' | 'cardio' | 'circuit' | 'interval' | 'hiit' | 'mobility'
 *   opts.timing: guided blocks only — { prep, work, rest, rounds, roundRest, preset? }; the entries
 *               are shaped to it by the protocol's applyTiming() (rounds = sets, timed bouts = work)
 * Coverage (why these families): the gym's high-use muscle blocks (glutes, quads, chest, back,
 * shoulders) get A/B/C per level; hamstrings/arms get fewer variants; calves and core are short
 * accessory blocks; strength covers the five big lift families at intermediate/advanced (a
 * beginner's "strength" is the general/start goals); general, endurance and start/return cover
 * full body and the main splits; supersets and cardio cover the formats trainers asked for.
 */
export const MATRIX = [
  // ───────── GLUTES · hypertrophy
  ['glutes', 'hypertrophy', 'beginner', 'A', 'stable', ['0739', '1409', '0597', '0586']],
  ['glutes', 'hypertrophy', 'beginner', 'B', 'mixed', ['1459', '0739', '2286', '0597']],
  ['glutes', 'hypertrophy', 'beginner', 'C', 'unilateral', ['0431', '0381', '0228', '0597']],
  ['glutes', 'hypertrophy', 'intermediate', 'A', 'tension', ['0058', '0085', '0410', '0228', '0597']], // V2.1: hip thrust (was 1409)
  ['glutes', 'hypertrophy', 'intermediate', 'B', 'mixed', ['0739', '1409', '1459', '0593', '0597']],
  ['glutes', 'hypertrophy', 'intermediate', 'C', 'unilateral-isolation', ['0381', '1757', '0431', '2286', '0597']],
  ['glutes', 'hypertrophy', 'advanced', 'A', 'tension', ['0058', '0085', '0768', '0593', '0228', '0597']], // V2.1: hip thrust (was 1409)
  ['glutes', 'hypertrophy', 'advanced', 'B', 'heavy', ['0811', '1409', '1425', '0573', '0597']],
  ['glutes', 'hypertrophy', 'advanced', 'C', 'unilateral', ['0381', '1757', '0431', '0196', '2286', '0710']],
  // ───────── QUADS · hypertrophy
  ['quads', 'hypertrophy', 'beginner', 'A', 'stable', ['0739', '0768', '0585', '0599']],
  ['quads', 'hypertrophy', 'beginner', 'B', 'mixed', ['1760', '0739', '0336', '0585']],
  ['quads', 'hypertrophy', 'intermediate', 'A', 'tension', ['0043', '0739', '0410', '0585']],
  ['quads', 'hypertrophy', 'intermediate', 'B', 'machine', ['0743', '1425', '0336', '0585', '0599']],
  ['quads', 'hypertrophy', 'intermediate', 'C', 'unilateral', ['0410', '1425', '1460', '0431', '0585']],
  ['quads', 'hypertrophy', 'advanced', 'A', 'heavy', ['0043', '0743', '0739', '0410', '0585']],
  ['quads', 'hypertrophy', 'advanced', 'B', 'free', ['0042', '0739', '0768', '0585']],
  ['quads', 'hypertrophy', 'advanced', 'C', 'unilateral', ['0768', '1425', '0381', '0585', '0586']],
  // ───────── HAMSTRINGS · hypertrophy
  ['hamstrings', 'hypertrophy', 'beginner', null, 'stable', ['1459', '0586', '0489', '0599']],
  ['hamstrings', 'hypertrophy', 'intermediate', 'A', 'hip-dominant', ['0085', '0599', '0573', '0586']],
  ['hamstrings', 'hypertrophy', 'intermediate', 'B', 'unilateral', ['1757', '0582', '0196', '0599']],
  ['hamstrings', 'hypertrophy', 'advanced', 'A', 'tension', ['0085', '3193', '0599', '0573']],
  ['hamstrings', 'hypertrophy', 'advanced', 'B', 'mixed', ['0044', '0586', '1757', '0599']],
  // ───────── CHEST · hypertrophy
  ['chest', 'hypertrophy', 'beginner', 'A', 'stable', ['0577', '1299', '0596', '0179']],
  ['chest', 'hypertrophy', 'beginner', 'B', 'mixed', ['0289', '0314', '0596', '0009']],
  ['chest', 'hypertrophy', 'intermediate', 'A', 'tension', ['0025', '1299', '0319', '0596']],
  ['chest', 'hypertrophy', 'intermediate', 'B', 'mixed', ['0314', '0577', '0251', '0227']],
  ['chest', 'hypertrophy', 'intermediate', 'C', 'upper-focus', ['0047', '0577', '0179', '0009']],
  ['chest', 'hypertrophy', 'advanced', 'A', 'heavy', ['0025', '0047', '0319', '0596', '0251']],
  ['chest', 'hypertrophy', 'advanced', 'B', 'mixed', ['0314', '0577', '0308', '0375']],
  // ───────── BACK · hypertrophy
  ['back', 'hypertrophy', 'beginner', 'A', 'stable', ['0198', '1350', '0238', '0602']],
  ['back', 'hypertrophy', 'beginner', 'B', 'mixed', ['2616', '0327', '0861', '0203']],
  ['back', 'hypertrophy', 'intermediate', 'A', 'tension', ['0198', '0027', '1350', '0238']],
  ['back', 'hypertrophy', 'intermediate', 'B', 'mixed', ['0652', '0292', '0861', '0375']],
  ['back', 'hypertrophy', 'intermediate', 'C', 'unilateral', ['0245', '3563', '1349', '0581', '0225']],
  ['back', 'hypertrophy', 'advanced', 'A', 'heavy', ['0652', '0027', '0245', '1350', '0238']],
  ['back', 'hypertrophy', 'advanced', 'B', 'mixed', ['1326', '3017', '0189', '2616', '0375']],
  ['back', 'hypertrophy', 'advanced', 'C', 'unilateral', ['3563', '0292', '1349', '0238', '0406']],
  // ───────── SHOULDERS · hypertrophy
  ['shoulders', 'hypertrophy', 'beginner', 'A', 'stable', ['0603', '0584', '0602', '0203']],
  ['shoulders', 'hypertrophy', 'beginner', 'B', 'free', ['0405', '0334', '0383']],
  ['shoulders', 'hypertrophy', 'intermediate', 'A', 'tension', ['0405', '0178', '0602', '0203']],
  ['shoulders', 'hypertrophy', 'intermediate', 'B', 'machine', ['0603', '0334', '0225', '0192']],
  ['shoulders', 'hypertrophy', 'intermediate', 'C', 'mixed', ['2137', '0192', '0225', '0310']],
  ['shoulders', 'hypertrophy', 'advanced', 'A', 'heavy', ['1456', '0178', '0192', '0602', '0203']],
  ['shoulders', 'hypertrophy', 'advanced', 'B', 'machine', ['0766', '0584', '0383', '0310', '0203']],
  // ───────── ARMS · hypertrophy
  ['arms', 'hypertrophy', 'beginner', null, 'stable', ['0294', '0201', '0313', '0194']],
  ['arms', 'hypertrophy', 'intermediate', 'A', 'free', ['0031', '0060', '0318', '0200', '0313']],
  ['arms', 'hypertrophy', 'intermediate', 'B', 'machine', ['0070', '0194', '0868', '0814', '0165']],
  ['arms', 'hypertrophy', 'advanced', null, 'volume', ['0447', '0030', '0318', '1749', '0592', '0201']],
  ['biceps', 'hypertrophy', 'intermediate', null, 'lengthened', ['0031', '0318', '0070']],
  ['triceps', 'hypertrophy', 'intermediate', null, 'lengthened', ['0194', '0060', '0200']],
  // ───────── CALVES · hypertrophy (short accessory blocks)
  ['calves', 'hypertrophy', 'beginner', null, 'stable', ['0605', '0594']],
  ['calves', 'hypertrophy', 'intermediate', null, 'mixed', ['0605', '0594', '0409']],
  // ───────── PATTERN families · hypertrophy
  ['push', 'hypertrophy', 'intermediate', 'A', 'free', ['0025', '0405', '0319', '0178', '0200']],
  ['push', 'hypertrophy', 'intermediate', 'B', 'machine', ['0577', '0314', '0603', '0334', '0194']],
  ['push', 'hypertrophy', 'advanced', null, 'volume', ['0047', '0577', '0405', '0178', '0596', '0060']],
  ['pull', 'hypertrophy', 'intermediate', 'A', 'machine', ['0198', '1350', '0327', '0602', '0294']],
  ['pull', 'hypertrophy', 'intermediate', 'B', 'free', ['0652', '0861', '0238', '0203', '0313']],
  ['pull', 'hypertrophy', 'advanced', null, 'volume', ['1326', '0027', '3563', '0225', '0318', '0070']],
  ['lower', 'hypertrophy', 'intermediate', 'A', 'knee-dominant', ['0043', '0085', '0739', '0585', '0599', '0605']],
  ['lower', 'hypertrophy', 'intermediate', 'B', 'hip-dominant', ['0743', '1459', '0410', '0586', '0597']],
  ['lower', 'hypertrophy', 'advanced', null, 'heavy', ['0042', '0085', '0768', '0585', '0599', '0594']],
  ['posterior', 'hypertrophy', 'intermediate', null, 'mixed', ['0085', '1409', '0599', '0573', '0597']],
  ['posterior', 'hypertrophy', 'advanced', null, 'heavy', ['0032', '1409', '0586', '0593', '1757']],
  ['fullbody', 'hypertrophy', 'intermediate', 'A', 'machine', ['0739', '0577', '0198', '1459', '0178', '0201']],
  ['fullbody', 'hypertrophy', 'intermediate', 'B', 'free', ['1760', '0289', '0861', '0599', '0334', '0294']],
  ['fullbody', 'hypertrophy', 'advanced', null, 'heavy', ['0043', '0047', '0652', '0085', '0192', '0060']],
  // ───────── SUPERSET blocks · hypertrophy
  ['arms', 'hypertrophy', 'intermediate', null, 'pairs', [['0031', '0201'], ['0318', '0194']], { type: 'superset' }],
  ['upper', 'hypertrophy', 'intermediate', null, 'pairs', [['0289', '0292'], ['1299', '1350'], ['0319', '0238']], { type: 'superset' }],
  ['shoulders', 'hypertrophy', 'intermediate', null, 'pairs', [['0334', '0605'], ['0602', '0594']], { type: 'superset' }],
  ['lower', 'hypertrophy', 'intermediate', null, 'pairs', [['0739', '0586'], ['0585', '0599']], { type: 'superset' }],
  ['upper', 'hypertrophy', 'advanced', null, 'pairs', [['0047', '1326'], ['0405', '3563'], ['0596', '0225']], { type: 'superset' }],
  // ───────── STRENGTH (main lift first; intermediate/advanced only)
  ['lower', 'strength', 'intermediate', null, 'heavy', ['0043', '0085', '0739', '0586']],
  ['lower', 'strength', 'advanced', 'A', 'knee-dominant', ['0043', '0042', '0085', '0586']],
  ['lower', 'strength', 'advanced', 'B', 'hip-dominant', ['0032', '0410', '0573', '0599']],
  ['chest', 'strength', 'intermediate', null, 'heavy', ['0025', '0047', '0251', '0201']],
  ['chest', 'strength', 'advanced', null, 'heavy', ['0025', '0030', '0251', '0060']],
  ['back', 'strength', 'intermediate', null, 'heavy', ['0027', '0652', '1350', '0031']],
  ['back', 'strength', 'advanced', null, 'heavy', ['3017', '1326', '0292', '0070']],
  ['shoulders', 'strength', 'intermediate', null, 'heavy', ['1456', '0652', '0178', '0602']],
  ['posterior', 'strength', 'intermediate', null, 'heavy', ['0032', '1409', '0586', '0573']],
  ['posterior', 'strength', 'advanced', null, 'heavy', ['0811', '0085', '0593', '0599']],
  ['fullbody', 'strength', 'intermediate', null, 'heavy', ['0043', '0025', '0027', '0586']],
  ['fullbody', 'strength', 'advanced', null, 'heavy', ['0032', '0047', '0652', '0599']],
  // ───────── GENERAL strength / health
  ['fullbody', 'general', 'beginner', 'A', 'stable', ['0739', '0577', '0198', '0586', '1452']],
  ['fullbody', 'general', 'beginner', 'B', 'mixed', ['1760', '0289', '0861', '1459', '3544:time=25']],
  ['fullbody', 'general', 'beginner', 'C', 'unilateral', ['0431', '0292', '0314', '0381', '0276']],
  ['fullbody', 'general', 'intermediate', 'A', 'free', ['0043', '0025', '0027', '0085', '0178']],
  ['fullbody', 'general', 'intermediate', 'B', 'mixed', ['0743', '0405', '0652', '1757', '0175']],
  ['upper', 'general', 'beginner', null, 'stable', ['0577', '0198', '0603', '1350', '0201']],
  ['upper', 'general', 'intermediate', null, 'free', ['0289', '0292', '0405', '0245', '0294']],
  ['lower', 'general', 'beginner', null, 'stable', ['0739', '0586', '0597', '0605', '1409']],
  ['lower', 'general', 'intermediate', null, 'free', ['0043', '0085', '0410', '0599', '0594']],
  ['push', 'general', 'intermediate', null, 'mixed', ['0025', '0405', '0314', '0178', '0201']],
  ['pull', 'general', 'intermediate', null, 'mixed', ['0652', '0027', '0861', '0203', '0294']],
  ['posterior', 'general', 'beginner', null, 'stable', ['1409', '1459', '0586', '0489']],
  ['posterior', 'general', 'intermediate', null, 'mixed', ['0085', '0593', '0599', '0573']],
  ['abs', 'general', 'beginner', null, 'stable', ['1452', '0276', '3544:time=20']],
  ['abs', 'general', 'intermediate', null, 'mixed', ['0175', '2963', '2133:time=40']],
  ['abs', 'general', 'advanced', null, 'athletic', ['0472', '2135:time=45', '0407', '0175']],
  // ───────── MUSCULAR ENDURANCE (pairs for density)
  ['fullbody', 'endurance', 'beginner', null, 'pairs', [['0739', '0198'], ['0577', '0861'], ['0597', '1452']], { type: 'superset' }],
  ['fullbody', 'endurance', 'intermediate', null, 'pairs', [['1760', '0289'], ['1459', '0292'], ['0431', '0405']], { type: 'superset' }],
  ['lower', 'endurance', 'intermediate', null, 'pairs', [['0739', '0605'], ['0336', '0597']], { type: 'superset' }],
  ['upper', 'endurance', 'intermediate', null, 'pairs', [['0577', '1350'], ['0405', '0198'], ['0294', '0201']], { type: 'superset' }],
  // ───────── START / RETURN (beginner goal)
  ['fullbody', 'beginner', 'beginner', 'A', 'stable', ['0739', '0577', '1350', '0599', '0276']],
  ['fullbody', 'beginner', 'beginner', 'B', 'foundation', ['1760', '1299', '0198', '0489']],
  ['upper', 'beginner', 'beginner', null, 'stable', ['0577', '1350', '0603', '0238']],
  ['lower', 'beginner', 'beginner', null, 'stable', ['0739', '0599', '0598', '0594']],
  // ───────── POWER (not generated for every muscle; lower body only)
  ['lower', 'power', 'intermediate', null, 'athletic', ['0514', '0431']],
  ['lower', 'power', 'advanced', null, 'athletic', ['0053', '0514', '1757']],
  // ───────── CARDIO (existing cardio mode: minutes @ speed)
  ['cardio', 'general', 'beginner', null, 'steady', ['3666:cardio=20@5'], { type: 'cardio' }], // incline walk
  ['cardio', 'general', 'intermediate', null, 'steady', ['0798:cardio=12@22', '2141:cardio=12@8'], { type: 'cardio' }],
  ['cardio', 'endurance', 'intermediate', null, 'low-impact', ['2311:cardio=15@0', '2331:cardio=10@0'], { type: 'cardio' }],
  // ───────── GUIDED (Constructor V2.1): run by the guided executor, paced by `timing`
  // Circuit by time on stable machines — a beginner can keep technique while the clock runs.
  ['fullbody', 'endurance', 'beginner', null, 'circuit', ['0739:time=40', '0577:time=40', '1350:time=40', '0597:time=40', '1452:time=40'],
    { type: 'circuit', timing: { prep: 10, work: 40, rest: 20, rounds: 3, roundRest: 90 } }],
  // Core circuit mixing reps and holds: each entry keeps its own mode.
  ['abs', 'general', 'intermediate', null, 'circuit', ['0175', '0276', '2135:time=30', '3544:time=30'],
    { type: 'circuit', timing: { prep: 10, work: 30, rest: 15, rounds: 3, roundRest: 60 } }],
  // Aerobic intervals on a low-impact machine.
  ['cardio', 'general', 'intermediate', null, 'intervals', ['2141'], { type: 'interval', timing: { prep: 10, work: 60, rest: 60, rounds: 6, roundRest: 0 } }],
  // Tabata pattern on the bike — 20/10 × 8 as a starting point, editable like any timing.
  ['cardio', 'general', 'advanced', null, 'tabata', ['2138'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 8, roundRest: 0 } }],
  // Mobility flows: standing (no floor) and a lower-body one that uses the floor.
  ['fullbody', 'general', 'beginner', null, 'flow', ['1604', '1365', '1271', '0794', '1377'], { type: 'mobility', timing: { prep: 5, work: 40, rest: 5, rounds: 1, roundRest: 0 } }],
  ['lower', 'general', 'intermediate', null, 'flow', ['1511', '1424', '1604', '1377'], { type: 'mobility', timing: { prep: 5, work: 45, rest: 5, rounds: 1, roundRest: 0 } }],

  // ───────── GUIDED ROUTINES V1 — only the pieces the official guided routines are composed of
  // (scripts/protocol/official-routines.matrix.mjs). Warm-ups, cool-downs and mobility: standing
  // ones stay off the floor on purpose, so a "no floor" member still has options.
  ['fullbody', 'general', 'beginner', 'A', 'warmup', ['1368', '0257', '1167'], { type: 'mobility', timing: { prep: 5, work: 30, rest: 5, rounds: 2, roundRest: 0 } }],
  ['fullbody', 'general', 'beginner', 'B', 'cooldown', ['1511', '1424', '3639', '1363', '1346'], { type: 'mobility', timing: { prep: 5, work: 45, rest: 5, rounds: 1, roundRest: 0 } }],
  ['fullbody', 'general', 'intermediate', null, 'flow', ['1604', '1167', '1368', '0794'], { type: 'mobility', timing: { prep: 5, work: 30, rest: 5, rounds: 2, roundRest: 0 } }],
  ['lower', 'general', 'beginner', 'A', 'flow', ['2567', '3533', '1604'], { type: 'mobility', timing: { prep: 5, work: 40, rest: 5, rounds: 2, roundRest: 0 } }],
  ['lower', 'general', 'beginner', 'B', 'warmup', ['1368', '0257', '3533', '1604'], { type: 'mobility', timing: { prep: 5, work: 30, rest: 5, rounds: 1, roundRest: 0 } }],
  ['lower', 'general', 'beginner', 'C', 'flow', ['1424', '3639', '1511'], { type: 'mobility', timing: { prep: 5, work: 45, rest: 5, rounds: 2, roundRest: 0 } }],
  ['calves', 'general', 'beginner', null, 'flow', ['1368', '1377', '1398', '0257'], { type: 'mobility', timing: { prep: 5, work: 40, rest: 5, rounds: 2, roundRest: 0 } }],
  ['shoulders', 'general', 'beginner', null, 'flow', ['1271', '0669', '1405'], { type: 'mobility', timing: { prep: 5, work: 45, rest: 5, rounds: 2, roundRest: 0 } }],
  ['upper', 'general', 'beginner', null, 'flow', ['1365', '0794', '2329', '1363'], { type: 'mobility', timing: { prep: 5, work: 40, rest: 5, rounds: 2, roundRest: 0 } }],
  // Tabata format (20 s / 10 s): a pair alternates for 4 rounds = 8 bouts, 4 minutes; a machine
  // does 8 rounds on its own. Named for the format — see TRAINING_PROTOCOL_2J.md on the name.
  ['fullbody', 'general', 'beginner', 'A', 'tabata', ['3672', '3636'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['fullbody', 'general', 'intermediate', 'A', 'tabata', ['1160', '0630'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['fullbody', 'general', 'intermediate', 'B', 'tabata', ['3224', '0685'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['fullbody', 'general', 'advanced', 'A', 'tabata', ['1160', '3361'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['upper', 'general', 'intermediate', null, 'tabata', ['0493', '3360'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['lower', 'general', 'intermediate', 'A', 'tabata', ['0514', '2368'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['lower', 'general', 'beginner', 'A', 'tabata', ['3769', '3561'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['abs', 'general', 'intermediate', 'A', 'tabata', ['0459', '0687'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['abs', 'general', 'intermediate', 'B', 'tabata', ['3665', '0630'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 4, roundRest: 0 } }],
  ['cardio', 'general', 'intermediate', null, 'tabata', ['2141'], { type: 'hiit', timing: { preset: 'tabata', prep: 10, work: 20, rest: 10, rounds: 8, roundRest: 0 } }],
  // HIIT with its own work/rest (not "many reps, little rest"): bouts of a few moves, 3-4 rounds.
  ['fullbody', 'general', 'beginner', 'B', 'intervals', ['3671', '3636', '0493', '3239'], { type: 'hiit', timing: { prep: 10, work: 30, rest: 30, rounds: 3, roundRest: 0 } }],
  ['fullbody', 'general', 'intermediate', 'C', 'intervals', ['0514', '0630', '3361', '0662'], { type: 'hiit', timing: { prep: 10, work: 40, rest: 20, rounds: 3, roundRest: 60 } }],
  ['fullbody', 'general', 'intermediate', 'D', 'intervals', ['1760', '0630', '0289', '3672'], { type: 'hiit', timing: { prep: 10, work: 40, rest: 20, rounds: 3, roundRest: 60 } }],
  ['fullbody', 'general', 'advanced', 'B', 'intervals', ['1160', '3360', '0514', '3665'], { type: 'hiit', timing: { prep: 10, work: 45, rest: 15, rounds: 4, roundRest: 60 } }],
  ['lower', 'general', 'intermediate', 'B', 'intervals', ['3769', '2368', '3561', '3636'], { type: 'hiit', timing: { prep: 10, work: 40, rest: 20, rounds: 3, roundRest: 60 } }],
  // Circuits: each exercise keeps its own mode (reps prescribed by the protocol, or a timed hold).
  ['fullbody', 'general', 'beginner', null, 'circuit', ['0739', '1299', '0198', '0599', '3544:time=20'], { type: 'circuit', timing: { prep: 10, work: 20, rest: 30, rounds: 3, roundRest: 90 } }],
  ['fullbody', 'general', 'intermediate', 'A', 'circuit', ['1760', '0289', '0292', '1459', '3665:time=30'], { type: 'circuit', timing: { prep: 10, work: 30, rest: 20, rounds: 3, roundRest: 90 } }],
  ['fullbody', 'general', 'intermediate', 'B', 'circuit', ['0739', '3671:time=30', '1350', '3636:time=30', '0577'], { type: 'circuit', timing: { prep: 10, work: 30, rest: 20, rounds: 3, roundRest: 90 } }],
  ['fullbody', 'endurance', 'beginner', 'A', 'circuit', ['2368', '0493', '3561', '3239:time=20', '3671:time=30'], { type: 'circuit', timing: { prep: 10, work: 30, rest: 20, rounds: 2, roundRest: 60 } }],
  ['fullbody', 'endurance', 'advanced', null, 'circuit', ['1760', '0662', '1757', '3360:time=30', '0630:time=30'], { type: 'circuit', timing: { prep: 10, work: 30, rest: 15, rounds: 3, roundRest: 60 } }],
  ['lower', 'endurance', 'intermediate', null, 'circuit', ['2368', '1459', '3561:time=30', '0605'], { type: 'circuit', timing: { prep: 10, work: 30, rest: 20, rounds: 3, roundRest: 75 } }],
  ['upper', 'endurance', 'intermediate', null, 'circuit', ['0493', '1350', '0405', '0294', '0201'], { type: 'circuit', timing: { prep: 10, work: 30, rest: 20, rounds: 3, roundRest: 75 } }],
  ['abs', 'general', 'beginner', null, 'circuit', ['0276', '3239:time=20', '3544:time=20', '0274'], { type: 'circuit', timing: { prep: 10, work: 20, rest: 15, rounds: 2, roundRest: 45 } }],
  // Cardio intervals on the machines 2J has (bike, stepmill, incline treadmill, treadmill, cross trainer).
  ['cardio', 'general', 'beginner', null, 'intervals', ['2138'], { type: 'interval', timing: { prep: 10, work: 60, rest: 60, rounds: 6, roundRest: 0 } }],
  ['cardio', 'endurance', 'beginner', null, 'intervals', ['3666'], { type: 'interval', timing: { prep: 10, work: 180, rest: 60, rounds: 4, roundRest: 0 } }],
  ['cardio', 'endurance', 'intermediate', null, 'intervals', ['2311'], { type: 'interval', timing: { prep: 10, work: 120, rest: 60, rounds: 5, roundRest: 0 } }],
  ['cardio', 'general', 'advanced', null, 'intervals', ['0684'], { type: 'interval', timing: { prep: 10, work: 30, rest: 90, rounds: 8, roundRest: 0 } }],
  ['cardio', 'endurance', 'advanced', null, 'intervals', ['2331'], { type: 'interval', timing: { prep: 10, work: 240, rest: 120, rounds: 4, roundRest: 0 } }],
]

// Per-block seed revisions: a block whose content changed after v1 of the seed carries its own
// version, so an admin override of THAT block is flagged `seedChanged` — and no other.
export const REVISIONS = {
  'off-glutes-hypertrophy-intermediate-a': 2, // 1409 glute bridge → 0058 barbell hip thrust
  'off-glutes-hypertrophy-advanced-a': 2,     // 1409 glute bridge → 0058 barbell hip thrust
}
