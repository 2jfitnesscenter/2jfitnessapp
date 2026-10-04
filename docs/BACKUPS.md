# Backups — off-site, encrypted, restorable

Before Sprint 3 the only copies were `backup-data.sh` tarballs and the pre-deploy tarballs in `/root/backups` **on the same VPS** — a lost server meant lost data. Sprint 3 adds an
off-site mechanism that needs only two things from the owner (below). Nothing is scheduled or uploaded until they are provided.

## What is backed up
`./data` whole: `db.json` (accounts, passkey public keys, push subscriptions), `state-<uid>.json` (workouts, body, Health aggregates — AES-256-GCM at rest), `secret` (decrypts those
files and signs sessions), `chat/friends/social/notifications/bunker/coach/*.json`, `vapid.json`, `features.json`. The archive therefore contains the key to its own state files —
**the archive must be encrypted before it leaves the VPS** (done by `scripts/backup-offsite.sh`: AES-256-CBC, PBKDF2 600k, salted, passphrase outside `./data`).

## Pieces
| Script | Does |
|---|---|
| `scripts/backup-data.sh` | tarball of `./data`, integrity-checked, keeps `BACKUP_KEEP_DAYS` (14) |
| `scripts/backup-offsite.sh` | disk check → backup → encrypt → prove it decrypts → upload (path / `user@host:/dir` / `rclone:remote:dir`) → remote retention (newest 30) → `last-offsite.json` |
| `scripts/restore-backup.sh` | `--verify-only` or restore into an EMPTY directory; never touches live `./data`; detects wrong passphrase (exit 5), corrupt copy (4), non-empty target (7) |
| `scripts/disk-check.sh [path] [min%]` | cron guard, exit 1 when less than 15 % is free |

Tests: `api/test/backup-offsite.test.js` (encryption, no plaintext off-site, restore rehearsal, wrong passphrase, corruption, preconditions, disk guard).

## What the owner provides (the only decisions)
1. **A destination** you control: another server over SSH (key-based), a mounted/object-storage disk via `rclone`, or any path. Cheapest sound choice: a Backblaze B2 / Hetzner Storage Box / second small VPS.
2. **A passphrase**, written to a `600` file on the VPS *outside `./data`* (e.g. `/root/.2j-backup-pass`) **and** stored offline (password manager). Without it the off-site copies cannot be opened.

## Install (on the VPS, once)
```
chmod 600 /root/.2j-backup-pass
# daily at 03:17, disk guard at 03:00
0 3 * * *  cd /opt/2jfitness && scripts/disk-check.sh / 15 || echo "2J disk low" | mail -s alert you@example.com
17 3 * * * cd /opt/2jfitness && BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass BACKUP_REMOTE=user@host:/srv/2j-backups scripts/backup-offsite.sh >> /var/log/2j-backup.log 2>&1
```
Monitor `$BACKUP_DIR/last-offsite.json` (`at` older than 36 h = alarm).

## Restore rehearsal (do it once after installing, then quarterly)
```
BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass scripts/restore-backup.sh --verify-only 2jfitness-<stamp>.tar.gz.enc
BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass scripts/restore-backup.sh 2jfitness-<stamp>.tar.gz.enc /tmp/restore-test
# real recovery: stop the API, move ./data aside (keep it), put /tmp/restore-test/data in its place, start the API, check /api/health and one login
```
The pre-deploy tarballs in `/root/backups` stay as the fast rollback; they are not off-site.
