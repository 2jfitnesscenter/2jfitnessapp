// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
/* Coverage matrix of the official 2J guided routines — "Entrena con 2J" (Guided Routines V1).
 *
 * A guided routine is a complete, ready-to-start workout; a block is one piece of a workout.
 * Every routine here is COMPOSED of official blocks (scripts/protocol/official-blocks.matrix.mjs)
 * — warm-up, main part, cool-down — and never lists exercises of its own. The build
 * (scripts/build-official-routines.mjs) copies each block in as a versioned snapshot (the same
 * instantiateBlock the builder uses), validates the whole routine under the 2J protocol, checks
 * diversity, and writes api/lib/guided-official.json.
 *
 * Human-reviewable on purpose. Why these families (a product decision, not science):
 *   Tabata-format and HIIT for short conditioning; circuits for strength-endurance on the gym's
 *   machines, dumbbells or no equipment; cardio intervals on the machines 2J has; mobility for
 *   before/after training and specific areas; a few mixed strength + cardio sessions; core.
 *   Levels only where the session really changes (moves, density, coordination) — no clones.
 *
 * Text (name, subtitle, description) is an English source string rendered through t() — the
 * Spanish lives in frontend/src/locales/es.js like every other UI string.
 *
 * Row fields: id, category, name, subtitle, description, goal, level, focus, parts[[role, blockId]],
 * lowImpact? (curated; the build verifies no jumps and no running in it).
 */
const W = 'off-fullbody-general-beginner-a-mobility'          // activation: ankles, knees, chest · standing · ~3 min
const W_LEGS = 'off-lower-general-beginner-b-mobility'         // lower-body activation
const COOL = 'off-fullbody-general-beginner-x-mobility'        // standing cool-down flow
const RECOVER = 'off-fullbody-general-beginner-b-mobility'     // floor recovery

