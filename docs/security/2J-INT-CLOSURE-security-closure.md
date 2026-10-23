# 2J-INT-CLOSURE — Security closure: member-state write paths (Búnker)

Scope: every code path that can write or change a member's training state (`state-<uid>.json`), and what authorizes it. Method: `grep` of `writeState`, `mutate`, `saveDirect`, `saveTrainer` over `api/` (excluding tests), reading each handler, and one negative test per path. Evidence lives in `api/test/platform-sso.test.js` (tests "PUT /api/data, /api/workouts/delete …", "every sync operation type …", "commercial feature routes …", "a suspended …", "a non-object state …", "the staff-only writers …").

## Writers and their authorization

| Path | Writes | Authorization | Negative test |
|---|---|---|---|
| `POST /api/sync` `save`/`replace`/`reset` | whole member state | route gate (`autonomousTraining`, `personalRoutineManagement`) **and** `authorizeStateWrite` (content: paid subtrees and guided programs stripped, personal ops checked) | forged premium/opposition/coach/guided with each type: stripped, server copy kept |
| `POST /api/sync` `delete` | removes one routine/program/workout | route gate; only removes (a reduction, allowed) | deleting the guided program removes only it |
| `POST /api/sync` other type, or non-object `state` | nothing | `400` before the policy (array/scalar state used to be coerced to `{}` by the policy and bypass `mutate`'s validation — **fixed**) | `merge` type, `[]`, `'x'`, `5` → 400, state unchanged |
| `PUT /api/data` | whole member state | route gate + `authorizeStateWrite`; `409` once Sync V2 is enabled; array body now `400` (**fixed**) | forged paid content stripped while the personal part of the same request is saved; wipe/reduction allowed; path variants (`/api/data/`, `//api/data`, encoded dots, query, lowercase method) never reach the writer |
| `POST /api/workouts/delete` | removes a workout | gate `workoutRecording` | extra `premium`/`coach`/`state` fields are never merged |
| `POST /api/active/activity`, `/clear` | `active` only | gate `workoutRecording` | paid view unchanged |
| `POST /api/active/finish-inactive` | adds a workout | gate `workoutRecording` | extra paid fields ignored |
| `POST /api/bunker/handoff` | `active` only | gate `autonomousTraining`, passkey session only | extra paid fields ignored |
| `POST /api/bunker/finish` (kiosk) | adds a workout | PIN → bearer token; `memberGate` on check-in (`autonomousTraining`) | extra paid fields ignored |
| Admin/trainer writers (`/api/admin/user/*`, `/api/trainer/assign-*`, `/api/trainer/member-*`) | member state on behalf of staff | role guards inside the handlers; route policy `staff`, never `ssoAllowed` | member with sso or passkey session gets 401/403 on all 12, nothing written |
| Coach, Premium, Opposition, follow-up routes | their own stores | route gate (`aiCoach`, `premiumPrograms`, `professionalFollowUp`, `guidedTraining`); `coach/forget` and disclosure are never fee-gated | all answer `403 capability_required` for an enforced no-fee account |
| Blocked (suspended / revoked) accounts | — | route gate answers 403 for the whole family | PUT, sync, delete, active/clear → 403 |

Every route in the real route table must be classified in `platform-sso/route-policy.js`; the existing test fails on a new unclassified route, which is what keeps this inventory closed.

## Design observations (not defects)

- **Guided programs after the fee ends (changed in the review follow-up).** Keeping a guided program and its history is free; continuing it is a paid function. Progress is *derived* from the recorded workouts (`src2j.program` references), so the workout is always recorded and the history is never touched. The only server-side change to a guided program is closing it as completed (`completeGuidedProgramSession`); that now requires `guidedTraining` (the same right `sync` already requires for any guided-program state change). Without it the program stays exactly as it was (frozen) and the finish answer carries `guidedProgress: 'frozen'`. Legacy users and staff are unchanged; shadow only logs. Test: "finishing a workout of a guided program records it for everyone…".
- **Kiosk tokens (changed in the review follow-up).** A kiosk bearer token is minted at check-in and lives up to 4 hours, so it is now re-checked against the Platform gate on every use (`readKioskMember` in `bunker/routes.js`): a blocked account (administrative suspension, revoked/missing link) gets 403 `capability_required`, its room presence ends, and its in-progress workout is kept (the server-side inactivity sweep still closes it into history). Latency from suspension to effect is bounded by the capability cache (at most 60 s, `capabilities.js`). Legacy users and staff pass without any Platform call. Lifting the suspension restores the same token. Tests: "kiosk tokens are re-checked on every use…", "legacy members never call Platform from the kiosk…". Truly instantaneous revocation would need Platform to push the suspension to Búnker (a new signed endpoint); not implemented, proposed in the reviewer package.
- Staff can assign guided programs to a member irrespective of the member's fee (staff functions never depend on the member's capabilities).
- Legacy and shadow users are deliberately not blocked; enforcement is per user and opt-in.

## Client IP behind the proxy (Búnker)

A private source address is not proof that the peer is our nginx or Caddy. Default (`TRUSTED_PROXIES` unset) keeps the legacy rule so nothing changes by itself: any private direct peer is believed and the first `X-Forwarded-For` hop is the client — safe only if the edge overwrites the header. With `TRUSTED_PROXIES` set (exact IPv4 CIDRs /8–/32 or exact IPv6; invalid or too-wide values stop the start-up) only listed peers are believed and the client is the rightmost address that is not a trusted proxy, so a forged leftmost entry is ignored. Exact configuration and the pre-production tests are in the Platform runbook `docs/runbooks/2J-INT-proxy-and-rate-limits.md`. Tests: `api/test/bunker-rate-limit.test.js`.

## Passkeys of Búnker

Not touched: `git diff` of both closure branches contains no change to `RP_ID`, `ORIGIN`, the WebAuthn routes or credential storage (checked in the closure report).
