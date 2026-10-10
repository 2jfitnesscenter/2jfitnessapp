# Security / Ops V1

Backend and operations only. No visible UX, no product behaviour changed. Baseline: production `dd7897a294095a2f615cff24cfa2720bfd65d6e1`.

What this adds on top of `docs/BACKUPS.md` (which stays the install guide): a backup that reports success **and** failure, a restore rehearsal that proves the data is usable (not just that it untars), a read-only admin ops view, a deploy marker, two cron-friendly scripts, and the exact steps to protect `main`.

## 1. Backup

`scripts/backup-data.sh` (nightly tarball of `./data`, integrity-checked, 14 days locally) is unchanged. `scripts/backup-offsite.sh` now does, in order, each stage reporting its own failure reason:

config → disk → local backup → AES-256-CBC (PBKDF2 600 000, salted) → **decrypt check** → upload → **integrity check at the destination** → remote retention → local pruning → status.

| Concern | How |
|---|---|
| Destination (configurable) | `BACKUP_REMOTE`: a path/mounted disk, `user@host:/dir` (scp/ssh, key-based), or `rclone:remote:dir` (any provider) |
| Encryption | Only the encrypted file leaves the machine. Passphrase in a `600` file **outside** `./data` (`BACKUP_PASSPHRASE_FILE`); plaintext tarball never uploaded |
| Retention | Local: `BACKUP_KEEP_DAYS` (14). Remote: newest `BACKUP_REMOTE_KEEP` (30) encrypted files, **now for all three remote kinds** (rclone had none before) |
| Integrity | sha256 sidecar; checked at the destination (`sha256sum -c` / `rclone check`); a damaged upload is a failure, not a success |
| Logs | Timestamped (UTC) lines on stdout/stderr (`>> /var/log/2j-backup.log`) |
| Status | Every run writes `data/ops/backup-status.json` (`ok`, `at`, `seconds`, and on failure `reason` + `stage` + `exit`). Fixed words and numbers only |
| Clear failure | Missing remote / passphrase / rclone / bad mode / passphrase inside `./data` / bad `BACKUP_REMOTE_KEEP` → **exit 2** with a message; low disk → **exit 3**; anything else → 1 |
| Secret outside `./data` | If `SECRET_FILE` moved the secret out, the archive cannot decrypt its own state files: the run warns and records `secretInArchive:"no"` (an ops alert). Keep a separate copy of that secret |

### Offsite status

