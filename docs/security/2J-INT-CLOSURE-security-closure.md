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

## Architect's review follow-up (H1–H16) — what changed in Búnker

- **H1** sessions follow the mode of the user. `gate()` and `authorizeStateWrite()` no longer treat every `sso` session as enforced; a legacy user keeps exactly their passkey rights through Platform SSO (no Platform call). The route limits of an `sso` session (no passkey-only, staff, destructive routes) are independent of the mode.
- **H2** under enforcement, `member` routes (social, chat, friends, media upload, push, notifications, news) are closed for a blocked account for both session types; reads of news/media/notifications and withdrawal actions (delete/leave/block/unsubscribe/read/preferences) stay open; identity/export/deletion/logout/staff routes are never closed by the capability contract.
- **H3** an SSO code never silently replaces the session of another account: `409 session_switch_confirmation_required` + single-use ticket bound to the browser session, explicit confirmation page (`/sso`), audit events `platform_sso_switch_requested/confirmed`. Residual: a visitor with no session can still be signed in by a link carrying someone else's code.
- **H4/H5/H6** capability cache bounded by our clock; circuit breaker; unavailable → degrade, rejected/inconsistent → fail closed (see the Platform `CONTRACTS.md` §2).
- **H7** the route matrix is generated from the effective router (`DUMP_ROUTES=1`, `api/scripts/route-matrix.mjs`); the classification test uses it.
- **H10** a failure of the integration gate never takes access away from legacy or anonymous callers.
- **H11** `api/scripts/legacy-differential.mjs`: 63 requests (old-app formats, Sync V2, kiosk flow, shared-IP limiter, route-shape tricks) replayed against `main` and the branch on identical data: identical except one intentional difference (an array as the whole state in `PUT /api/data`, now 400).
- **H15** `api/test/state-key-classes.mjs` (kept with the tests because the server must not enumerate member health keys) + a test that fails when a source uses an unclassified top-level state key.
- **New finding (not in the review):** the API `Dockerfile` did not `COPY platform-sso/`, so the image would not have started once #56 was merged. Fixed; `dockerfile-covers-imports.test.js` guards it.

## Second pass (final pre-audit decisions, 2026-10-23) — implementer only, not an independent review

- **Browser-bound SSO**: the flow starts at `GET /api/platform/v1/sso/start` (HttpOnly `j2ssob` verifier cookie, only the SHA-256 challenge leaves); redemption to Platform is **v2** with the verifier; no cookie → refused before Platform is called; mismatch → audited, the code is not consumed. Needs `PLATFORM_HOME_URL`. The H3 login-CSRF residual for visitors without a session is closed. Details and evidence in the Platform repo, `docs/review/2J-INT-CLOSURE/BROWSER-BINDING.md`.
- **Signals** (`POST /api/platform/v1/signals`, `PLATFORM_SIGNALS_ENABLED`, off): restrict-only; `suspended` blocks and persists a restriction, `lifted` only forgets the cache; per-person sequence ordering; epoch guard for in-flight answers; legacy users untouched.
- **Capabilities consumer**: validations ported from the other consumer (cross-field invariants, 64 KB bounded body, redirect/final-URL check, RFC 3339 timestamps) and a shared 59-scenario corpus (`api/test/capabilities-corpus.mjs`, `scripts/compare-capabilities-consumers.mjs`, `test/platform-capabilities-conformance.test.js`).
- Tests: API 902/902, frontend 1875/1875, legacy differential 63 requests (62 identical, 1 intentional: array body in `PUT /api/data` → 400, 0 unexpected).
