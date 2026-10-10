# TASK 2J-078F-A — Training durable proof receipt and reconciliation

## Goal

Make a successfully consumed Platform proof recoverable after an exchange response is lost, without making the raw proof reusable. Training persists an immutable verification receipt atomically with `pending → consumed`, and exposes it only through a path-bound, service-authenticated reconciliation endpoint.

## Acceptance criteria

- `POST /api/platform/v1/link-proofs/exchange` keeps passkey-derived issuance, strict context binding, hash-only raw-code persistence, one-time consumption, TTL and existing response contract.
- One synchronous encrypted-store write commits proof consumption and the immutable receipt together. A persistence failure must not return success.
- Receipt context binds transaction, person, audience, purpose and challenge digest; conflicting Training subjects fail closed, and a second proof cannot claim another success for an already receipted context.
- `POST /api/platform/v1/link-proofs/reconcile` accepts only strict V1 context (no proof code or caller Training identity), requires exact `2J-SERVICE-AUTH-V1` for its own path and uses the existing service-key allowlist/replay persistence.
- Exact successful context returns its same receipt with digest; every absent/mismatched context returns generic `404 verification_receipt_not_found`.
- Receipts are retained indefinitely in this phase, independent of 90-day proof cleanup; historical reconciliation does not check current account-enabled state.
- Add a separate `PLATFORM_PROOF_RECONCILIATION_ENABLED=false` gate; credentials or configuration do not enable any flags.
- Keep the integration shadow-only. No canonical link, remote ACK, lifecycle, SSO, production credentials, deployment, multi-replica claim or fsync claim.
- Update the handoff and run full API/frontend/build/image/audit/secret-scan checks available in this environment.

## Receipt schema and persistence

Store the receipt alongside existing proof state in the existing encrypted `platform-link-proofs.dat` file:

```json
{
  "receiptId": "UUID",
  "receiptVersion": 1,
  "proofId": "UUID",
  "transactionId": "UUID",
  "personId": "UUID",
  "audience": "2j-training-account-link",
  "purpose": "training-account-link",
  "challengeDigest": "64 lowercase hex",
  "trainingUserId": "opaque Training identity",
  "verifiedAt": "canonical UTC timestamp"
}
```

The raw proof code and code hash are not receipt fields. Proofs continue their existing bounded cleanup; receipts do not expire or get pruned in this phase. The file mutation is synchronous and single-process atomic at the rename boundary. It does not provide fsync/power-loss durability or multi-process/multi-replica coordination.

## Reconciliation API

`POST /api/platform/v1/link-proofs/reconcile` uses only transactionId, personId, audience, purpose and challengeDigest. It returns `404 verification_receipt_not_found` for all exact-context misses and `409 verification_receipt_conflict` for conflicting authoritative subjects. It requires a fresh requestId and a signature canonicalized over the exact reconcile path; a new signed request for the same context returns the same immutable receipt.

`verification receipt recovered != canonical Training link active`

## Out of scope

Canonical person/account link, `linkId`, active lifecycle/linkVersion, ACK, SSO, shared login/passkey, production enablement, Platform repository changes, unrelated Training P3s, fsync and multi-replica storage.
