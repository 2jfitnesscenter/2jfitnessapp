# Center management — foundation V1

Two P0 findings of the "Gestión del centro" audit, fixed before any new console is built. No new screen, role, notification system or CRM; Coach, reservations and member behaviour are untouched.

## A. Admin actions leave an audit trail

Reuses the account-security log (`db.securityEvents`, `lib/security-audit.js`). One generic event, `admin_action`, per **successful** admin write, with:

- `kind` — what happened (`trainers_assigned`, `invite_created`, `profile_edited`, `measurements_edited`, `starter_plan_applied`, `member_features`, `features_changed`, `news_*`, `equipment_availability`, `exercise_visibility`, `gym_profile_official`, `library_saved`, `ai_config`, `integration_config`, `recovery_request_resolved`, `bunker_*`);
- the member it touched, when there is one (the event's `userId`), and the administrator (`actorId`);
- at most a target id (an exercise id, a feature key, an AI or integration name), a count (how many trainers, how many equipment types) or a short reason (`config`, `auth_key`, `clear`…).

**Never a value:** no text, measurement, health data, note, token, key, invitation code, news content or file content. The allow-list in `cleanMeta` drops anything else, and `describeAction` only reads the fields each rule names. The administrator's identity is not shown to the member: a member sees "An administrator changed something" in their own activity, an admin sees everything in `GET /api/admin/security-events`.

How it is wired: `lib/admin-audit.js` classifies every admin write route. The dispatcher in `server.js` writes the event after the handler answered below 400, so a route cannot forget it and a refused or failed action leaves nothing. The Bunker audits its own admin routes (the kiosk admin token is verified there), with the trainer who made them. **A test fails when a new `POST /api/admin/...` or Bunker admin route is added without a decision** (audited, audited elsewhere, or deliberately not).

Already audited elsewhere: role and account changes (`role_changed`, `account_disabled`…), recovery links, content removal (`content_removed`), Shared Staff (its own audit). Deliberately not audited: connection tests and WebAuthn challenges (they change nothing) and the Coach follow-up writes (`/user/followup`, `/review`, `/routine-cycle`…), which are the Coach area and have their own history.

### `POST /api/admin/user/trainer`
Nothing in the app calls it (only the strong-auth list names it). It is now **deprecated and delegates to the canonical role change** (`changeRole`, shared with `POST /api/admin/user/role`): ADMIN_UIDS, the last-admin rule, the Shared Staff revocations, the dropped trainer assignments and the `role_changed` event all apply. `trainer: true` → trainer, `trainer: false` → member, an admin stays admin; the answer carries `Deprecation: true`.

## B. The member list no longer decrypts every state

`GET /api/admin/users` read and decrypted all `state-<uid>.json` on every call (and the Members screen calls it every 15 s). It now reads a **derived summary** per member (`lib/user-summary.js`):

| Field | Meaning |
|---|---|
| `lastSync` | the state's own `_ts` — when the app last synced |
| `workoutCount` | number of workouts |
| `lastWorkoutAt` | the newest workout **date** |

`lastSync` and `lastWorkoutAt` are different facts: a member who synced today with no workouts is "synced", not "trained". The list also carries `role`, `assignedTrainers`, `activeNow` (from the in-memory presence) and `hasPush` (from the subscriptions), all already available without touching a state.

The summary holds **no** workouts, routines, weight, measurements, health or notes. It is a cache, not a second source of truth:

- updated where state is written (`writeState`), from the state already in memory;
- before it is trusted, compared with the state file's fingerprint (mtime + size) — a restore, a legacy writer or a manual copy is noticed without decrypting, and only that member is rebuilt;
- missing, stale or from an older shape → rebuilt from the state; a member with no state yet gets an empty summary; an unreadable state gets a flagged empty summary (`stateUnreadable`) and the list still renders (it used to fail as a whole);
- saved encrypted (domain `user-summary`) in `user-summaries.json`, debounced, so a restart does not decrypt everybody again; deleting the file only costs one rebuild per member; erased accounts are forgotten and pruned.

The list payload also lost two duplicate-style fields (`workouts`, `lastWorkout`, now `workoutCount`, `lastWorkoutAt`); the Members screen was updated to read them.

### Benchmark (`api/scripts/bench-admin-users.mjs`, 100 members × 150 workouts, 17 MB of encrypted state)

| | state files read per poll | median `GET /api/admin/users` | payload |
|---|---|---|---|
| before (`30007337`) | 101 | 194 ms | 22.7 KB |
| after, first poll (no summary yet) | 101, once | 170 ms | 29.0 KB |
| after, every later poll | **0** | **8.7 ms** | 29.0 KB |

The payload grew by the new fields (`role`, `assignedTrainers`, `activeNow`). A state changed by a member's sync is reflected in the summary at write time, with no read-back.

## Not done here (next, from the audit)
A unified members list for trainers, KPIs built on `lastWorkoutAt`, targeted announcements, trainer workload. This foundation only makes them possible.
