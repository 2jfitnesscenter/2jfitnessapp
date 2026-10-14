# TASK 2J-089 — Platform ↔ Búnker read-only summary endpoint

## Scope

Expose a coarse, read-only summary for a Training account to the trusted Platform service. Preserve the existing Training database and identity model. `trainingUserId` remains Training-owned; Training stores no `personId`, `centralClientId`, or `centralStaffId` for this query. No email/name/phone matching, SSO, session creation, writes, or synchronization.

## Contract

`POST /api/platform/v1/training-summary` accepts only the strict JSON body `{ "v": 1, "trainingUserId": "..." }`. The opaque durable ID stays out of the URL. The request must be authenticated with the existing exact `2J-SERVICE-AUTH-V1` signature, fresh timestamp, unique request ID, and persisted replay store. The same existing service key allowlist and key-rotation configuration are reused. No browser cookie, CORS, generic bearer token, or browser-origin request grants access.

Success response:

```json
{
  "v": 1,
  "trainingUserId": "opaque-training-id",
  "trainingStatus": "active",
  "asOf": "2026-10-13T12:00:00.000Z",
  "currentProgram": { "id": "program-id", "name": "Fuerza base" },
  "recentActivity": { "lastTrainingAt": "2026-10-12", "sessionsLast30Days": 4 }
}
```

`currentProgram` is optional. The recent-activity window counts valid Training session date entries for the most recent 30 UTC calendar days through `asOf`. Unknown, deleted, archived-equivalent, or disabled users receive the generic 404 `training_summary_not_found`. When the separate `PLATFORM_TRAINING_SUMMARY_ENABLED` switch is off, requests receive 423 `training_summary_disabled`. Authentication, invalid input, replay, and internal read failures use bounded generic error codes and never return state files or stack traces.

## Allowed/forbidden data

Only active status, the current program's display name/opaque ID, `asOf`, last training day, and a 30-day session count are exposed. Workout history, exercise logs, performance/RM details, body/health metrics, private trainer/nutrition notes, internal roles/permissions, and account settings are never returned.

## Safety and tests

The signed endpoint is default-off and backend-to-backend only. It reuses the existing `PLATFORM_SERVICE_AUTH_KEYS`, exact request verifier, encrypted replay store, and 60-second freshness/two-minute replay bounds. It performs no Training domain writes; only the existing anti-replay metadata is persisted. Tests cover unsigned/cookie-only and invalid path/body rejection, signed Platform success, user missing/disabled, narrow response fields, sensitive-field omission, and replay rejection.

The semantic fixture is also validated by Platform's strict response schema. The exact contract example is mirrored at `contracts/2J-089-training-summary-v1.json` in Platform and Training; both suites load it directly. The actual external service key is not committed, requested, or enabled by this task, and no cross-repository package was added.
