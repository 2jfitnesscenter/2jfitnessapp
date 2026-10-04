# Account export and erasure

**Export** — Settings → Account → *Export my data* (`GET /api/me/export`): one JSON file with the account record (no passkey public keys, no provider tokens — only whether Strava/WHOOP are linked),
the full synced state (workouts, body, Health aggregates, notes), the messages the member wrote, friends/requests/blocks, community posts and comments they wrote, goals and joined challenges,
notifications and privacy preferences, shares and reports they made, and their Bunker check-in PIN. Other people's text is never included.

**Erasure** — Settings → Account → *Delete my account*. Server rules (`api/lib/account-erasure.js`, `POST /api/me/delete/options` + `POST /api/me/delete`):
1. Only the signed-in member, and only with a **fresh passkey assertion from that same account** (a stolen cookie is not enough) **plus the typed username**.
2. Members only. Admin/trainer accounts are refused (`staff`): their content belongs to the gym; an admin removes the role first.
3. Removes: account record, passkeys, push subscriptions, recovery links/requests, `state-<uid>.json`, chat threads they are part of (**both sides lose them**) and their messages, friend code/requests/blocks,
   notifications (own inbox, preferences, and notifications elsewhere that name them), shares they authored and reports by/about them, Bunker PIN/codes/live session, community posts, comments, goals, challenges they
   created and their participation, the Coach per-user record, and every uploaded image they own (avatar, routine images). The accounts file is written last, so a failure midway leaves a retryable account.
4. Idempotent and covered by `api/test/account-erasure.test.js`, which seeds one member with data in every store and scans **every file in `./data`** for any identifier after the call.

**Retention** — nothing about the member is kept. Anonymous residue by design: gym-wide machine/import aliases (no person), and an invite code stays single-use (`usedBy: "deleted-account"`).

## Decisions the owner should confirm (defaults implemented as written above)
1. *No legal/financial retention needed.* The app stores no payments or invoices; if the gym must keep membership records for legal reasons, that lives outside 2J. Say so if a retention period is required and we will add a tombstone record.
2. *Both sides lose a deleted conversation* (the other person also loses the thread). Alternative: keep the other person's messages with the author shown as "deleted user".
3. *Backups:* erased data remains in existing backups until they expire (local 14 days, off-site `BACKUP_REMOTE_KEEP` copies). Documented here; restoring an old backup would resurrect an erased account.
4. *Provider side:* WHOOP/Strava access must be revoked by the member in those apps; AI providers keep nothing that 2J can delete (no payload is stored on our side).
5. *Staff self-erasure* stays manual (remove role, then erase).
