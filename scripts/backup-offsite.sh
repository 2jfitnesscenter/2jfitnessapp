#!/usr/bin/env bash
# Off-site, encrypted copy of ./data. Builds on backup-data.sh (same tarball, same integrity checks), then:
#   config check -> disk check -> backup -> AES-256 encrypt -> verify it decrypts -> upload -> verify what arrived -> prune -> status.
# Only the ENCRYPTED file leaves the machine. The passphrase lives OUTSIDE ./data (and is never in the backup), so a stolen
# off-site copy is useless on its own, and ./data/secret (which decrypts every state file) is inside the encrypted archive.
#
# Required env (no default, no secret in the repo; a missing one fails with exit 2 and a clear message):
#   BACKUP_PASSPHRASE_FILE  file holding the passphrase, mode 600, NOT inside ./data. Keep another copy offline (password manager):
#                           without it the off-site copy cannot be restored.
#   BACKUP_REMOTE           destination, one of:
#                             /path/or/mounted/disk          copied with cp
#                             user@host:/dir                 copied with scp (key-based)
#                             rclone:remote:dir              copied with rclone (any provider; rclone must be configured)
# Optional env: BACKUP_DIR (default $HOME/backups), BACKUP_KEEP_DAYS (local retention, default 14), BACKUP_MIN_FREE_MB (default 2048),
#               BACKUP_REMOTE_KEEP (newest N encrypted files kept remotely, ALL remote kinds, default 30),
#               OPS_DIR (where the status files the API reads are written, default ./data/ops)
# Exit codes: 2 missing/invalid configuration, 3 not enough disk, 1 any other failure. Every run writes $OPS_DIR/backup-status.json
# ({"ok":true|false,...}); a failure also says why. Log lines go to stdout/stderr with a UTC timestamp (cron: >> /var/log/2j-backup.log).
# Run from cron, e.g.  17 3 * * *  cd /opt/2jfitness && BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass BACKUP_REMOTE=user@host:/backups scripts/backup-offsite.sh
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

OPS_DIR="${OPS_DIR:-data/ops}"
STARTED="$(date +%s)"; REASON="unexpected_error"; STAGE="start"
log() { printf '%s backup-offsite: %s\n' "$(date -u +%FT%TZ)" "$*"; }
write_status() { # ok(true|false) key=value...  (values are fixed words/numbers, never a path or a secret)
  mkdir -p "$OPS_DIR" 2>/dev/null || return 0
  local ok="$1"; shift
  { printf '{"at":"%s","ok":%s,"seconds":%s' "$(date -u +%FT%TZ)" "$ok" "$(( $(date +%s) - STARTED ))"; for kv in "$@"; do printf ',"%s":"%s"' "${kv%%=*}" "${kv#*=}"; done; printf '}\n'; } > "$OPS_DIR/backup-status.json.tmp" \
    && mv "$OPS_DIR/backup-status.json.tmp" "$OPS_DIR/backup-status.json"
}
on_exit() { local rc=$?; if [ "$rc" -ne 0 ]; then log "FAILED at stage '$STAGE': $REASON (exit $rc)" >&2; write_status false "reason=$REASON" "stage=$STAGE" "exit=$rc"; fi; }
trap on_exit EXIT
die() { local code="$1"; REASON="$2"; shift 2; echo "$(date -u +%FT%TZ) backup-offsite: $*" >&2; exit "$code"; }

STAGE="config"
[ -n "${BACKUP_PASSPHRASE_FILE:-}" ] || die 2 passphrase_not_configured "BACKUP_PASSPHRASE_FILE is not set (a 600 file outside ./data holding the passphrase)"
[ -n "${BACKUP_REMOTE:-}" ] || die 2 remote_not_configured "BACKUP_REMOTE is not set (path, user@host:/dir or rclone:remote:dir)"
OUT_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"
REMOTE_KEEP="${BACKUP_REMOTE_KEEP:-30}"
case "$REMOTE_KEEP" in ''|*[!0-9]*|0) die 2 invalid_remote_keep "BACKUP_REMOTE_KEEP must be a positive integer" ;; esac
export BACKUP_DIR="$OUT_DIR" BACKUP_KEEP_DAYS="$KEEP_DAYS"

test -s "$BACKUP_PASSPHRASE_FILE" || die 2 passphrase_file_missing "passphrase file missing or empty"
case "$(cd "$(dirname "$BACKUP_PASSPHRASE_FILE")" && pwd)/" in
  "$(pwd)/data/"*) die 2 passphrase_inside_data "the passphrase must not live inside ./data" ;;
esac
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) BACKUP_SKIP_MODE_CHECK=1 ;; esac
if [ -z "${BACKUP_SKIP_MODE_CHECK:-}" ]; then
  mode="$(stat -c %a "$BACKUP_PASSPHRASE_FILE" 2>/dev/null || stat -f %Lp "$BACKUP_PASSPHRASE_FILE")"
  case "$mode" in 400|600) ;; *) die 2 passphrase_mode "passphrase file must be mode 600 (is $mode)" ;; esac
fi
case "$BACKUP_REMOTE" in rclone:*) command -v rclone >/dev/null || die 2 rclone_missing "BACKUP_REMOTE uses rclone but rclone is not installed" ;; esac
log "start: remote kind '${BACKUP_REMOTE%%[:/]*}', keep local ${KEEP_DAYS}d, remote ${REMOTE_KEEP} files"

