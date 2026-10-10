# HANDOFF 2J-078F-A — durable proof receipt and reconciliation

**Status:** one draft PR open; no merge or deployment.
**Expected base:** `0ac1317686cea81e63674a2bcb8cde870d5d6dcc` (must be refreshed from `origin/main` immediately before branch creation).
**Branch:** `agent/codex/2J-078F-A-proof-receipt-reconciliation`.
**Worktree:** `C:\Users\juanj\Dev\2J\worktrees\codex\2jfitnessapp\2J-078F-A`.
**PR:** https://github.com/2jfitnesscenter/2jfitnessapp/pull/16 (draft; do not merge).
**Implementation validation SHA:** `c22eadfbdaffa8bfe5cc91794005f6a6ce7aaace`; later commits only update this handoff metadata. Check the live PR #16 rollup for the final head before any review/merge decision.

## Implementation summary

The encrypted `platform-link-proofs.dat` store now adds an immutable `receipts` array while preserving old schema-version-1 files that predate receipts. A successful proof exchange stores proof consumption and its receipt in one synchronous encrypted-store replacement. Receipt records contain `receiptId`, version 1, originating `proofId`, exact Platform context, verified Training identity and canonical `verifiedAt`; they never contain the raw code or `codeHash`. Existing exchange response shape remains unchanged for Platform 078E.

Receipts are retained indefinitely in this phase. Pending/consumed proof cleanup remains unchanged (consumed proof records are still pruned on the existing 90-day horizon). Reconciliation can therefore recover a historical fact even after proof cleanup or later account disablement. No retention policy beyond indefinite retention is invented here.

`POST /api/platform/v1/link-proofs/reconcile` strictly accepts only `{v, transactionId, personId, audience, purpose, challengeDigest}`. It uses the same configured `PLATFORM_SERVICE_AUTH_KEYS` allowlist and 2J-SERVICE-AUTH-V1 verifier, signs the exact reconciliation path, uses persisted service request replay protection, and returns an exact immutable receipt for a matching context. New requestIds for the same context are read-idempotent; repeating a requestId is rejected. Misses all return generic 404. Browser cookies, generic bearer credentials, caller proof codes and caller-supplied Training IDs do not authorize or influence lookup.

The separate `PLATFORM_PROOF_RECONCILIATION_ENABLED` flag defaults false. Presence of service keys does not enable it. Existing issuance and exchange defaults remain false. Docker already copies the full `api/platform-proof/` module, so the route/store changes are included in the API image without a Dockerfile change.

`verification receipt recovered != canonical Training link active`

## Security and durability limits

Raw proof codes remain single-use; no exchange idempotency returns a consumed code's Training identity. An exact context with a different already-receipted Training subject returns `verification_receipt_conflict` and does not overwrite the first receipt. A second unconsumed proof for a context already receipted for the same subject returns `verification_receipt_exists` rather than claiming another successful exchange; Platform can reconcile the original receipt. Receipt mismatch does not reveal another person's or transaction's Training identity. General audit records only receiptId and transactionId for create/reconcile events, not Training ID, digest, signature, code or secret.

The store's synchronous read/check/write serializes only within one API process. Atomic rename avoids a normal process-visible consumed-without-receipt write, but the existing file store has no explicit fsync guarantee and no multi-replica coordination. Treat this as shadow-only; fsync/shared atomic persistence remains required before LIVE. Existing 078D follow-ups remain: narrow proof supersede scope, account re-enable proof semantics, issuance rate limiting, fsync durability and single-process-only storage.

## Validation record

- Protocol suite: **21/21 passed, 0 skipped**.
- Full API suite: **466 passed, 0 failed, 5 skipped**. Four backup/restore tests require Bash/OpenSSL unavailable on this Windows host; the separate-secret shell test is skipped because Bash is unavailable. No new protocol tests were skipped.
- Frontend suite: **1445/1445 passed** (two workers); no frontend source changed.
- Frontend build: passed. Locale check exited successfully; Spanish is **4540/4540**, other existing locales remain partial at 1160/4540.
- API catalog consistency: passed (1324 exercises).
- API Docker image: fresh no-cache build passed. Runtime smoke booted without service credentials; `/api/health` returned `ok=true` and reconciliation returned `423 platform_linking_disabled` with no flags/keys configured.
- `git diff --check`: passed.
- Dependency audit is not clean on the unchanged baseline: API **3 advisories** (1 moderate, 1 high, 1 critical); frontend **21** (1 low, 6 moderate, 10 high, 4 critical). No package manifest or lockfile changed; remediation is outside this bounded task.
- No local `gitleaks`, `trufflehog` or `detect-secrets` executable is installed. No production key or credential was added.

For implementation SHA `c22eadf`, GitHub `test`, `api` and `api-image` all passed. These three checks must remain green on the live PR head. Independent security and QA review is required; do not merge.
