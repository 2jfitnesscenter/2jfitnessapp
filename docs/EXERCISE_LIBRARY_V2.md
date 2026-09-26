# Exercise Library V2

Canonical movements, variants, normalised equipment and discovery — on top of the existing
exercise dataset, without rebuilding it. The numbers below come from
[EXERCISE_LIBRARY_AUDIT.md](EXERCISE_LIBRARY_AUDIT.md), which is generated.

## The one rule: identity never changes

An exercise **is** its dataset id (`frontend/src/lib/exercises-data.js`). V2 adds metadata on top;
it never renames an id, deletes a record, migrates history, rewrites a workout, a routine snapshot
or a PR. A deprecated duplicate keeps resolving everywhere with its own name.

## Architecture

| Layer | File | Shared with the API |
|---|---|---|
| Upstream data (ids, names, media, instructions) | `lib/exercises-data.js`, `names/es.js` | via `scripts/build-coach-library.mjs` |
| Movement and equipment taxonomy | `lib/protocol/movements.js` | yes (`scripts/sync-protocol.mjs`, 9 protocol files) |
| Pattern classifier (curated catalogue + readable name rules) | `lib/protocol/classify.js`, `catalog.js` | yes |
| 2J decisions (deprecations, extra recommended, aliases, overrides, reviewed variants) | `lib/library/overrides.js` | via the coach index |
| Pure core: facets, recommended, preferred, similar variants, integrity check | `lib/library/core.js` | used by the Node scripts |
| App layer: search, families, favourites/recents, scopes | `lib/library/index.js` | no |

`facetsOf(ex)` = `{ movement, pattern, variant, equipment, kind, uni, angle, group, curated,
recommended, deprecated, preferredId }` — memoised for dataset records, computed on demand for a
member's custom exercises.

## Canonical movement

35 movements (`MOVEMENTS`), derived from the patterns the 2J library really uses — e.g. `squat`
(squat + leg press), `hinge`, `hip_thrust`, `horizontal_push`, `horizontal_pull`, `vertical_pull`,
`elbow_flexion`, `wrist`, `core_lateral`, `conditioning`, `cardio`, `mobility`. A movement comes from
the curated pattern (catalog.js) or from classify.js's name rules; it is never guessed by a model.
71 exercises (5 %) stay without one and live only in the master library.

Stretches are `mobility` (never direct volume); cardio records without a cardio machine (burpees,
jumping jacks) are `conditioning`; wrist curls are `wrist`, not biceps curls.

## Equipment taxonomy

28 canonical ids in six kinds (`free`, `machine`, `cable`, `bodyweight`, `accessory`, `cardio`),
mapped from the dataset's `eq` strings (`olympic barbell` → `barbell`, `leverage machine` →
`machine`…). More precise ids only with evidence: `0576` plate-loaded, `0577` weight stack (images),
`0798` bike, `2331` elliptical (their own names). The dataset's `eq` is left unchanged, so official
routines and gym availability keep reading what they read.

## Variants and families

A family is a movement; a variant is one exercise of it, described by equipment · angle · one side
(`variantLabel`). Plan › Exercises shows **2J exercises** as family cards by region; a family opens
Recommended 2J first and "More variants" from the master library.

## Recommended 2J vs master

- **Recommended 2J** (179) = the curated protocol catalogue (161, what the official blocks use) +
  a short extension of staples (`EXTRA_RECOMMENDED`). Each has a movement, equipment, image and
  Spanish name — the check fails otherwise.
- **Master** = all 1324. One tap away ("See the full library", "Full library" in the picker); a
  search with nothing in 2J offers the master results instead of a dead end.

## Deprecation (safe)

11 real duplicates (the same exercise filmed twice: camera angle, female/male model, trivial prop),
confirmed against the dataset images, get `deprecated → preferredId`. Effects:

- normal search, pickers, swaps, families, the AI: never offered (master: shown last, tagged);
- history, PRs, old routines, imports: unchanged — an import resolving to one is filed under the
  preferred id;
- none is used by an official block or guided routine (the check enforces it).

Pairs that shared a name but are different exercises (7) were renamed apart instead.

## Aliases and imports

`ALIASES` holds the Spanish vocabulary and historical names (e.g. the mojibake `sled 45в° leg
press`, `run (equipment)`); each alias maps to exactly one live id and never to another
exercise's name. Import order: curated English alias → 2J alias → exact translated name → exact
dataset name → word bag only when exactly one candidate. Accents are folded, not dropped. Ties come
back as candidates for the member to choose — never guessed.

## Search

Deterministic, no model: every query word must match (exact, prefix, or a short stem for
plurals) across name (EN + ES), aliases, movement, muscle group, target, equipment (EN + ES labels).
Recommended first, deprecated last. "remo máquina", "glúteo barra", "bisagra", "hip thrust",
"treadmill" are covered by tests.

## Swap

`similarVariants` = same canonical movement only, ranked by pattern, equipment, laterality and
angle, Recommended 2J on ties, with the reasons shown ("Same pattern · Same machine type"). It
never claims biomechanical equivalence. `getReplacementGroups` puts these "Similar variants" first,
then the muscle-based alternatives; used by the workout, RoutineEdit, the trainer routine builder,
the Constructor (DayCanvas replace) and the Bunker (same sheet, its flow unchanged).

## AI and validator

- `api/coach/library.json` adds `mv` (movement), `rec` (Recommended 2J), `pref` (preferred id).
  `librarySlice` never offers a deprecated duplicate and lists Recommended first; the prompt asks to
  prefer them. Old plans naming a deprecated id still validate.
- The validator adds a **note** `high_overlap` (same movement + equipment + side + angle under
  different ids). Notes do not change PASS / PASS_WITH_REASON; the official seeds are untouched.
  Protocol version stays 1.0 (no methodology change).

## Favourites and recents

`S.favEx` (saved like `S.excludedEx`, no new sync); recents are read from real workouts.

## Checks

- `node scripts/check-exercise-library.mjs` — fails on duplicate id, invalid movement/equipment,
  missing preferred id, deprecation chain/cycle, deprecated id in an official seed, ambiguous or
  dangerous alias, two live exercises sharing a name, incomplete Recommended 2J.
- `node scripts/audit-exercise-library.mjs [--check]` — the reproducible audit.
- `node scripts/build-coach-library.mjs --check`, `node scripts/sync-protocol.mjs --check`.

## Limitations

- 71 exercises without a movement; 24 possible-duplicate groups (version "v. N" variants) reported,
  not decided.
- `leverage machine` stays generic `machine` where no evidence says weight stack or plate-loaded.
- Aliases are Spanish + English only; other languages search their translated name and English.
- Admin reviews metadata (read-only review filters); decisions are versioned in code, not edited in
  the app.

## Towards Gym Profiles

Equipment kinds and canonical ids are the vocabulary a profile needs ("this gym / home / hotel has
these"). The current gym-wide `unavailableEquipment` (dataset `eq` strings) still applies; a profile
would map canonical ids to availability and feed `isUnavailable`, the picker priority and the AI
slice.
