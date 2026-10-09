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

## Current numbers

Regenerated by `scripts/audit-exercise-library.mjs` (see `EXERCISE_LIBRARY_AUDIT.md`); these are the numbers of the Training Quality V2 release, not history.

- 1324 exercises, 210 Recommended 2J, 26 deprecated duplicates, 0 possible-duplicate groups.
- 1310 with a canonical movement (98.9 %). The **14 without one** are ambiguous on purpose and stay unclassified:
  `0016` assisted prone hamstring (the Spanish name says stretch, the steps describe a curl), `0020` balance board, `0100` barbell skier,
  `0316` incline "breeding" (name, Spanish name and steps disagree), `0543` kettlebell pirate, `0609` London bridge (name and steps disagree),
  `0984` / `0996` the two band hip rotations (steps contradict the name), `1332` exercise-ball arm lift (the direction is not stated),
  `2143` around the world, `3292` elevator, and the isometric skills `3295` / `3297` / `3304` (levers, skin the cat).
- Data pass of Training Quality V2: the five muscle-ups (`0558`, `0631`, `1401`, `3286`, `3312`) are a **vertical pull** (target lats, every set of
  steps pulls the chest to the bar; the dip-like transition on top is a second phase — a hybrid skill filed by its primary job), and the eleven
  **triceps kickbacks** that the name rule had filed as hip extension are **elbow extension** (target, Spanish name and steps agree).
- Equipment: no reclassification. The only two names that state it ("(weight stack)", "(plate-loaded)") were already `selectorized` / `plate_loaded`;
  a name or step that merely says "adjust the machine" is not evidence for either. `leverage machine` stays generic `machine`.
- Aliases: 114 on 61 exercises. Added from the searches that really failed (checked against a list of 75 gym queries, Spanish and English): `pec deck` /
  `contractora` → `0596` lever seated fly, the reverse pec deck → `0602`, `pajaros` → `0383`, `lat pulldown` → `0198`, `prensa inclinada` → `0739`,
  `maquina de gluteo` → `2286` lever hip extension. Not added on purpose: "sentadilla búlgara" (the dataset does not say which split squat has the rear foot
  raised), "multipower" (equipment, not an exercise), "face pull", "nordic" and a rowing ergometer (not in the dataset).
- Machines: the catalogue already holds the common ones under dataset names (`lever seated fly` = pec deck, `lever leg extension`, `lever seated leg curl`,
  pulldown and row machines, hack squat and leg press as `sled`, calf and crunch machines, chest/shoulder press in plain, weight-stack and plate-loaded versions).
  **Belt squat and pendulum squat are really absent** and were left out: a new record would have no image or animation (every record has both today, and every
  instruction text is the upstream's), and a hand-written one would be an uncurated claim. Add them together with media that is cleared for use.

## Training Quality V2 — what is a fact, what is a heuristic

`lib/routine-structure.js` is deterministic and read-only. It counts three different things and never mixes them: **exercises** (what redundancy is judged on),
**sets** (the unit balance and volume use) and **days** (frequency: on how many of the listed days a pattern or muscle appears). Every finding is
`{ id, code, category, severity, evidenceType, params, evidence }` — no prose; `lib/routine-structure-text.js` phrases it in the member's language in three
layers (the fact, the interpretation, a suggestion that only asks to check).

| evidenceType | meaning | example |
|---|---|---|
| `fact` | read straight from the plan or the Library | equipment missing from the gym profile, a deprecated duplicate |
| `heuristic` | a 2J rule of thumb over those counts, never a finding of the literature | 70 % or more of the upper-body sets are pushes; one pattern holds 45 % of a week; a weekly range |
| `inference` | needs context the analysis does not have | consecutive days repeat a movement (recovery is unknown); a short history |

Limits, stated plainly: thresholds only decide what is worth a second look and are never a prescription; there is no 1:1 push/pull ratio anywhere. A declared
**focus or specialization** (a chest block, powerlifting, a test, rehabilitation) is intentional by definition and silences the soft readings. The reference
range reuses the protocol's `WEEKLY_SETS` (direct sets per muscle group, per level — the table the protocol validator already applies to hypertrophy programs;
no second volume table, and not `rp-volume`, which needs a member's real weekly history and settings). It appears only for a **hypertrophy** goal, a **known
level** (never inferred) and a **whole week** of two or more routines; otherwise the panel shows nothing, or asks for the level. Secondary muscles are listed as the
number of sets that reach them, not converted into "effective sets".

## The AI library slice

`api/coach/library-slice.js`. The Coach and the trainer AI no longer receive the whole catalogue (about 174 KB / 49,000 estimated tokens for a full gym) but a
deterministic table `{ columns, rows, of }`, each row `[id, name, movement, equipment, muscleGroup, flags]` read from the Library (the model never classifies).
Every movement keeps its best few, Recommended 2J first, with one option per kind of equipment; every muscle group keeps at least six (twelve for a priority muscle);
a goal widens what it needs (cardio and conditioning for endurance, Olympic lifts and jumps for power); the exercises of the plan under review and the member's own
exercises always travel; explicit restrictions and the active gym profile remove what cannot be used; a deprecated duplicate is never listed. A thin result widens by
itself; a pool of 80 or fewer is sent whole. `validate.js` still checks every returned id against the full library, so a smaller list cannot let an invalid id through.
Token figures are **estimates** (JSON bytes ÷ 3.6): no tokenizer is available offline.

## Exercise media and its licence

Every record has a 180 × 180 JPG and GIF from the upstream dataset (`hasaneyldrm/exercises-dataset`), fetched on first run and never stored in this repository.
The repository states the licence only as "(CC)" (`docker-compose.yml`, `scripts/fetch-media.sh`) and `THIRD_PARTY_NOTICES.md` says the media remains under the
dataset's own terms. **The exact Creative Commons variant and its conditions cannot be confirmed from anything in this repository: pending.** Until it is, nothing
new depends on that media (no new records, no bundling, no CDN), and the notice to review the upstream licence before redistributing stays in force.

## Remaining limitations

- `leverage machine` stays generic `machine` where no evidence says weight stack or plate-loaded.
- Aliases are Spanish + English only; other languages search their translated name and English.
- Admin reviews metadata (read-only review filters); decisions are versioned in code, not edited in the app.
- `getReplacementGroups` takes about 13 ms warm on a desktop. Remembering the muscle weights per record was tried and made no measurable difference, so it was not kept.

## Towards Gym Profiles

Equipment kinds and canonical ids are the vocabulary a profile needs ("this gym / home / hotel has
these"). The current gym-wide `unavailableEquipment` (dataset `eq` strings) still applies; a profile
would map canonical ids to availability and feed `isUnavailable`, the picker priority and the AI
slice.
