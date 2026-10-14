# 2J-089 Training handoff

**Base SHA:** `d941f3afd8c2bf660f179640465506eb50d8cee4`  
**Branch:** `agent/codex/2J-089-bunker-summary-contract`  
**Status:** local validation and current PR CI passed; draft PR/independent review pending. No merge or deployment.

**Training PR #28:** https://github.com/2jfitnesscenter/2jfitnessapp/pull/28 (implementation head `e92c42281237a471f5b2814b9c73fe2a625d38a6`). **Coordinated Platform PR #36:** https://github.com/2jfitnesscenter/2j-platform/pull/36 (implementation head `f4facbd7ab68e673459117e818e0bdf58ac36d60`). Review and merge these together; do not merge either alone.

## Change

Added a default-off `POST /api/platform/v1/training-summary` route through the existing `api/platform-proof/` service-auth module. It uses the fixed path (not a URL parameter), strict `{v,trainingUserId}` request schema, exact `2J-SERVICE-AUTH-V1` signature, existing key allowlist and persisted replay protection.

For an active Training user, the route returns V1 status, current program name/ID when present, the last training calendar date, and session count in the preceding 30 UTC calendar days. Missing or disabled accounts share a generic 404. Only replay metadata is persisted; Training data is read-only. No session, account link, identity copy, or SSO path is created.

The response omits workouts, exercises, body/health data, coach notes, nutrition notes, permissions, and settings. There are no secrets in the branch. `PLATFORM_TRAINING_SUMMARY_ENABLED` is required independently and defaults off.

## Validation

The 23/23 focused Platform-proof tests pass. Full API suite: 722 tests, 675 passed, 47 skipped, 0 failed. Frontend suite: 1,808/1,808 passed when run with one worker; default parallel execution hit existing timeout limits under local machine load. Frontend build, generated-content checks, locale check, and `git diff --check` pass. This repository has no TypeScript typecheck script. `npm audit` reports existing vulnerabilities (API: 1 moderate, 1 high, 1 critical; frontend: 1 low, 6 moderate, 10 high, 4 critical); no dependency manifest or lockfile changed in this task. A live cross-process local smoke is not run; signed protocol and shared-fixture tests cover both sides independently. Independent review and remote CI are pending.

## Cross-repo coordination

Platform base: `b919624f381a5a7c29ca072e40cd942d0ff169f8`. Its branch uses the same strict semantic V1 fixture and filters the canonical Platform link before any request. The two draft PRs must reference one another, be reviewed together, and remain unmerged until both are accepted.

Training `npm audit` baseline: API reports 1 moderate, 1 high, and 1 critical advisory; frontend reports 1 low, 6 moderate, 10 high, and 4 critical advisories. No dependency manifest or lockfile changed here. A TypeScript typecheck is not defined by this JavaScript repository. The real cross-process smoke remains deferred; no credentials were created or enabled.
