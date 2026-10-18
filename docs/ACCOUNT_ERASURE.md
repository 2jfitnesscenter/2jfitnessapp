# Account export and erasure

**Export** — Settings → Account → *Export my data* (`GET /api/me/export`): one JSON file with the account record (no passkey public keys, no provider tokens — only whether Strava/WHOOP are linked),
the full synced state (workouts, body, Health aggregates, notes), the follow-up questionnaire answers and the descriptors (date, type, note) of progress photos — **not the photo image files and not staff's private professional notes** —, the messages the member wrote, friends/requests/blocks, community posts and comments they wrote, goals and joined challenges,
notifications and privacy preferences, shares and reports they made, and their Bunker check-in PIN. Other people's text is never included.

**Erasure** — Settings → Account → *Delete my account*. Server rules (`api/lib/account-erasure.js`, `POST /api/me/delete/options` + `POST /api/me/delete`):
1. Only the signed-in member, and only with a **fresh passkey assertion from that same account** (a stolen cookie is not enough) **plus the typed username**.
2. Members only. Admin/trainer accounts are refused (`staff`): their content belongs to the gym; an admin removes the role first.
3. Removes: account record, passkeys, push subscriptions, recovery links/requests, `state-<uid>.json`, chat threads they are part of (**both sides lose them**) and their messages, friend code/requests/blocks,
   notifications (own inbox, preferences, and notifications elsewhere that name them), shares they authored and reports by/about them, Bunker PIN/codes/live session, community posts, comments, goals, challenges they
   created and their participation, the Coach per-user record, every uploaded image they own (avatar, routine images), and their follow-up data: questionnaire answers, staff's private notes (they live on the account record) and the progress-photo files, which are unlinked from `followup-photos/`. The accounts file is written last, so a failure midway leaves a retryable account.
4. Idempotent and covered by `api/test/account-erasure.test.js`, which seeds one member with data in every store and scans **every file in `./data`** for any identifier after the call.
5. Removes all device-session records for the account. Security-event rows linked to the account as subject or actor keep only anonymous event/time/action facts: account/actor links and metadata are removed so handles or targets cannot retain a direct identity reference.

**Retention** — the account-linked event facts above remain anonymized for the bounded security audit log; they are no longer attributable to the deleted member. Other anonymous residue by design includes gym-wide machine/import aliases (no person), and an invite code stays single-use (`usedBy: "deleted-account"`). Earlier copies may remain in backups until their configured expiry.

**What the public policy says (docs/PRIVACY_POLICY.md §11) and why it matches:** Trainer and admin accounts cannot be deleted in the app (rule 2: an admin removes the role first); disconnecting or erasing drops the WHOOP/Strava tokens kept here but does **not** revoke the grant at the provider (`/api/strava/disconnect`, `/api/whoop/disconnect` only clear the local token) nor delete activities already created in Strava; AI providers receive payloads that 2J does not store; backups (the Auto Backup service contracted with the hosting provider) keep earlier copies until they expire — scope, frequency and retention are `LEGAL_TBD_BACKUP_SCOPE` / `LEGAL_TBD_BACKUP_FREQUENCY` / `LEGAL_TBD_BACKUP_RETENTION`, not yet verified.

## Decisions the owner should confirm (defaults implemented as written above)
1. *No legal/financial retention needed.* The app stores no payments or invoices; if the gym must keep membership records for legal reasons, that lives outside 2J. Say so if a retention period is required and we will add a tombstone record.
2. *Both sides lose a deleted conversation* (the other person also loses the thread). Alternative: keep the other person's messages with the author shown as "deleted user".
3. *Backups:* erased data remains in existing backups until they expire (Contabo's Auto Backup; the backup script's local default is 14 days and its off-site option is not in use — real scope, frequency and retention are `LEGAL_TBD_BACKUP_SCOPE` / `LEGAL_TBD_BACKUP_FREQUENCY` / `LEGAL_TBD_BACKUP_RETENTION`). Documented here; restoring an old backup would resurrect an erased account.
4. *Provider side:* WHOOP/Strava access must be revoked by the member in those apps; AI providers keep nothing that 2J can delete (no payload is stored on our side).
5. *Staff self-erasure* stays manual (remove role, then erase).
