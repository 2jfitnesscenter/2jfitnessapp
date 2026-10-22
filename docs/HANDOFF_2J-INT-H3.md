# HANDOFF 2J-INT-H3 — Training consumer of Platform SSO and `2J-CAPABILITIES-V2`

Branch `agent/claude/2J-INT-BUNKER-CONSUMER` (worktree `C:\Users\juanj\Dev\2J\worktrees\claude\2jfitnessapp\2J-INT-BUNKER-CONSUMER`), based on `origin/main` `cbfa0502ab10cbc954b8fe504362fc4334a5b487`. Not pushed, no PR, no deploy. The production SHA of Training is **not verified** (`/api/health` exposes no version). `RP_ID`, `ORIGIN`, cookie name/format for passkey sessions, and secrets are untouched.

Platform-side counterpart: `2j-platform` branch `agent/claude/2J-INT-PLATFORM-IDENTITY` (`6c7571e`, base `f87818a`; PR #63 is merged — the older Home-004 handoff that called #55 a draft SSO design is out of date).

## Semantics (supersedes “no fee = blocked”)

Platform is the authority; Training only applies it in the API. No fee is **not** a block: `FREE_BASELINE` keeps `autonomousTraining`, `personalRoutineCreation`, `personalRoutineManagement`, `workoutRecording`, `workoutHistory`; guided/Premium/AI/professional follow-up need a commercial right. Administrative suspension and a missing/revoked link are separate states. Nothing is deleted when a fee ends.

## What was added (`api/platform-sso/`)

- `route-policy.js` — every real route is classified (`gated`, `member`, `identity`, `kiosk`, `staff`, `public`). A test scans the source and fails on any unclassified route. Verified facts: guided/premium/opposition **write** routes are staff-only; only `GET /api/guided`, `GET /api/premium[/program]`, `POST /api/premium/started` and the opposition read/started routes are member-facing.
- `capabilities.js` — signed `GET` to Platform, strict V2 validation (person, Training user, TTL ≤ 60 s, clock skew), single-flight cache until `expiresAt`, and the degradation policy.
- `index.js` — sso redemption route, per-user enforcement admin route, central gate and kiosk `memberGate`.
- Search points: `server.js` (flag parsing, `readSession` accepts `authLevel=sso`, `newSsoSession`, central gate before every handler, `isAdmin`/`isTrainer` false for sso, `requireStrongAuth` refuses sso), `bunker/routes.js` (kiosk check-in `memberGate`), `platform-proof/store.js` (`linkEvidence`), `lib/admin-audit.js` (new admin route decision).

## Behaviour

- **Off by default.** Nothing happens unless `PLATFORM_SSO_ENABLED=true` and a Platform API client (`PLATFORM_API_*`) is configured. Even then every existing user stays `legacy` (no Platform call, today's behaviour).
- **Per-user modes** (`user.platformEnforcement`, admin-only, audited, no global switch): `legacy → shadow → enforced`; back only through `shadow`. `shadow` logs divergences (hourly de-duplicated) and blocks nothing. `enforced` needs a Training-side link and a fresh Platform verification.
- **Bilateral link.** Redemption succeeds only if Platform confirms an active link **and** Training holds its own evidence (a passkey-backed proof receipt for that person/user, or a provisioned link). A person tied to two users, or a user tied to two persons, is a hard `link_conflict`. Nothing is inferred from name, email or phone.
- **SSO session** (`authLevel=sso`, 12 h, revocable device-session record `via: 'sso'`): member-level only; `isAdmin`/`isTrainer` are false; allowed only on routes marked `ssoAllowed`; passkey management, deletion, export, `logout/all`, device links, third-party connections, and every staff route answer `passkey_required`. SSO sessions are always strict (even for a `legacy` user). A revoked link closes all of that user's sso sessions.
- **Safe degradation** (cache expired / Platform unreachable): free functions are not blocked and paid rights are never granted without verification — baseline only; a known suspension/revocation keeps blocking (persisted on the user as `platformRestriction`, so it survives restarts); no history + legacy/shadow = no verdict (current access untouched); no history + enforced = baseline.
- Staff keep their role functions regardless of their own capabilities. Owner data export and account/identity routes are never capability-gated.

## Verification (local, isolated)

`api` full suite: **842 tests / 795 pass / 47 skipped / 0 fail** (after registering the new admin route in `lib/admin-audit.js`); the new `test/platform-sso.test.js` has 14 tests (route classification, transitions, degradation, contract validation, redemption incl. replay/expiry/origin, link evidence and conflicts, sso restrictions, enforced gates for baseline/other fee/Fuerza/suspension, preservation of routines and history, revoked link, strict sso in legacy mode, fresh-verification requirement). They run a real Training server against a signing fake Platform. Independent review and QA are **pending**.

## Open items before any activation

1. `routineCreation` (commercial) has no distinct route: Constructor writes through `PUT /api/data`/Sync, so it cannot be told apart from personal routines without payload inspection. Baseline therefore keeps personal routine editing (as intended); the commercial-only distinction is **not enforced** yet.
2. Kiosk routes after check-in rely on the short-lived PIN token; only check-in is gated.
3. Frontend `/sso` landing: built in H4 (see below). Not exercised in a real browser against real Platform yet (H5).
4. Provisioning (`platform-training-integration-v1`) and the bilateral ACK/lifecycle messages are not implemented here.
5. Training-side audit of redemption is a security event only; Platform keeps the full audit.

## H4 addendum — `/sso` landing page (frontend)

- `frontend/src/main.jsx` renders `views/SsoLanding.jsx` instead of the app when the path is exactly `/sso` (web build only). It must run before the app because the app's router uses the URL hash, where the one-time code travels (`/sso#code=…`). nginx already falls back to `index.html`, so no web-server change; the CSP (`script-src 'self'`) is respected (bundled code, no inline script).
- `lib/sso-landing.js`: reads the code only from `#code=<43–128 url-safe chars>`, **removes it from the address bar and history before the request**, posts `{v:1, code}` once to Training's own origin (single-use even under React StrictMode: repeat calls share the first result), then reloads `/` so the normal `GET /api/me` boot restores the user (`authLevel: 'sso'`) with per-user local-state isolation. Failures show a next step (use passkey / ask the centre / try again) and never Platform's reasons.
- `SecuritySettings` and `LinkApprove` treat `sso` like a shared-staff session: they explain that passkeys and devices need a passkey sign-in instead of showing actions the API refuses.
- Spanish strings added to `locales/es.js`; other locales fall back to English.
- Environment-listed administrators (`ADMIN_UIDS`) never get an sso session (refused at redeem and by `readSession`); `isAdmin`/`isTrainer` keep their original definitions.
- Verification: frontend vitest 1865/1865 (7 new in `lib/sso-landing.test.js`), production build OK; API 842 tests / 795 pass / 47 skipped / 0 fail (`platform-sso.test.js` now 15 tests).
