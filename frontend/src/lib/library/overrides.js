// Copyright (C) 2026 Juan Jose Perez Sanchez — 2J Fitness Center
// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercise Library V2 — the 2J layer over the upstream exercise dataset. Versioned in code,
// checked by scripts/check-exercise-library.mjs. Nothing here changes an id, deletes a record or
// touches history: it only adds what the dataset cannot say about itself.
//
// Every decision below has evidence recorded next to it (the dataset's own images and names were
// compared). "Not sure" stays out: a possible duplicate is reported by the audit, not deprecated.

export const LIBRARY_VERSION = 1

/**
 * Real duplicates (class A in docs/EXERCISE_LIBRARY_V2.md): the same exercise filmed twice.
 * deprecated id → preferred id. The deprecated id keeps working everywhere (history, PRs, old
 * routines, imports); it is only hidden from normal search and new selections, and an import
 * that resolves to it is filed under the preferred id instead.
 */
export const DEPRECATED = {
  '1731': '0296', // dumbbell close grip press = close-grip press on a flat bench, other camera
  '0108': '1372', // barbell standing (leg) calf raise, toes elevated, other camera
  '0382': '1654', // dumbbell reverse-grip biceps curl, standing, identical frames
  '1680': '0422', // one-arm curl over an incline bench, other camera
  '2800': '2799', // same seated barbell leg raise, female model
  '2801': '2802', // same captain's-chair twisted leg raise, female model
  '1461': '0043', // barbell full squat (back pov) — a camera angle of 0043
  '1462': '0043', // barbell full squat (side pov)
  '1463': '0739', // sled 45° leg press (side pov)
  '1464': '0739', // sled 45° leg press (back pov)
  '1765': '0437', // dumbbell upright row (back pov)
  '0312': '0313', // identical dataset steps, implement, movement and target: hammer curl v. 2
  '0395': '0396', // identical dataset steps, implement, movement and target: seated lateral raise v. 2
  '2318': '0869', // identical dataset steps, implement, movement and target: lever shoulder press v. 3
}

/**
 * Recommended 2J = the curated catalogue (lib/protocol/catalog.js — what the official blocks are
 * built from) plus this controlled extension: common gym staples with a correct name, a clear
 * movement and a real image. Kept short on purpose; the master library stays one tap away.
 */
export const EXTRA_RECOMMENDED = [
  '0576', // plate-loaded chest press (the weight-stack one, 0577, is curated)
  '0033', '0301', // decline bench press — barbell, dumbbells
  '0770', // Smith machine squat
  '0117', // sumo deadlift
  '0095', // barbell shrug
  '0162', // cable front raise
  '0673', '0818', // machine lat pulldown (reverse grip), parallel-grip pulldown
  '0979', // band Pallof press
  '0226', // cable standing crunch
  '0684', '3666', '2138', '2141', '2331', '2311', '0798', // cardio machines used in 2J sessions
  '0128', // battling ropes: clear conditioning intervals
  '0500', // isometric wipers: clear core rotation
  '1362', // sphinx: simple floor mobility
]

/** Movement where the dataset's body part / target is misleading (ergometers filed under chest/arms). */
export const MOVEMENT_OVERRIDE = {
  '2139': 'cardio', '2142': 'cardio',
  '1408': 'hip_thrust', // band hip lift: steps describe a glute bridge
  '0128': 'conditioning', '2271': 'conditioning', '3552': 'conditioning', '1354': 'conditioning', '2459': 'conditioning',
  '1017': 'rear_delt', '0191': 'rear_delt', '3542': 'rear_delt', '3541': 'rear_delt', '0341': 'rear_delt',
  '0050': 'front_raise', '0759': 'front_raise',
  '0325': 'vertical_push', '0328': 'vertical_push', // incline 'raise' instructions actually press overhead
  '0332': 'lateral_raise', '0408': 'lateral_raise', '0844': 'lateral_raise',
  '0863': 'shoulder_rotation', '0339': 'knee_flexion', '0628': 'hip_abduction', '0624': 'squat',
  '0466': 'vertical_pull', '0680': 'vertical_pull',
  '1418': 'mobility', '1582': 'mobility', '1587': 'mobility', '2203': 'mobility', '2209': 'mobility', '1362': 'mobility', '1364': 'mobility', '1366': 'mobility',
  '0500': 'core_rotation', '1416': 'core_rotation', '3669': 'core_rotation',
  '1297': 'chest_fly', '0555': 'core_flexion', '0730': 'lunge', '3433': 'core_anti_extension',
  '1302': 'horizontal_push', '1303': 'horizontal_push', '1304': 'horizontal_push', '1305': 'horizontal_push',
}