**The mechanism is real and tested; the destination is not configured in this repository** (it cannot be: it needs the owner's destination and passphrase, which never live in the repo). Until `BACKUP_REMOTE` and the passphrase file exist on the VPS and the cron line is installed, no off-site copy exists. The admin ops view shows `backup: never` until then. See `docs/BACKUPS.md` → "What the owner provides" and "Install".

## 2. Restore rehearsal

`scripts/restore-rehearsal.sh [--boot] <file.tar.gz.enc> [<empty-work-dir>]`, with `BACKUP_PASSPHRASE_FILE`:

1. **verify** — checksum, decrypts, valid archive with `data/` (`restore-backup.sh --verify-only`).
2. **restore** — into a throw-away directory (default `mktemp`), refused if it is production's `./data`, inside it, or not empty.
3. **validate** (`scripts/validate-restore.mjs`) — `db.json` parses and has users; the secret is **in the archive** (`SECRET_FILE` is ignored on purpose); every `state-<uid>.json` is read through the app's own reader (so the decryption key is proven); the other JSON stores parse; orphan states are counted.
4. **boot** (`--boot`) — a throw-away API process on a random port against the copy; `/api/health` must answer with the same user count.
5. The directory is deleted (`KEEP_REHEARSAL=1` keeps it). Production's `./data`, the live API and the live secret are never read or written.

Each step prints its seconds; the result is `data/ops/restore-status.json` (`ok`, users, states, `boot`, `verifySeconds`, `restoreSeconds`, `validateSeconds`; on failure the failing `stage`). Exit codes: 2 config, 4 checksum, 5 wrong passphrase, 6 no `data/`, 7 non-empty work dir, 8 validation failed.

**Node for the validation:** `NODE_COMMAND` (default `node`, split on spaces). A host without Node borrows one from a **throw-away** container of the API image: offline (`--network none`), read-only mounts of the scripts and of the work dir only, no production volume, so nothing of production is readable or writable:
```
NODE_COMMAND="docker run --rm --network none --entrypoint node -v /root/ops-v1:/root/ops-v1:ro -v /root/ops-v1/tmp/w:/root/ops-v1/tmp/w:ro <api-image>" \n  scripts/restore-rehearsal.sh <file.enc> /root/ops-v1/tmp/w
```
A fixed work dir is needed so the mount path matches. A missing Node fails at once with exit 2 (`Node not found`). `--boot` needs a full checkout with `node_modules`: run it on a machine that has one.

Procedure (quarterly, and once right after installing the off-site job):
```
# on any machine that has the repo checkout and node (not necessarily the VPS)
scp user@backup-host:/srv/2j-backups/2jfitness-<stamp>.tar.gz.enc* /tmp/rehearsal/
BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass scripts/restore-rehearsal.sh --boot /tmp/rehearsal/2jfitness-<stamp>.tar.gz.enc
```
**Measured on a synthetic data set (2 members) with the test suite:** verify+restore+validate+boot ≈ 5 s, dominated by the 600 000-iteration key derivation (three decrypt passes) and API start-up. Production-size timings are **not measured here**: run the rehearsal once against a real off-site file and write the numbers in `docs/BACKUPS.md`. Time grows with the size of `./data`.

### Real recovery (not a rehearsal)
1. Fetch the newest `.enc` + `.sha256`; `restore-backup.sh --verify-only` it.
2. `restore-backup.sh <file> /tmp/restored` (never writes into the live `./data`).
3. Stop the API; move `./data` aside (keep it); put `/tmp/restored/data` in its place; start the API.
4. Check `/api/health`, one login, one member's history. If anything is off, put the old `./data` back.
5. Write down in `AI_HANDOFF.md` what was restored and from which file.
The pre-deploy tarballs in `/root/backups` stay the fast rollback; they are on the same VPS and are not off-site.

## 3. Protecting `main` (state found + exact steps)

**Applied (2026-10-10), via the GitHub API:** `main` requires a pull request (0 approvals: a single maintainer cannot approve their own PR), the checks `test`, `api` and `api-image` with the branch up to date, and allows no force push and no deletion. Administrators are **not** forced (emergency bypass kept). The `paths:` filter on `pull_request` was removed from `test.yml` (it would have left docs- and scripts-only PRs without the required checks) and that change is merged. Check: `gh api repos/2jfitnesscenter/2jfitnessapp/branches/main/protection`. The rest of this section is the rule as recommended and the command that applied it.

CI (`.github/workflows/test.yml`, workflow "Tests"): jobs `test` (frontend), `api`, `api-image`. It runs on every pull request, and on pushes to `main` that touch `frontend/**`, `api/**` or the workflow.

Recommended rule for `main`:
- Pull request required (no direct pushes), **0 required approvals** while there is a single maintainer (GitHub does not let an author approve their own PR; 1 approval would lock the owner out) — raise to 1 when there is a second reviewer.
- Required status checks: `test`, `api`, `api-image`, branch up to date before merge.
- No force pushes, no deletion, conversations resolved.
- Do not enforce for admins at first (keeps an emergency path); revisit after a month.

**Gotcha:** required checks plus the `paths:` filter means a docs-only or `scripts/`-only PR never gets the checks and cannot merge. Before turning checks on, either remove the `paths:` filters from `pull_request` in `test.yml`, or add a tiny always-green job that those paths trigger. This is a workflow change and is not made here.

Exact command (run it yourself, or tell me to; it is idempotent):
```
gh api -X PUT repos/2jfitnesscenter/2jfitnessapp/branches/main/protection --input - <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": ["test", "api", "api-image"] },
  "enforce_admins": false,
  "required_pull_request_reviews": { "required_approving_review_count": 0, "dismiss_stale_reviews": true },
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": true
}
JSON
```
Check: `gh api repos/2jfitnesscenter/2jfitnessapp/branches/main/protection`. Undo: `gh api -X DELETE repos/2jfitnesscenter/2jfitnessapp/branches/main/protection`. Do it **after** resolving the `paths:` gotcha, and note that the deploy runners do not push to `main`.

## 4. Observability (minimal, no SaaS)

- **`GET /api/admin/ops`** (admin only; 401/403 otherwise; no new UI): `backup` and `restore` state (`never|ok|stale|failed|due`, age, reason), `deploy` marker (sha, age), `disk` (free % / MB), `uptimeSec`, `users`, `errors` (count of 5xx since boot + the last 20: **route, status, time only**, no body, user or address) and `alerts` (`backup_never|backup_stale|backup_failed|restore_never|restore_due|restore_failed|secret_not_in_archive|disk_low`; `ok` = no alerts). Thresholds: backup older than 36 h = stale, rehearsal older than 100 days = due, disk under 15 % = low.
- **`GET /api/health`** stays public and exactly as before (`ok`, `users`) so nothing external changes.
- **Deploy marker:** `scripts/mark-deploy.sh <git-sha> ["note"]` writes `data/ops/deploy-marker.json`. The server-side release runner calls it **automatically as the very last step of a successful deploy** (after every probe, health and data check; `DEPLOY_MARKER=ok:<sha>` in its output). A failed check, a rollback or an aborted deploy never reaches that step, so the marker keeps naming the release that is really running. Writing it is best-effort: a missing script or an unwritable `data/ops` prints `DEPLOY_MARKER=SKIPPED:…` and never fails or rolls back a good deploy. Still usable by hand.
- **Alarm from cron, no network, no Node:** `scripts/ops-check.sh [min_free%]` is pure shell + coreutils, so it runs on a host that only has Docker. It reads `data/ops/backup-status.json` and `restore-status.json` (mode 700 root:root is fine when run as root, as cron does; a file the user cannot read is reported as such, not as "never ran") and exits 1 with the reason when the backup failed / is older than 36 h / never ran, a rehearsal failed, or the disk is low. A rehearsal that is due (> 100 days) or never done is only a `note:`. Without `OPS_ALERT_COMMAND` it works the same.
- **Cron + logrotate, one idempotent command:** `sudo /opt/2jfitness/scripts/install-ops-cron.sh` (`--print` shows without changing). It keeps ONE managed block in root's crontab (`17 3 * * *` the off-site backup, `*/30 * * * *` the ops-check, both sourcing `/etc/2j-ops.env`, logs in `/var/log/2j-backup.log` and `/var/log/2j-ops-check.log`), removes the older hand-made lines so nothing runs twice, and writes `/etc/logrotate.d/2j-ops` (`su root root`, weekly, rotate 8, compress, missingok, notifempty). `/etc/2j-ops.env` must already exist (paths and names only, never a secret in the crontab). **The release runner runs it after every good deploy** (`OPS_CRON=ok` in its output; skipped without failing the deploy when the env file is missing or outside `/opt/2jfitness`).
- **Alert hook (no provider, no secret in the repo):** set `OPS_ALERT_COMMAND` to any command you trust (a mail wrapper, a curl script…; its credentials live in its own config on the server). `ops-check.sh` runs it as `bash -c "$OPS_ALERT_COMMAND" ops-alert "<message>"`: the message is `$1`, is also on stdin and in `OPS_ALERT_STATUS` (`alarm|recovered|test`), `OPS_ALERT_SUBJECT`, `OPS_ALERT_MESSAGE`, and is **never spliced into the command line** (text from the status files cannot execute). It sends when an alarm starts or changes, repeats the same one at most every `OPS_ALERT_REPEAT_MIN` (360), says `recovered` once when it clears, and is killed after `OPS_ALERT_TIMEOUT_SEC` (30). A failing command is reported on stderr and retried next run. The exit code is the check's own (1 on any alarm) whether or not a command is configured. `scripts/ops-check.sh --alert-test` proves the wiring. **Reference command shipped in the repo:** `scripts/ops-alert.sh` logs to `/var/log/2j-alerts.log` + syslog and sends to whatever the owner puts in `/etc/2j-alert.conf` (root, 600): `ALERT_WEBHOOK_URL=...` (form POST) and/or `ALERT_MAIL_TO=...`. `ops-check.sh` uses it by itself when that file exists and `OPS_ALERT_COMMAND` is not set, so choosing a destination is a one-line file, nothing else. Email/Slack/Telegram are deliberately not integrated: that is the command's job.
- Server failures were already `console.error`'d (docker logs); the ring above makes them visible without shell access.

The status files live in `data/ops/` and are therefore inside the backups; they are tiny and contain no secret.

## 5. Secrets

- Never in the repo: the passphrase file, the destination credentials (ssh key / rclone config), `data/secret`, `SECRET_FILE`.
- The passphrase has **two** copies: the `600` file on the VPS (outside `./data`) and an offline one (password manager). Lose both and the off-site copies are unreadable.
- Status files and logs contain only fixed words, numbers, file names and sha256 of the **encrypted** file.
- `ops-check.sh`, `mark-deploy.sh` and the ops endpoint read/write nothing secret and take no credentials.

## 6. Tests (`api/test/security-ops.test.js`, plus the existing `backup-offsite.test.js`)

Success status/log; missing remote / passphrase / invalid keep (exit 2, failed status, nothing uploaded); damaged upload = integrity failure; remote retention (newest N); secret-outside warning; rehearsal restore + validate + boot with production untouched; corrupt archive (exit 4), wrong passphrase (5), missing passphrase (2), unreadable member state (8), non-empty work dir (7); ops-status states and alarms, clipping, no field leak; error ring; deploy marker (sha validation, injection stripped); `ops-check`; the admin endpoint (401/403/200, public health unchanged); a real 5xx appearing in the ring.

## 7. Pending risks

1. **No off-site copy exists until the owner supplies the destination + passphrase and installs the cron line.** This is the biggest open risk; everything above only matters once that is done.
2. `main` is protected without forcing administrators (emergency bypass). Raise to required reviews once there is a second maintainer.
3. A restore has never been rehearsed against production-size data; timings above are synthetic.
4. The deploy marker is written by the runner only from the first release that includes this change; until then it is empty (`deploy: null`) or set by hand.
5. If `SECRET_FILE` separates the secret in production, the backups need a separate, equally protected copy of it (the status flags it).
6. `ops-check.sh` can alert through `OPS_ALERT_COMMAND` (provider-agnostic), but until the owner chooses a destination (a webhook URL or a mail address in `/etc/2j-alert.conf`) the wrapper only logs locally: nothing pages anyone. This is the only open human step.
7. The off-site destination and the VPS share an owner account: use a destination with separate credentials and, ideally, append-only/versioned storage so a compromised server cannot delete its own backups.
