# Coach & Seguimiento PRO V3 — architecture, data map and rules

Staff tool (trainer/admin) to see **who needs attention, why, what changed, what to review and what was decided**. It synthesises data that already exists; it
stores almost nothing new. Baseline: production `bd48dc1`. Branch `codex/coach-followup-v3`.

## 1. Data map (audit): data → canonical source → who reads it

| Data | Canonical source (single truth) | Existing consumers | V3 |
|---|---|---|---|
| Workouts (sessions, sets, PRs, `excludeFromProgression`, `rescheduledFrom`) | member state `S.workouts` (Sync V2) | Stats, Progress, progression, readiness, Routine/Program Review | read-only (adherence, progress) |
| Weekly plan, routines, programs, versions | `S.week`, `S.routines`, `S.programs`, `S.routineVersions/programVersions` | Plan, Workout, Constructor, Trainer panel | read-only; "plan changed" is **derived** from the version snapshots |
| Routine / Program Review (cycle, plateau, adherence of the program, dates, reviewed) | `S.routineReviews`, `S.programReviews` + `routine-review.js` (engine, byte copy on API) | Home, member Seguimiento, `RoutineCycles` editor, `pendingReviews` | reused as is (`routineReviews`); the sheet mounts the **same editor** |
| Training Quality (structure of a plan) | `routine-structure.js` (`analyzeRoutineStructure`, client) | `TrainingQualityPanel`, Program Review card, trainer AI brief | shown in the review brief; its findings (id/category/severity only) can go to the AI |
| Accumulated fatigue / deload | `fatigue.js` (byte copy on API), `S.deload` | member readiness card, staff fatigue alert | `fatigue_trend` signal; silent while a deload is active |
| Check-ins (energy/sleep/fatigue/discomfort) | `S.checkins`, **only if** `S.shareCheckins === true` | member Seguimiento, `followUpSummary` | same rule: read only when shared; never otherwise |
| Body weight / measurements | `S.bodyweight`, `S.measurements`, `S.targetW` | Health, Progress, measurement follow-up | **context** for a fat-loss goal only; never mixed with performance |
| Goal | member: `S.coach.profile.goal` (product goals). Staff reading: `followUp.goalPlan` on the roster | CoachIntake, starter plan | staff reading is additive and private; the member's is untouched |
| Measurement follow-up (template, cadence, reviews) | roster `u.followUp` (`followup.js`) | admin follow-up card, member `/api/followup` (schedule only) | reused; V3 annotations live in the same object |
| Private staff notes + events | roster `u.followUp.privateNotesEncrypted` (AES-GCM, info `2j-followup-private-v1`) | admin follow-up card (single note) | extended (still version 1): dated `entries` + richer `events`; legacy note kept |
| Trainer AI (routine generation) | `trainer-ai.js` (Claude credential, daily cap) | `/trainer/:id/ai` | **same credential and cap** for "Analizar seguimiento" |
| Member (personal) AI | `coach/` + `payload.js` | member Coach | untouched; never receives staff data |
| Roles | `u.admin`, `u.trainer`, `ADMIN_UIDS` | every guard | `requireTrainer` + explicit assignment (below) |

Gaps found: (a) trainers could not read any follow-up/health data (admin-only) and there was **no trainer↔member relation**; (b) the staff list did one request per
member (N+1); (c) no adherence definition (planned vs done); (d) no triage with explained signals; (e) no decision trail; (f) notes were one text box.

## 2. Permissions

| Role | V3 surface (`/api/trainer/followup/*`) | Notes |
|---|---|---|
| Admin | every active member | also assigns trainers (`POST /api/admin/user/trainers`) |
| Trainer | **only members assigned to them** (`u.assignedTrainers`) | no assignment = admin only; nothing is exposed by default |
| Member | none (403) | their own `/api/followup` still returns the schedule only |

* A trainer asking for an unassigned (or unknown) id gets the same `403` — ids cannot be probed. Staff accounts are not "members".
* Removing the trainer role or demoting drops their assignments (`dropTrainerAssignments`).
* **One rule for every staff route that targets a member** (`memberFor` in `server.js`, built on `canAccessMember`): the legacy trainer panel is covered too — `routine-cycles`, `routine-cycle`, `routine-reviewed`, `member-plan`, `member-routine`, `member-program`, `assign-routine`, `assign-program`, `routine-versions`, `program-versions`, the trainer AI (`generate`/`status`/`discard`) and the member picker (`GET /api/trainer/members`, which lists only the members a trainer may act on). `api/test/trainer-acl.test.js` runs all of them against assigned / unassigned / unknown / staff ids, admin, member and anonymous callers, and a completeness test fails if a new `requireTrainer` route targets a member without the guard.
* **Operational consequence**: a trainer reaches nobody until an admin assigns members to them (Seguimiento sheet → "Manage"). This is the intended policy, not a fallback.
* **Role-only routes that remain (all gym-wide, none reads or writes a member)**: `POST /api/social/board` (gym notice), `POST /api/social/challenges/new` (gym challenge), `POST /api/exercises/alias` and `POST /api/exercises/import-alias` (machine / exercise-name aliases), and the block and guided-programme libraries (`blocks-routes`, `guided-routes`: content libraries with no member id). The test lists them with the reason; anything else without the guard fails the suite.
* Disabled members are left out of the list; their sheet is readable by staff with access but writes answer `409`.

## 3. What is stored (all additive, roster side, nothing in member state or Sync)

