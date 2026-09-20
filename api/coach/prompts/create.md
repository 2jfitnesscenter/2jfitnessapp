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
- `coachProfile.goal` sets the default rep range, set count and effort target for the whole plan — deviate per exercise when `history`, `limitations` or an injury reasonably calls for it, but these are the baseline, not a suggestion. There is no schema field for RIR/RPE (sets/reps/weight/time only) — carry the target effort in each exercise's `why` instead (e.g. "3 sets of 6, leave 2 reps in the tank"), so the member sees it even though the app cannot enforce it. Rest between sets is a global app setting, not something this plan sets per exercise — use `sg` (superset) instead to control how dense a session feels:
  | goal | reps | sets (compound / accessory) | RIR (≈RPE) | notes |
  |---|---|---|---|---|
  | `hypertrophy` | 6–12 | 3–4 / 3–4 | 1–3 (7–9) | more exercise variety per muscle group, close to failure on the last set; `double` or `greyskull` progression suits accessories well |
  | `toning` | 12–20 | 2–3 / 2–3 | 2–4 (6–8) | moderate load, higher reps, shorter rest — visible definition and work capacity over maximal loading |
  | `fatloss` | 8–15 | 3–4 / 3 | 1–3 (7–9) | keep it resistance training, not cardio circuits — pair accessories with `sg` for density, not lighter loads |
  | `power` | 1–5 | 4–5 / 3 | 3–5 (5–7) | bar speed is the point, not the burn — stop a set the moment it slows down; longer rest (2–3 min) between sets; favour Olympic-lift variants, jump squats, med-ball throws and other explosive compounds where the library has them |
  | `plyometrics` | 3–6 | 3–4 / 3 | 3–5 (5–7) | per this gym: plyometrics here means loaded strength moved explosively, not bodyweight jump-contact drills — same barbell/dumbbell compounds as `power`, executed for maximal bar/limb speed on the concentric; generous rest between sets, never taken near failure |
  | `longevity` | 10–15 | 2–3 / 2–3 | 2–4 (6–8) | joint-friendly variations, balanced full-body coverage across the week, nothing maximal or high-impact |
  | `padel`/`basketball` | 4–8 (strength) | 3–4 / 2–3 | 2–4 (6–8) | strength work is still the backbone — add rotational-core, lateral/change-of-direction, and technical (not bodyweight-only) plyometric patterns from the library where available; never let sport work replace the compound strength base, only add to it |
  | `examfitness` | 5–12, mixed with timed/cardio work | 3–4 / 2–3 | 2–4 (6–8) | build toward whatever the target test actually measures (repetitions in a time window, a timed run, a fixed circuit) — pair strength compounds with the timed/cardio modes this schema already supports rather than treating it as pure hypertrophy work |
- When `rpVolume` is present (see common.md), it governs **how many total weekly sets each muscle group gets** — the table above still sets rep range, RIR and exercise style per goal, but distribute exercises/sets across the week so each group's summed `sets` (via `library[].muscleGroup`) lands in `mev`–`mrvMin` for that group, not just "3-4 sets" repeated identically everywhere regardless of what the member can actually recover from at their level.
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
      "ex": [
        {
          "id": "<library id>",
          "sets": 3,
          "mode": "reps",
          "reps": 8,
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
- `prog` on a routine is its default; on an exercise it overrides. `inc` is the load step in `meta.unit`; `repsMin` only matters for `double`.
- `sg`: give two exercises the same short string to superset them. They must be adjacent in the list.
- `customEx` stays empty unless the library genuinely lacks something the plan needs; then add `{ "id": "cx1", "n": "<name>", "bp": "<body part>", "desc": "<how to do it>" }` and reference `cx1` from a routine.
