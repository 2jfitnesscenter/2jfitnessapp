# Encryption — findings and decisions (chat encryption: DONE in Sprint 3; key separation: DONE, opt-in)

## Verified today (code, not comments)
- Encrypted at rest (AES-256-GCM, `api/lib/crypto.js`, HKDF per feature): every `state-<uid>.json` (workouts, body, measurements, Health aggregates, Sync V2 meta) via `lib/state-store.js`; Strava/WHOOP client secrets and tokens; Coach/Trainer-AI/Aux-AI credentials.
- **Plain on disk:** `db.json` (accounts, passkey public keys, push subscriptions, invites, recovery requests), `chat.json` (private messages), `friends.json`, `social.json`, `notifications.json`, `bunker.json` (member PINs + admin codes), `news`, `features`.
- The AES key derives from `./data/secret`, stored beside the data and **inside every backup**. So the encryption defends against a partial leak, not against a copy of the whole folder (already stated in SECURITY.md).
- Health data is not stored anywhere else on the server in clear: Health Connect/HealthKit aggregates live only in the encrypted state file. Nothing sensitive was found in logs.

## Risk ranking of what is still plain
1. `chat.json` — private message text (personal, not health). Highest value to protect.
2. `bunker.json` — 4-digit PINs (low value: kiosk check-in token only; admins can list them by design).
3. `db.json` — public keys and push endpoints (not secret); `social/friends/notifications` — social graph metadata.

## Proposal (smallest step that changes the risk): encrypt `chat.json` with the same helper
- Mechanism: copy `state-store.js`'s pattern — file starting with `{` is legacy plain JSON, anything else is `encrypt(…, 'chat-store')`; the first write after upgrade converts it. One module (`chat/store.js` `save()`/load) changes; no endpoint, no client change.
- Compatibility: reads both formats, so deploying is safe; search/pagination run in memory after load (no query depends on the file format).
- **Irreversibility / rollback:** after the first write the file is no longer readable by the previous release. Rollback needs a decrypt script (`scripts/decrypt-chat.mjs`, ~15 lines) or restoring the pre-deploy tarball (chat messages sent since would be lost). Hence: take the predeploy backup (already in the runner), and run the migration under an explicit go-ahead.
- Not proposed: encrypting `db.json`/social files (no sensitive payload, high blast radius if the secret is lost), re-keying `secret` away from the data folder (requires an external KMS/env secret and a migration of every state file — an architecture decision).
- Optional hardening with real value and no migration: keep `secret` out of the *off-site* backup copy and store it separately (offline) — then a stolen backup holds ciphertext only. Today the encrypted backup protects it with the passphrase instead; choose one.

## Decision needed
Approve "encrypt chat.json with fallback read" (recommended) — yes / no / later. Until then chat remains plain and documented.

## Update (Sprint 3 close): approved and implemented
- `chat.json` is AES-256-GCM (`chat/store.js`): dual read (legacy `{…}` or encrypted blob), atomic boot-time conversion verified by decrypting the temp file before the rename, **read-only mode on an unreadable file** so a wrong key can never overwrite the chat with an empty one. Rollback: `api/scripts/decrypt-chat.mjs --write` (keeps `chat.json.enc-bak`) or the pre-deploy tarball. Tests: `api/test/chat-encryption.test.js`.
- The key can live outside `./data` (`SECRET_FILE`, `docs/KEY_SEPARATION.md`); nothing is re-encrypted. Activation is an ops step after deploy, with its own offline-copy safeguard.
- Still plain by decision: `db.json`, social/friends/notifications, Bunker PINs (low sensitivity, high blast radius).
