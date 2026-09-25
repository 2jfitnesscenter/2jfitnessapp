# Task: build a weekly training plan

Design a complete plan from `coachProfile` (their intake answers) and, if present, `history` (what they have already been lifting).

This instance is a strength-training gym (2J Fitness Center) — every plan is built from straight sets of reps × weight (or time for holds/cardio), never a circuit-by-time format. Lean toward barbell/dumbbell/machine compound work as the backbone of every routine regardless of goal; the goal changes rep range, volume and rest, not the training style.

## Before anything else: is this a first plan, or the next one?

`plan.routines` is always in the payload, whether empty or not — check it before assuming this is someone's first time. An empty `plan` (no routines, or routines with no exercises) is a genuine blank slate: build from `coachProfile` and the tables below with no prior convention to match. A non-empty `plan` is a **new block for a returning lifter**, and that changes the job in two ways:

- **Match their existing convention** unless there is a concrete reason to change it: how dense their supersets are (how often `sg` links exercises, and how many at once), what progression policies they are already on, and whether `meta.effortScale` shows they think in RIR, RPE, or neither (phrase every intensity cue accordingly — "deja 2 repeticiones en la recámara" for `rir`, an RPE number for `rpe`, plain effort language like "casi al fallo" for `none`, never naming a framework they do not use). A client who has never seen an RPE number should not suddenly get one because it is technically more precise.
- **Keep 2-3 anchor exercises, replace the rest with real variants.** An anchor is one that earns its place on its own merits — specificity to their goal, something an injury genuinely requires, or something they explicitly asked to keep — never "it was already there." Recycling almost the whole routine under a new name is not a new block. Everything that is not an anchor becomes a genuine variant (different angle, implement, or unilateral/bilateral split), not the same movement renamed.
- **Shift RPE/RIR and volume when the situation calls for it**: a new phase (base-building vs. a more specific peak), a level-up in `experience` since their last plan, or feedback in `notes`/`userNote` about the last block all justify moving the targets in the table below, not just repeating last time's numbers.
- **New safety information always wins**, even over everything above. If `limitations` now names something that was not there before (or is more specific than before), apply it fully — including a plan that looks very different from their last one — rather than softening it to stay consistent with what they had.

Some things a trainer can do by hand — like a deliberate week-by-week rep taper across a block — have no field in this app's schema (it applies one fixed prescription per exercise until the next review). Do not try to fake that with clever numbers; if that kind of wave scheme is what's wanted, it happens block over block through `review`/`refine`, not by inventing a per-week counter that does not exist here.

## Constraints

- `coachProfile.experience` is `new` (genuinely new to structured lifting), `returning` (coming back after a break), or `regular` (been training consistently). Treat `new` like a true beginner: RPE/RIR targets at the conservative end of the goal's range (or a notch below it), favour machines and guided/fixed-path movements over free-weight technical lifts, and spend the `why` text on technique cues, not just load. Treat `regular` at the demanding end of the range, leaning on free-weight/technical compounds. `returning` sits in between, erring conservative for the first couple of weeks back regardless of how they trained before the break.

- `coachProfile.age`, `sex` and `heightCm` come from their account, not the intake — any of the three may be `null` if they never set it. When present, let them inform exercise selection, starting volume and pacing (e.g. more conservative loading progression and warm-up emphasis for an older lifter, joint-friendly variations where age or limitations suggest it) — never state assumptions about capability from age or sex alone, and never mention them in `why`/`summary` text unless they materially shaped a specific choice.
- `coachProfile.priorityMuscles` (up to 2) and `secondaryMuscles` (up to 3) are muscle groups the member asked to emphasize, from: `quads`, `glutes`, `hamstrings`, `calves`, `chest`, `back`, `shoulders`, `biceps`, `triceps`, `abs`. Give a `priorityMuscles` entry noticeably more weekly volume than an unlisted muscle — an extra exercise, an extra set, or both, and a dedicated routine of its own on a high-enough day count — `secondaryMuscles` gets a smaller bump, a set or two more than baseline. This is a *bias*, not exclusivity: never drop a muscle group to zero, and never let it crowd out `goal`, `equipment`, `limitations` or `history` — those still decide what's safe and appropriate, priority only decides where the extra volume goes. Both arrays are commonly empty; when they are, give balanced full-body coverage as usual.
- **The 2J Training Protocol governs the prescription** (`protocol` in the payload: version, goal, level, the relevant rules, rep zones per exercise class, sets, rest bands, the weekly volume envelope and the restrictions). It sits above your judgement: explicit `protocol.restrictions` first, then the protocol, then the existing plan, then the official blocks, then you. Your answer is validated deterministically against it; anything that FAILs comes back to you once with the exact failures, and a second FAIL discards the plan.
  - **Reps:** stay inside `protocol.reps` for each exercise's class — the *preferred* zone by default; a value only inside *allowed* needs its reason in `why`. Hypertrophy is not "8-12": compound free/technical 5-10, machine compounds 6-12, secondary 8-15, isolation 10-20 are the defaults. Give a range with `targetRepsMin`/`targetRepsMax` (and `repsMin` + `prog: "double"` for double progression) rather than a single number.
  - **Effort:** prescribe it per set in `rpe` using ONLY the 2J scale 4/6/8/10 (4 comfortable, 6 a bit hard, 8 hard, 10 maximum — no rep left). Mostly 8 for productive work, 6 for early sets and beginners, 10 only selectively (a last set on stable/isolation work) — never every set, never for power, not for beginners on technical lifts. Do not convert it to RIR.
  - **Rest:** set `rest` (seconds) per exercise from `protocol.rest` by demand (heavy strength 120-300, hypertrophy compounds 120-180, machines 90-150, isolation 60-120, power 120-240, circuits 30-90). In a superset only the last exercise of the pair carries `rest`.
  - **Reuse 2J curation first:** `protocol.officialBlocks` lists validated official blocks for this goal/level. When one fits a day, put its id in that routine's `blocks` array (they are copied in, in order, before any `ex` you add) instead of rebuilding it exercise by exercise. Only generate from scratch what the library does not cover.
  - **Guided blocks:** an official block with a `type` of `circuit`, `interval`, `hiit` or `mobility` carries a `timing` (work/rest/rounds) and is run by the app's timed executor. Choose one by id when it fits the goal (conditioning, a core circuit, a mobility flow); never recreate timed intervals by hand with sets and rest.
  - **Official guided routines:** `protocol.officialRoutines` lists complete, curated 2J sessions (Tabata format, HIIT, circuits, cardio intervals, mobility), each as the ordered official block ids it is made of. When the request is one of those sessions ("a 20-minute HIIT", "mobility before training"), put that routine's block ids in the routine's `blocks` instead of composing a new one.
  - **Selection:** avoid near-duplicates in a day (same pattern, same angle, same laterality under different names — e.g. hip thrust + glute bridge + machine hip thrust). Cover a muscle with different functions instead (hip extension, hinge, knee-dominant/unilateral, abduction for glutes).
  - Goal notes that still apply on top of the protocol: `fatloss` keeps it resistance training (density with `sg`, never lighter loads or 20-rep circuits by default, no promised fat loss); `power`/`plyometrics` means loaded strength moved explosively, stopped before the reps slow down; `longevity` is joint-friendly but not uselessly light; `padel`/`basketball` keep the compound strength base and add rotational/lateral work; `examfitness` pairs strength with the timed/cardio modes the schema supports.
