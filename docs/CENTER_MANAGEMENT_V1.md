# Center management V1 — Hoy · Miembros · Entrenadores

The first visible console, built from what the app already has. No new store, role, notification, CRM or shell: one screen, `/center`, reached from the Admin dashboard (first card) and from the trainer panel's top bar. Reservations, classes and the Coach rules are untouched.

## Where the data comes from

| Need | Source (reused) |
|---|---|
| who is who, who is assigned to whom | `db.users` — `assignedTrainers`, the one rule `canAccessMember` |
| training activity | the derived summary (`lib/user-summary.js`): **`lastWorkoutAt`** and `workoutCount`. `lastSync` is never "active"; only the admin's list shows it, as a diagnostic |
| needs attention, upcoming reviews | the Coach follow-up engine itself (`overviewRow`, `bucketRows`): the same buckets, order and explained signals as the follow-up board (a test compares them) |
| training right now | the in-memory presence (`livePresence`) |

Three read-only endpoints (`api/lib/center-routes.js`), trainer or admin (members get 403):

- `GET /api/center/today?days=7|14|30` — activity tiles (training now, trained today, in 7 days, new members, never trained), the live list, attention, upcoming reviews, new members (last 14 days) and "not training for N days" (a member who joined less than N days ago has not had the time to be idle; one who never trained is listed once old enough). Admin: every member. Trainer: the assigned ones.
- `GET /api/center/members` — one roster. Admin: everybody (members, trainers, admins, disabled) with role, state, assigned trainers, last workout, workout count and, for the admin only, last sync. Trainer: **only the members assigned to them** (`canAccessMember`); nobody else is listed, counted or aggregated, not even minimally, whatever the request asks for.
- `GET /api/center/trainers` — per trainer: members assigned, need attention, reviews within 7 days, trained in the last 7 days, training now, last workout of their members; plus a "No trainer" group (admin). A trainer sees only their own row.

## Miembros

One list with search (member or trainer), status chips with counts (all, training now, not training, recently joined, disabled), and for the admin a trainer filter (any / none / one) and a role filter. A trainer sees only their assigned members and gets no "which members" control.

## Hoy

Six blocks from the same data, each with its own empty state, plus a "see all in Members" link when the list is longer than what is shown. The Coach decrypts each member in scope once per load (not on a timer).

## Entrenadores

Workload cards from `assignedTrainers` and the Coach buckets (a member shared by two trainers counts for both), with a "View members" shortcut into the Members list filtered by that trainer.

## Decisions to know
- A trainer only ever knows and manages their assigned members: no roster of the rest of the centre in any view.
- "Not training" is a plain list by the days the viewer picks; the 14-day absence signal inside the Coach engine is unchanged.
- The console is responsive: one column on a phone, two from 720 px, and it reuses the app's tokens, `Surface`, `Pill`, `Avatar` and `Segmented`.