export const ROUTINES = [
  // ───────── TABATA FORMAT (20 s / 10 s)
  { id: 'r2j-tabata-start', category: 'tabata', name: 'Tabata · First steps', subtitle: 'No jumps · no equipment',
    description: 'Your first 20/10 intervals: steps and wall high knees, easy to keep clean.', goal: 'general', level: 'beginner', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-beginner-a-hiit']], lowImpact: true },
  { id: 'r2j-tabata-nojumps', category: 'tabata', name: 'Tabata · No jumps', subtitle: 'Three blocks, whole body',
    description: 'Twelve minutes of 20/10 work for legs, chest and the whole body without a single jump.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-beginner-a-hiit'], ['main', 'off-lower-general-beginner-a-hiit'], ['main', 'off-upper-general-intermediate-x-hiit']], lowImpact: true },
  { id: 'r2j-tabata-fullbody', category: 'tabata', name: 'Tabata · Full body', subtitle: 'Burpees, jumps and core',
    description: 'The classic 20/10 format across the whole body: a demanding session in under twenty minutes.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-intermediate-a-hiit'], ['main', 'off-lower-general-intermediate-a-hiit'], ['main', 'off-abs-general-intermediate-a-hiit']] },
  { id: 'r2j-tabata-lower', category: 'tabata', name: 'Tabata · Lower body', subtitle: 'Squats, lunges and bridges',
    description: 'Two 20/10 blocks for legs and glutes after a short lower-body activation.', goal: 'general', level: 'intermediate', focus: 'lower',
    parts: [['warmup', W_LEGS], ['main', 'off-lower-general-intermediate-a-hiit'], ['main', 'off-lower-general-beginner-a-hiit']] },
  { id: 'r2j-tabata-core', category: 'tabata', name: 'Tabata · Core', subtitle: 'Two blocks · floor',
    description: 'Flutter kicks, Russian twists, plank taps and climbers in 20/10.', goal: 'general', level: 'intermediate', focus: 'core',
    parts: [['warmup', W], ['main', 'off-abs-general-intermediate-a-hiit'], ['main', 'off-abs-general-intermediate-b-hiit']] },
  { id: 'r2j-tabata-bike', category: 'tabata', name: 'Tabata · Bike', subtitle: '20/10 × 8 on the bike',
    description: 'Eight 20-second efforts on the stationary bike with 10 seconds easy between them.', goal: 'general', level: 'advanced', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-general-advanced-x-hiit'], ['cooldown', COOL]], lowImpact: true },
  { id: 'r2j-tabata-elliptical', category: 'tabata', name: 'Tabata · Elliptical', subtitle: '20/10 × 8 · low impact',
    description: 'The 20/10 format on the elliptical: hard efforts without impact on the joints.', goal: 'general', level: 'intermediate', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-general-intermediate-x-hiit'], ['cooldown', COOL]], lowImpact: true },
  { id: 'r2j-tabata-advanced', category: 'tabata', name: 'Tabata · Advanced', subtitle: 'Four blocks · jumps',
    description: 'Four 20/10 blocks with burpees, skater hops, jacks and jump squats. For people who already know the format.', goal: 'general', level: 'advanced', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-advanced-a-hiit'], ['main', 'off-fullbody-general-intermediate-b-hiit'], ['main', 'off-lower-general-intermediate-a-hiit'], ['main', 'off-abs-general-intermediate-b-hiit']] },

  // ───────── HIIT (own work/rest per block)
  { id: 'r2j-hiit-lowimpact', category: 'hiit', name: 'HIIT · Low impact', subtitle: '30 s on / 30 s off',
    description: 'Steps, wall high knees, incline push-ups and plank taps. Intense without jumping.', goal: 'general', level: 'beginner', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-beginner-b-hiit'], ['cooldown', COOL]], lowImpact: true },
  { id: 'r2j-hiit-fullbody', category: 'hiit', name: 'HIIT · Full body', subtitle: '40 s on / 20 s off',
    description: 'Jump squats, climbers, skater hops and push-ups: three rounds with a minute between them.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-intermediate-c-hiit'], ['cooldown', COOL]] },
  { id: 'r2j-hiit-express', category: 'hiit', name: 'HIIT · Express with dumbbells', subtitle: 'Strength moves on the clock',
    description: 'Goblet squats and presses mixed with climbers and steps, 40/20 for three rounds.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-intermediate-d-hiit']] },
  { id: 'r2j-hiit-lower', category: 'hiit', name: 'HIIT · Lower body, no jumps', subtitle: 'Lunges, bridges, high knees',
    description: 'Hard lower-body intervals without jumping, finished with hip mobility on the floor.', goal: 'general', level: 'intermediate', focus: 'lower',
    parts: [['warmup', W_LEGS], ['main', 'off-lower-general-intermediate-b-hiit'], ['cooldown', 'off-lower-general-beginner-c-mobility']], lowImpact: true },
  { id: 'r2j-hiit-advanced', category: 'hiit', name: 'HIIT · Advanced', subtitle: '45 s on / 15 s off × 4',
    description: 'Burpees, bear crawls, jump squats and plank taps with short rests, then core and a floor cool-down.', goal: 'general', level: 'advanced', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-advanced-b-hiit'], ['main', 'off-abs-general-intermediate-a-hiit'], ['cooldown', RECOVER]] },
  { id: 'r2j-hiit-machines', category: 'hiit', name: 'HIIT · Two machines', subtitle: 'Elliptical, then bike',
    description: 'Two 20/10 blocks: eight efforts on the elliptical and eight on the bike.', goal: 'general', level: 'advanced', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-general-intermediate-x-hiit'], ['main', 'off-cardio-general-advanced-x-hiit'], ['cooldown', COOL]], lowImpact: true },

  // ───────── CIRCUITS
  { id: 'r2j-circuit-machines-start', category: 'circuit', name: 'Circuit · Machines, first steps', subtitle: 'Guided machines · 3 rounds',
    description: 'Leg press, chest press, pulldown and leg curl by reps, with a side plank. A safe way into circuits.', goal: 'general', level: 'beginner', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-beginner-x-circuit'], ['cooldown', 'off-fullbody-general-beginner-x-mobility']] },
  { id: 'r2j-circuit-machines-time', category: 'circuit', name: 'Circuit · Machines against the clock', subtitle: '40 s per machine',
    description: 'Five machines, forty seconds each, three rounds. Steady, controlled work.', goal: 'endurance', level: 'beginner', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-endurance-beginner-x-circuit']] },
  { id: 'r2j-circuit-dumbbells', category: 'circuit', name: 'Circuit · Dumbbells, full body', subtitle: 'Squat, press, row, hinge',
    description: 'A full-body circuit with dumbbells by reps and a timed plank to close each round.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-intermediate-a-circuit'], ['cooldown', COOL]] },
  { id: 'r2j-circuit-bodyweight', category: 'circuit', name: 'Circuit · No equipment', subtitle: 'Bodyweight · 2 rounds',
    description: 'Split squats, incline push-ups, bridges, a kneeling plank and ski steps. Only your body.', goal: 'endurance', level: 'beginner', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-endurance-beginner-a-circuit']] },
  { id: 'r2j-circuit-lower', category: 'circuit', name: 'Circuit · Lower body', subtitle: 'Reps and timed bridges',
    description: 'Split squats, Romanian deadlifts, marching bridges and calf raises, then hip mobility.', goal: 'endurance', level: 'intermediate', focus: 'lower',
    parts: [['warmup', W_LEGS], ['main', 'off-lower-endurance-intermediate-x-circuit'], ['cooldown', 'off-lower-general-beginner-c-mobility']] },
  { id: 'r2j-circuit-upper', category: 'circuit', name: 'Circuit · Upper body', subtitle: 'Push, pull, press, arms',
    description: 'Five upper-body stations for three rounds, then shoulder mobility.', goal: 'endurance', level: 'intermediate', focus: 'upper',
    parts: [['warmup', W], ['main', 'off-upper-endurance-intermediate-x-circuit'], ['cooldown', 'off-shoulders-general-beginner-x-mobility']] },
  { id: 'r2j-circuit-advanced', category: 'circuit', name: 'Circuit · Advanced full body', subtitle: 'Dumbbells, push-ups, crawls',
    description: 'A dense full-body circuit mixing reps and timed conditioning, with a floor cool-down.', goal: 'endurance', level: 'advanced', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-endurance-advanced-x-circuit'], ['cooldown', RECOVER]] },

  // ───────── STRENGTH + CARDIO
  { id: 'r2j-mixed-circuit-hiit', category: 'mixed', name: 'Strength + cardio · Circuit and HIIT', subtitle: 'Machines, then dumbbells on the clock',
    description: 'A machine circuit with cardio bursts, followed by a dumbbell HIIT block.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-intermediate-b-circuit'], ['main', 'off-fullbody-general-intermediate-d-hiit']] },
  { id: 'r2j-mixed-strength-intervals', category: 'mixed', name: 'Strength + cardio · Full body and bike', subtitle: 'Straight sets, then intervals',
    description: 'A full-body strength block with prescribed rest, then easy bike intervals to finish.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['warmup', W], ['main', 'off-fullbody-general-intermediate-b'], ['main', 'off-cardio-general-beginner-x-interval']] },

  // ───────── CORE
  { id: 'r2j-core-start', category: 'core', name: 'Core · First steps', subtitle: 'Floor · 2 rounds',
    description: 'Dead bugs, a kneeling plank, side planks and crunches: a short, controlled core session.', goal: 'general', level: 'beginner', focus: 'core',
    parts: [['warmup', W], ['main', 'off-abs-general-beginner-x-circuit']] },
  { id: 'r2j-core-circuit', category: 'core', name: 'Core · Circuit', subtitle: 'Cable, plank, side plank',
    description: 'Cable crunches and dead bugs by reps, planks against the clock, three rounds.', goal: 'general', level: 'intermediate', focus: 'core',
    parts: [['warmup', W], ['main', 'off-abs-general-intermediate-x-circuit']] },

  // ───────── CARDIO INTERVALS
  { id: 'r2j-intervals-bike-start', category: 'interval', name: 'Intervals · Bike, first steps', subtitle: '1 min on / 1 min easy',
    description: 'Six one-minute efforts on the bike with a minute easy between them.', goal: 'general', level: 'beginner', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-general-beginner-x-interval'], ['cooldown', COOL]], lowImpact: true },
  { id: 'r2j-intervals-incline-walk', category: 'interval', name: 'Intervals · Incline walk', subtitle: '3 min on / 1 min easy',
    description: 'Four three-minute blocks of brisk incline walking on the treadmill.', goal: 'endurance', level: 'beginner', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-endurance-beginner-x-interval']], lowImpact: true },
  { id: 'r2j-intervals-elliptical', category: 'interval', name: 'Intervals · Elliptical', subtitle: '1 min on / 1 min easy',
    description: 'Six one-minute pushes on the elliptical, easy recovery between them.', goal: 'general', level: 'intermediate', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-general-intermediate-x-interval'], ['cooldown', COOL]], lowImpact: true },
  { id: 'r2j-intervals-stepmill', category: 'interval', name: 'Intervals · Stepmill', subtitle: '2 min on / 1 min easy',
    description: 'Five two-minute climbs on the stepmill.', goal: 'endurance', level: 'intermediate', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-endurance-intermediate-x-interval'], ['cooldown', COOL]], lowImpact: true },
  { id: 'r2j-intervals-treadmill', category: 'interval', name: 'Intervals · Treadmill, short', subtitle: '30 s fast / 90 s easy',
    description: 'Eight short, fast runs on the treadmill with long easy recoveries.', goal: 'general', level: 'advanced', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-general-advanced-x-interval'], ['cooldown', COOL]] },
  { id: 'r2j-intervals-cross-long', category: 'interval', name: 'Intervals · Cross trainer, long', subtitle: '4 min on / 2 min easy',
    description: 'Four long efforts on the cross trainer for sustained work.', goal: 'endurance', level: 'advanced', focus: 'cardio',
    parts: [['warmup', W], ['main', 'off-cardio-endurance-advanced-x-interval'], ['cooldown', COOL]], lowImpact: true },

  // ───────── MOBILITY (moving better; never treatment)
  { id: 'r2j-mobility-fullbody', category: 'mobility', name: 'Mobility · Full body', subtitle: 'Standing, then floor',
    description: 'A standing flow from hips to shoulders, then hips and hamstrings on the floor.', goal: 'general', level: 'beginner', focus: 'fullbody',
    parts: [['main', 'off-fullbody-general-beginner-x-mobility'], ['main', 'off-lower-general-beginner-c-mobility']], lowImpact: true },
  { id: 'r2j-mobility-hips', category: 'mobility', name: 'Mobility · Hips', subtitle: 'Floor and standing',
    description: 'Glutes, hamstrings and hip rotation on the floor, then hips and quads standing.', goal: 'general', level: 'beginner', focus: 'lower',
    parts: [['main', 'off-lower-general-beginner-c-mobility'], ['main', 'off-lower-general-beginner-a-mobility']], lowImpact: true },
  { id: 'r2j-mobility-ankles', category: 'mobility', name: 'Mobility · Ankles and calves', subtitle: 'Standing · express',
    description: 'Ankle and knee circles and two calf stretches.', goal: 'general', level: 'beginner', focus: 'lower',
    parts: [['main', 'off-calves-general-beginner-x-mobility']], lowImpact: true },
  { id: 'r2j-mobility-shoulders', category: 'mobility', name: 'Mobility · Shoulders', subtitle: 'Standing · 2 rounds',
    description: 'Chest opener, front and back of the shoulder, and lats against a bench.', goal: 'general', level: 'beginner', focus: 'upper',
    parts: [['main', 'off-shoulders-general-beginner-x-mobility']], lowImpact: true },
  { id: 'r2j-mobility-upper-back', category: 'mobility', name: 'Mobility · Upper back', subtitle: 'Standing and seated',
    description: 'Upper-back and side stretches, then a seated twist and reach.', goal: 'general', level: 'beginner', focus: 'upper',
    parts: [['main', 'off-upper-general-beginner-x-mobility']], lowImpact: true },
  { id: 'r2j-mobility-pre', category: 'mobility', name: 'Mobility · Before training', subtitle: 'Activation + hips',
    description: 'A standing activation from feet to shoulders, then hips, before you lift.', goal: 'general', level: 'beginner', focus: 'fullbody',
    parts: [['main', W], ['main', 'off-lower-general-beginner-a-mobility']], lowImpact: true },
  { id: 'r2j-mobility-post', category: 'mobility', name: 'Mobility · After training', subtitle: 'Easy · floor',
    description: 'Slow floor stretches for legs, hips and back, then calves and ankles.', goal: 'general', level: 'beginner', focus: 'fullbody',
    parts: [['main', RECOVER], ['main', 'off-calves-general-beginner-x-mobility']], lowImpact: true },
  { id: 'r2j-mobility-express', category: 'mobility', name: 'Mobility · Express', subtitle: 'Four moves, standing',
    description: 'A quick standing reset: lunge stretch, chest opener, ankles and side stretch.', goal: 'general', level: 'intermediate', focus: 'fullbody',
    parts: [['main', 'off-fullbody-general-intermediate-x-mobility']], lowImpact: true },
]

// Collections organise the catalogue (they are not multi-week programs). `auto` resolves at build
// time into a fixed, reviewable list (admins can still edit membership afterwards).
export const COLLECTIONS = [
  { id: 'c2j-start', name: 'Start here', description: 'Short, clear sessions to get to know guided training.', style: 'start',
    routineIds: ['r2j-tabata-start', 'r2j-hiit-lowimpact', 'r2j-circuit-machines-start', 'r2j-circuit-bodyweight', 'r2j-intervals-bike-start', 'r2j-core-start', 'r2j-mobility-fullbody'] },
  { id: 'c2j-tabata', name: '2J Tabata', description: 'The 20/10 format, from first steps to advanced.', style: 'tabata', auto: { category: 'tabata' } },
  { id: 'c2j-hiit', name: '2J HIIT', description: 'Hard intervals with their own work and rest.', style: 'hiit', auto: { category: ['hiit', 'mixed'] } },
  { id: 'c2j-circuits', name: '2J Circuits', description: 'Stations one after another: machines, dumbbells or no equipment.', style: 'circuit', auto: { category: ['circuit', 'core'] } },
  { id: 'c2j-cardio', name: '2J Cardio', description: 'Intervals on the bike, elliptical, stepmill and treadmill.', style: 'interval',
    auto: { category: 'interval' }, extra: ['r2j-tabata-bike', 'r2j-tabata-elliptical', 'r2j-hiit-machines'] },
  { id: 'c2j-mobility', name: '2J Mobility', description: 'Move better before or after training.', style: 'mobility', auto: { category: 'mobility' } },
  { id: 'c2j-express', name: '2J Express', description: 'For when you have ten minutes.', style: 'express', auto: { maxMinutes: 10, notCategory: 'mobility' } },
]

// Editorial picks for the hero, in order (admins can change them).
export const FEATURED = ['r2j-tabata-fullbody', 'r2j-mobility-hips', 'r2j-hiit-lowimpact']
