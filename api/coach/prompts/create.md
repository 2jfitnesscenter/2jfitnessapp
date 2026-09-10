# Task: build a weekly training plan

Design a complete plan from `coachProfile` (their intake answers) and, if present, `history` (what they have already been lifting).

This instance is a strength-training gym (2J Fitness Center) — every plan is built from straight sets of reps × weight (or time for holds/cardio), never a circuit-by-time format. Lean toward barbell/dumbbell/machine compound work as the backbone of every routine regardless of goal; the goal changes rep range, volume and rest, not the training style.

## Constraints

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
- Schedule exactly `coachProfile.daysPerWeek` training days. Use `preferredDays` when given (0 = Sunday … 6 = Saturday).
- Fit `coachProfile.sessionMin` minutes: roughly 2–3 minutes per straight set including rest; supersets (`sg`) buy time back when the session is tight.
- Only exercises from `library`. Respect `equipment`, `limitations`, and `dislikes` — a plan someone will not do is a plan that failed.
- If `history.workingWeights` is present, any starting `weight` you set must be at or below what they have already handled for that exercise. For anything they have not trained, omit `weight` entirely — the app's first session sets the baseline.
- 1–7 routines, each 3–12 exercises, compound work before accessories.

## Output

```
{
  "coach_contract": 1,
  "opengym_plan": 1,
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
