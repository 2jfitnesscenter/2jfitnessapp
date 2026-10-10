# HANDOFF 2J-078D — Training verified account proof

**Status:** implementation and local validation complete; draft PR/remote CI pending.
**Base:** `374e62c3b316b3642a7ddb623c98319264f9b8dd` (verified `origin/main` at task start).
**Branch:** `agent/codex/2J-078D-training-proof-shadow`.
**Worktree:** `C:\Users\juanj\Dev\2J\worktrees\codex\2jfitnessapp\2J-078D`.

## Implementation summary

The two independent flags are `PLATFORM_PROOF_ISSUANCE_ENABLED` and `PLATFORM_PROOF_EXCHANGE_ENABLED`; both default false. Issuance is `POST /api/platform/v1/link-proofs` and requires an existing passkey-level Training session. Exchange is `POST /api/platform/v1/link-proofs/exchange`, requires exact Platform `2J-SERVICE-AUTH-V1` headers, and does not use Training cookies. Proofs are random 32-byte URL-safe codes, returned once and stored only as SHA-256 hashes inside the existing encrypted JSON data store. They bind all five Platform context fields plus the server-resolved Training user. Effective TTL is at most two minutes and capped by Platform expiry.

Service request IDs and consumed proof state survive process reloads in the encrypted store. The single-process synchronous file mutation prevents duplicate acceptance in this deployment model. The existing file store does not coordinate separate processes/replicas; enabling the feature on multiple replicas sharing `DATA_DIR` is unsupported until an atomic shared store is separately implemented and reviewed.

Existing auth/session, passkey credentials, RP ID/origins, logout, account creation, workout/Health/Búnker behavior, and Training roles are unchanged. Proof exchange does not create a canonical link or remote ACK.

`proof exchanged successfully != canonical Training link active`

## Review focus

Please independently verify HMAC byte canonicalization against the Platform 078C fixture, issuance session binding, no raw code persistence/logging, durable single-use/replay behavior, context mismatch non-consumption, and the documented single-process persistence limitation. Both flags must remain off. No live credentials are present.

## Validation record

- New protocol tests: **9/9 passed**, no skips.
- Full API suite: **454 passed, 0 failed, 5 unrelated backup tests skipped** because this Windows host lacks `bash/openssl`.
- Frontend suite: **1445/1445 passed** with two workers (the unconstrained local run hit resource-related timeouts; the constrained rerun passed).
- Frontend production build: passed. Locale coverage script: exited successfully; existing translations report partial coverage.
- API Docker image build: passed, including the new module copy.
- API exercise-catalogue consistency check: passed.
- `git diff --check`: passed.
- Dependency audit: **not clean on the unchanged baseline**: API reports 3 advisories (1 moderate, 1 high, 1 critical); frontend reports 21 (1 low, 6 moderate, 10 high, 4 critical). No dependencies or lockfiles were changed; broad audit remediation is outside this task's scope and should be tracked separately.
- A local `gitleaks` scanner is not installed. No real credentials were added; the only signing key is a deterministic test fixture. Remote CI/secret scanning remains pending.
- GitHub `test`, `api`, and `api-image` checks remain pending until the draft PR is opened.