* `user.assignedTrainers: [id]`
* `user.followUp.goalPlan {primary?, label?, targetDate?, priority?, by, at}` and `user.followUp.flag {at, by}`
* encrypted blob (`privateNotesEncrypted`): `entries[{id, at, by, text, ref?}]` (notes, ≤1000 chars, ≤80) and `events[{at, by, action, kind, ref?, text?}]` (≤150)

Derived, **never stored**: triage level and signals, adherence, progress, review brief, timeline of review closures and plan changes, the analysis.

## 4. Engine (`api/lib/coach-followup.js`)

* **Adherence**: planned strength sessions per week come from the member's own weekly plan (`S.week`), or week 1 of the active program. Done = strength sessions
  (`sessionKind`); *partial* (< 70 % of planned working sets), *cardio* (counted apart, never as strength), *moved* (`rescheduledFrom`) and *excluded from progression* are reported separately. Windows 7 and 28 days; trend = last 14 days vs the 14 before. Percentages are multiples of 5, shown only with a plan, ≥ 3 planned sessions and ≥ 7 days of history.
* **Signals** `{id, severity, source, evidence, explanation, suggestedAction}`: `absence`, `no_workouts_yet`, `adherence_low`, `adherence_drop`, `missed_week`, `plateau`, `review_due`, `review_overdue`, `measurement_review`, `checkin_fatigue`, `checkin_discomfort`, `fatigue_trend`, `performance_drop`, `goal_body`, `goal_performance`, `goal_date`, `no_program`, `structure`, `flagged`. Sentences are registered English keys (`SIGNAL_TEXT`), translated by the app; each carries the numbers behind it.
* **Triage**: `normal` · `review` · `priority` — the maximum severity of the signals. No score. Buckets for the board: *need attention* (review/priority) · *upcoming reviews* (normal, a review within 7 days) · *stable*.
* **Goal lens**: fat loss → body-weight direction against the target (≥ 3 readings over ≥ 21 days); performance goals (hypertrophy, power, plyometrics, toning, padel, basketball, exam prep) → records/progression; health goals → adherence only. Body weight and performance are never merged.
* **Certainty**: the analysis keeps **fact** / **inference** / **suggestion** apart (`analysisFrom`), always available without AI.
* Edge cases covered by tests: no program, legacy data, no workouts, new member, future/overdue review, excluded workout, several trainers, unassigned trainer, disabled user, no Health, private check-ins, recently changed program.

## 5. Professional AI ("Analizar seguimiento")

* Input: `aiFacts()` — goal, adherence, progress, plateau, structure findings (id/category/severity), review status, fatigue level, check-in summary **only if shared**, last 5 event *kinds and dates*. **Never**: name, id, raw state, workout JSON, catalogue, notes (staff notes stay out of every AI by policy), free text. Hard limit `AI_PAYLOAD_MAX = 6000` characters (trimmed field by field).
* Output: `{summary ≤3, keyData 3–5, review ≤3, proposal ≤3}`, each statement tagged fact / inference / suggestion; refused if it contains medical wording, an unknown tag/action, or anything applicable. The UI offers **Open program · Create proposal · Add note · Review date**, and Accept/Dismiss (logged as a decision). There is no "Apply".
* Same Claude credential, daily cap and instance log as the trainer AI; identical facts within 30 minutes are served from memory (no new call). When the AI is off, busy or unusable the screen keeps the deterministic analysis.

## 6. Performance

One request returns the board (`GET /api/trainer/followup/overview`), no per-member round trips. Engine for 100 members ≈ tens of ms; 100+ real state files over HTTP < 4 s in test (`coach-followup-http.test.js`).

## 7. Out of scope / limits

* Thresholds are internal heuristics (see `COACH_FOLLOWUP_EVIDENCE.md`), fixed, not per member.
* Training Quality findings reach the sheet and the AI only when the staff's browser computes them (the engine lives in the client); the list view uses server-side signals only.
* Measurement-review closing stays in the admin card (`POST /api/admin/user/review`).
* The staff cannot apply deloads or edit a member's plan from here; "Open plan" / "Create proposal" go to the existing trainer screens.

## 8. Verification (local, synthetic data only)

* Frontend `1487/1487` (117 files, sequential), API `498/498` with `skipped 0`, build, `check-locales` (es `4780/4780`) and `git diff --check` clean.
* Real-browser QA on an isolated API with 22 synthetic accounts (admin, two trainers, 17 assigned members, one disabled, one unassigned, one that never synced): board and sheet at **390 / 768 / 1440 px**, light and dark; no horizontal overflow at 390; goal, note, decision and mark written through the UI and read back; a trainer without assignment gets `403` and the explanatory message; admin sees every member.
* Performance: engine for 10 / 25 / 50 / 100 members ≈ tens of ms in total; the HTTP list with 100+ real state files answers in one request (< 4 s asserted, ≈ 1 s observed).
* Live provider smoke (2026-10-08, local, no production): the real Claude Agent SDK runtime is present (`check` OK) but this environment has no provider credential (the admin's `claude setup-token` lives only in the production instance), so the call ends in the `auth` class. **Result: NOT AVAILABLE — not claimed as passed.** Everything up to the provider boundary is covered with a fake provider (real queue, prompt, validator, cache, cap). To close it: connect the token in Admin → trainer AI on a test instance, open a member sheet and press "Analizar seguimiento" once.