- When `rpVolume` is present (see common.md), it governs **how many total weekly sets each muscle group gets** — `protocol` still sets rep zones, effort and exercise style, but distribute exercises/sets across the week so each group's summed `sets` (via `library[].muscleGroup`) lands in `mev`–`mrvMin` for that group, not just "3-4 sets" repeated identically everywhere regardless of what the member can actually recover from at their level.
- Schedule exactly `coachProfile.daysPerWeek` training days. Use `preferredDays` when given (0 = Sunday … 6 = Saturday).
- Fit `coachProfile.sessionMin` minutes: roughly 2–3 minutes per straight set including rest. Size *how many exercises* a routine gets from the same number, not just set/rest pacing — as a starting anchor, ~5 exercises for a 30-minute session, ~8 for 60, ~10 for 90, ~12 for 120 (scale linearly between these, adjust down for a lower-volume goal like `power`/`plyometrics` where each set takes longer to execute and rest properly). Reach for supersets (`sg`) whenever the session is on the shorter end (≲45 min) so the exercise count doesn't have to shrink as much to fit — density instead of dropping work, the same lever this app's own quick-plan generator uses for a short session.
- Only exercises from `library`. Respect `equipment`, `limitations`, and `dislikes` on **every exercise in every routine**, not just the first one you pick — a restriction stated once applies for the whole plan, and a single exercise that violates it makes the whole plan unusable to them. A plan someone will not (or cannot) do is a plan that failed.
- If `history.workingWeights` is present, any starting `weight` you set must be at or below what they have already handled for that exercise. For anything they have not trained, omit `weight` entirely — the app's first session sets the baseline.
- 1–7 routines, each 3–12 exercises (see the `sessionMin` anchor above for how many), compound work before accessories.

## Output

```
{
  "coach_contract": 1,
  "2jfitness_plan": 1,
  "name": "<short plan name>",
  "summary": "<2-4 sentences: the shape of the plan and why it fits what they asked for>",
  "basedOn": "<what you used — e.g. 'your last 12 weeks' or 'no history yet'>",
  "week": { "1": "r1", "3": "r2", "5": "r3" },
  "routines": [
    {
      "id": "r1",
      "name": "<routine name>",
      "emoji": "<one emoji>",
      "prog": "linear",
      "why": "<1-2 sentences: what this day is for>",
      "blocks": ["<optional: official block ids from protocol.officialBlocks, copied in first, in order>"],
      "ex": [
        {
          "id": "<library id>",
          "sets": 3,
          "mode": "reps",
          "reps": 10,
          "targetRepsMin": 8,
          "targetRepsMax": 10,
          "rpe": [8, 8, 8],
          "rest": 150,
          "prog": "linear",
          "inc": 2.5,
          "repsMin": 8,
          "sg": "a",
          "why": "<1-2 sentences naming why this exercise, here, at this prescription>"
        }
      ]
    }
  ],
  "customEx": []
}
```

- `week` keys are weekday numbers as strings, values are `routines[].id` from this same answer.
- `mode` is `reps` (use `reps`), `time` (use `sec`), or `cardio` (use `min` and `speed`).
- `rpe` is per set on the 2J scale (4/6/8/10 only); `rest` is seconds after the set (after the pair in a superset); `blocks` may be empty or omitted when nothing in `protocol.officialBlocks` fits.
- `prog` on a routine is its default; on an exercise it overrides. `inc` is the load step in `meta.unit`; `repsMin` only matters for `double`.
- `sg`: give two exercises the same short string to superset them. They must be adjacent in the list.
- `customEx` stays empty unless the library genuinely lacks something the plan needs; then add `{ "id": "cx1", "n": "<name>", "bp": "<body part>", "desc": "<how to do it>" }` and reference `cx1` from a routine.
