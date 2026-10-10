# TASK 2J-078D — Training verified account proof service

## Outcome

Add the Training-side, backend-only counterpart to Platform 2J-078C. An already-authenticated Training account can issue a short-lived opaque proof for one exact Platform transaction. An authenticated Platform service can exchange it once and receive the verified `trainingUserId`.

`proof exchanged successfully != canonical Training link active`

## Scope delivered

- Passkey-session proof issuance at `POST /api/platform/v1/link-proofs`.
- Service-auth-only exchange at `POST /api/platform/v1/link-proofs/exchange`.
- Opaque 32-byte one-time code; only SHA-256 hash persisted; response is `no-store`.
- Exact binding to transaction, person, audience, purpose, challenge digest, and the session-derived Training account.
- Exact `2J-SERVICE-AUTH-V1` canonical request verifier with multiple key IDs for rotation.
- Durable request replay and proof single-use state in Training's existing encrypted JSON-file data store.
- Independent explicit flags defaulting to false; no production credential is provided.
- Machine-readable errors and metadata-only audit events.

## Explicitly not delivered

No production keys, LIVE linking, canonical `personId` ↔ `trainingUserId` link, remote ACK, SSO, central passkey, UI/redirect, Platform entitlement enforcement, or role/PII synchronization. No Training account/session/passkey semantics were changed.

## Existing mechanisms reused

- Existing `gymsid` session resolution and its `authLevel`; issuance requires the existing passkey-level session, not a shared-staff PIN session.
- Existing `trainingUserId` from the server-resolved session and existing disabled-account state.
- Existing AES-GCM/HKDF `api/lib/crypto.js` helper and `DATA_DIR` persistence location.
- Existing Node HTTP route map, Zod validation, API test harness, and current Training CI jobs.

## Operational constraints

Training persists encrypted proof/replay state in `platform-link-proofs.dat` under `DATA_DIR`. Synchronous read/check/write serializes mutations within one API process and survives a process restart. The current file store does not provide a cross-process lock: do not run multiple API replicas sharing one `DATA_DIR` with either feature enabled. Multi-replica deployment requires a separately reviewed atomic shared store. Keep `DATA_DIR` persistent and protected by the existing data-volume controls.

Proof lifetime is at most two minutes and never exceeds Platform's supplied expiry. Expiry validation accepts up to 30 seconds of clock skew above the five-minute maximum context window; the issued proof still expires no later than the supplied deadline. Service request timestamps have a 60-second freshness window; request IDs remain durable for twice that window.

## Shared signing fixture

Fixture only; secret is deterministic test data and must never be configured in a deployment.

- key ID: `platform-fixture-a`
- key bytes: 32 bytes of `0x42` (base64url: `QkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkI`)
- timestamp: `2026-10-10T12:00:00.000Z`
- request ID: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa`
- method/path: `POST /api/platform/v1/link-proofs/exchange`
- body: `{"v":1,"code":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA","transactionId":"11111111-1111-4111-8111-111111111111","personId":"22222222-2222-4222-8222-222222222222","audience":"2j-training-account-link","purpose":"training-account-link","challengeDigest":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}`
- canonical UTF-8 text (no final newline):

```text
2J-SERVICE-AUTH-V1
platform-fixture-a
2026-10-10T12:00:00.000Z
aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa
POST
/api/platform/v1/link-proofs/exchange
8473ddd28ddf57f9964b66dabac8ff0d4bda6a491e112be5f59633df088ca52a
```

- body digest: `8473ddd28ddf57f9964b66dabac8ff0d4bda6a491e112be5f59633df088ca52a`
- signature: `F6GYp70w6TrZtTCWb4Jcmv3T92UxMyxGpUl2A6oK9oY`

## Independent review gate

Open as one draft PR only. Keep both flags off and stop for independent security review; do not merge or enable LIVE as part of this task.