mkdir -p "$OUT_DIR"
# 1. disk: need the larger of MIN_FREE_MB and 3x the size of ./data (plain tarball + encrypted copy + headroom)
STAGE="disk"
data_mb=$(( ($(du -sk data | cut -f1) + 1023) / 1024 ))
need_mb=$(( data_mb * 3 )); [ "$need_mb" -lt "$MIN_FREE_MB" ] && need_mb="$MIN_FREE_MB"
free_mb="$(df -Pm "$OUT_DIR" | awk 'NR==2 {print $4}')"
if [ "$free_mb" -lt "$need_mb" ]; then die 3 disk_low "only ${free_mb} MB free in $OUT_DIR, need ${need_mb} MB"; fi
# The archive is only restorable if it carries the key to its own state files: warn loudly when the secret lives elsewhere (SECRET_FILE).
secret_in_archive=yes; [ -s data/secret ] || { secret_in_archive=no; log "WARNING: data/secret is not in ./data (SECRET_FILE?). The state files in this backup cannot be decrypted without a separate copy of that secret."; }

# 2. the normal local backup (verified tarball)
STAGE="backup"; REASON="local_backup_failed"
archive="$("$SCRIPT_DIR/backup-data.sh" | sed -n 's/^✓ backup saved: //p')"
test -s "$archive"

# 3. encrypt, 4. prove it decrypts to the same valid tarball
STAGE="encrypt"; REASON="encryption_failed"
enc="$archive.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in "$archive" -out "$enc.tmp" -pass "file:$BACKUP_PASSPHRASE_FILE"
REASON="decrypt_check_failed"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$enc.tmp" -pass "file:$BACKUP_PASSPHRASE_FILE" | gzip -t
mv "$enc.tmp" "$enc"
sha="$(sha256sum "$enc" | cut -d' ' -f1)"; bytes="$(wc -c < "$enc" | tr -d ' ')"
echo "$sha  $(basename "$enc")" > "$enc.sha256"

# 5. upload and check what arrived (checksum compared at the destination); then keep only the newest REMOTE_KEEP there
STAGE="upload"; REASON="upload_failed"
name="$(basename "$enc")"
case "$BACKUP_REMOTE" in
  rclone:*) dest="${BACKUP_REMOTE#rclone:}"
            rclone copyto "$enc" "$dest/$name" && rclone copyto "$enc.sha256" "$dest/$name.sha256"
            REASON="remote_integrity_failed"; rclone check "$OUT_DIR" "$dest" --one-way --include "$name" >/dev/null
            REASON="remote_retention_failed"
            rclone lsf "$dest" --files-only --include '2jfitness-*.tar.gz.enc' | sort -r | tail -n +$((REMOTE_KEEP + 1)) | while read -r old; do rclone deletefile "$dest/$old"; rclone deletefile "$dest/$old.sha256" 2>/dev/null || true; done ;;
  [A-Za-z]:/*|/*|./*)  mkdir -p "$BACKUP_REMOTE"; cp "$enc" "$enc.sha256" "$BACKUP_REMOTE/"
            REASON="remote_integrity_failed"; (cd "$BACKUP_REMOTE" && sha256sum -c "$name.sha256" >/dev/null)
            REASON="remote_retention_failed"; (cd "$BACKUP_REMOTE" && ls -1t 2jfitness-*.tar.gz.enc 2>/dev/null | tail -n +$((REMOTE_KEEP + 1)) | while read -r old; do rm -f -- "$old" "$old.sha256"; done) ;;
  *:*)      scp -q -o BatchMode=yes "$enc" "$enc.sha256" "$BACKUP_REMOTE/"
            REASON="remote_integrity_failed"
            ssh -o BatchMode=yes "${BACKUP_REMOTE%%:*}" "cd '${BACKUP_REMOTE#*:}' && sha256sum -c '$name.sha256' >/dev/null && ls -1t 2jfitness-*.tar.gz.enc | tail -n +$((REMOTE_KEEP + 1)) | xargs -r rm -f --" ;;
  *)        mkdir -p "$BACKUP_REMOTE"; cp "$enc" "$enc.sha256" "$BACKUP_REMOTE/"; REASON="remote_integrity_failed"; (cd "$BACKUP_REMOTE" && sha256sum -c "$name.sha256" >/dev/null) ;;
esac

# 6. local pruning of encrypted copies (the plain tarballs are pruned by backup-data.sh), 7. status for monitoring
STAGE="finish"; REASON="status_write_failed"
find "$OUT_DIR" -name '2jfitness-*.tar.gz.enc*' -mtime "+$KEEP_DAYS" -delete
printf '{"at":"%s","file":"%s","bytes":%s,"sha256":"%s","remote":"%s"}\n' "$(date -u +%FT%TZ)" "$name" "$bytes" "$sha" "${BACKUP_REMOTE%%:*}" > "$OUT_DIR/last-offsite.json"
write_status true "file=$name" "bytes=$bytes" "sha256=$sha" "remote=${BACKUP_REMOTE%%[:/]*}" "secretInArchive=$secret_in_archive" "remoteKeep=$REMOTE_KEEP"
log "OK: $name ($bytes bytes, sha256 $sha)"
echo "✓ off-site backup: $name ($bytes bytes, sha256 $sha)"