/**
 * Search and import aliases — the words members and other apps actually use, Spanish first.
 * Each alias must point to exactly one id (the check fails on an alias shared by two ids).
 * Import matching already has the English vocabulary (lib/import-csv.js ALIAS_EX); these add
 * the Spanish one and the names an exercise had before a 2J correction.
 */
export const ALIASES = {
  '0025': ['press banca', 'press de banca', 'press plano'],
  '0047': ['press inclinado', 'press banca inclinado'],
  '0033': ['press declinado', 'press banca declinado'],
  '0289': ['press con mancuernas', 'press banca con mancuernas'],
  '0043': ['sentadilla', 'sentadilla trasera', 'sentadilla con barra'],
  '0042': ['sentadilla frontal'],
  '1760': ['sentadilla goblet', 'goblet'],
  '0743': ['sentadilla hack', 'hack squat', 'hack'],
  '0739': ['prensa', 'prensa de piernas', 'prensa 45', 'sled 45в° leg press'],
  '0738': ['sled 45в° calf press'],
  '0740': ['sled 45в° leg wide press'],
  '0032': ['peso muerto'],
  '0085': ['peso muerto rumano', 'rumano'],
  '0117': ['peso muerto sumo'],
  '0058': ['hip thrust con barra', 'empuje de cadera'],
  '1409': ['puente de gluteos', 'puente de gluteo con barra'],
  '0652': ['dominadas', 'dominada prona'],
  '1326': ['dominadas supinas', 'chin up'],
  '0198': ['jalon', 'jalon al pecho', 'jalon polea'],
  '0027': ['remo con barra'],
  '0292': ['remo con mancuerna', 'remo a una mano'],
  '0861': ['remo en polea', 'remo gironda', 'remo sentado en polea'],
  '1350': ['remo en maquina'],
  '0091': ['press militar'],
  '0405': ['press de hombro con mancuernas'],
  '0334': ['elevaciones laterales', 'laterales'],
  '0294': ['curl de biceps', 'curl con mancuernas'],
  '0031': ['curl con barra'],
  '0313': ['curl martillo'],
  '0201': ['extension de triceps en polea', 'jalon de triceps'],
  '0251': ['fondos', 'fondos en paralelas'],
  '0586': ['curl femoral'],
  '0585': ['extension de cuadriceps', 'extensiones de pierna'],
  '0336': ['zancadas', 'zancada'],
  '1372': ['elevacion de gemelos'],
  '0308': ['aperturas'],
  '0274': ['abdominales', 'crunch'],
  '0095': ['encogimientos'],
  '0684': ['run (equipment)', 'correr en cinta', 'cinta'],
  '3666': ['caminar en cinta', 'cinta inclinada'],
  '2138': ['bici', 'bicicleta', 'bici estatica'],
  '2141': ['eliptica'],
  '2311': ['escaladora', 'stepmill'],
  '0128': ['cuerdas de batalla'],
  '0500': ['limpiaparabrisas isometricos'],
  '1362': ['postura de la esfinge'],
}

export const aliasCountOf = id => (ALIASES[id] || []).length

/**
 * Pairs that share a name in the dataset but are different exercises (class B), checked against
 * the dataset's images — kept as separate variants and renamed apart in the data itself.
 * The audit marks them "reviewed" instead of "possible duplicate".
 */
export const REVIEWED_VARIANTS = [
  ['0576', '0577'], // plate-loaded vs weight-stack chest press
  ['0454', '1628'], // spider curl lying on an incline bench vs standing on a stand
  ['0655', '0656'], // push-up hands on the ball vs feet on the ball
  ['0088', '1371'], // seated calf raise flat vs toes elevated
  ['0763', '1394'], // Smith calf raise, bar on back on a step vs bar in front
  ['0746', '0767'], // Smith shrug behind vs in front
  ['0697', '1766'], // nordic curl anchored on a machine vs on a bench (class C: kept, not deprecated)
  ['0098', '0097'], // stationary wide squat vs lateral step into a squat (dataset instructions)
  ['0318', '0317'], // upper arms supported on incline bench vs arms free
  ['1471', '3698'], // hands walk out and back vs travelling with feet towards hands
  ['1452', '3760'], // separate crunch machine setups, only second has secured feet
]
