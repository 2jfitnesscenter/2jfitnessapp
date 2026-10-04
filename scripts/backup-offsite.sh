#!/usr/bin/env bash
# Off-site, encrypted copy of ./data. Builds on backup-data.sh (same tarball, same integrity checks), then:
#   disk check -> backup -> AES-256 encrypt -> verify it decrypts -> upload -> prune -> status file.
# Only the ENCRYPTED file leaves the machine. The passphrase lives OUTSIDE ./data (and is never in the backup), so a stolen
# off-site copy is useless on its own, and ./data/secret (which decrypts every state file) is inside the encrypted archive.
#
# Required env:
#   BACKUP_PASSPHRASE_FILE  file holding the passphrase, mode 600, NOT inside ./data. Keep another copy offline (password manager):
#                           without it the off-site copy cannot be restored.
#   BACKUP_REMOTE           destination, one of:
#                             /path/or/mounted/disk          copied with cp
#                             user@host:/dir                 copied with scp (key-based)
#                             rclone:remote:dir              copied with rclone (any provider; rclone must be configured)
# Optional env: BACKUP_DIR (default $HOME/backups), BACKUP_KEEP_DAYS (default 14), BACKUP_MIN_FREE_MB (default 2048),
#               BACKUP_REMOTE_KEEP (local-path/scp only: newest N encrypted files kept remotely, default 30)
# Run from cron, e.g.  17 3 * * *  cd /opt/2jfitness && BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass BACKUP_REMOTE=user@host:/backups scripts/backup-offsite.sh
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE (a 600 file outside ./data)}"
: "${BACKUP_REMOTE:?set BACKUP_REMOTE (path, user@host:/dir or rclone:remote:dir)}"
OUT_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-2048}"
REMOTE_KEEP="${BACKUP_REMOTE_KEEP:-30}"
export BACKUP_DIR="$OUT_DIR" BACKUP_KEEP_DAYS="$KEEP_DAYS"

test -s "$BACKUP_PASSPHRASE_FILE" || { echo "backup-offsite: passphrase file missing or empty" >&2; exit 2; }
case "$(cd "$(dirname "$BACKUP_PASSPHRASE_FILE")" && pwd)/" in
  "$(pwd)/data/"*) echo "backup-offsite: the passphrase must not live inside ./data" >&2; exit 2 ;;
esac
case "$(uname -s)" in MINGW*|MSYS*|CYGWIN*) BACKUP_SKIP_MODE_CHECK=1 ;; esac
if [ -z "${BACKUP_SKIP_MODE_CHECK:-}" ]; then
  mode="$(stat -c %a "$BACKUP_PASSPHRASE_FILE" 2>/dev/null || stat -f %Lp "$BACKUP_PASSPHRASE_FILE")"
  case "$mode" in 400|600) ;; *) echo "backup-offsite: passphrase file must be mode 600 (is $mode)" >&2; exit 2 ;; esac
fi

mkdir -p "$OUT_DIR"
# 1. disk: need the larger of MIN_FREE_MB and 3x the size of ./data (plain tarball + encrypted copy + headroom)
data_mb=$(( ($(du -sk data | cut -f1) + 1023) / 1024 ))
need_mb=$(( data_mb * 3 )); [ "$need_mb" -lt "$MIN_FREE_MB" ] && need_mb="$MIN_FREE_MB"
free_mb="$(df -Pm "$OUT_DIR" | awk 'NR==2 {print $4}')"
if [ "$free_mb" -lt "$need_mb" ]; then echo "backup-offsite: only ${free_mb} MB free in $OUT_DIR, need ${need_mb} MB" >&2; exit 3; fi

# 2. the normal local backup (verified tarball)
archive="$("$SCRIPT_DIR/backup-data.sh" | sed -n 's/^✓ backup saved: //p')"
test -s "$archive"

# 3. encrypt, 4. prove it decrypts to the same valid tarball
enc="$archive.enc"
openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -salt -in "$archive" -out "$enc.tmp" -pass "file:$BACKUP_PASSPHRASE_FILE"
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$enc.tmp" -pass "file:$BACKUP_PASSPHRASE_FILE" | gzip -t
mv "$enc.tmp" "$enc"
sha="$(sha256sum "$enc" | cut -d' ' -f1)"; bytes="$(wc -c < "$enc" | tr -d ' ')"
echo "$sha  $(basename "$enc")" > "$enc.sha256"

# 5. upload and check what arrived
name="$(basename "$enc")"
case "$BACKUP_REMOTE" in
  rclone:*) rclone copyto "$enc" "${BACKUP_REMOTE#rclone:}/$name" && rclone copyto "$enc.sha256" "${BACKUP_REMOTE#rclone:}/$name.sha256"
            rclone check "$OUT_DIR" "${BACKUP_REMOTE#rclone:}" --one-way --include "$name" >/dev/null ;;
  [A-Za-z]:/*|/*|./*)  mkdir -p "$BACKUP_REMOTE"; cp "$enc" "$enc.sha256" "$BACKUP_REMOTE/"
            (cd "$BACKUP_REMOTE" && sha256sum -c "$name.sha256" >/dev/null)
            (cd "$BACKUP_REMOTE" && ls -1t 2jfitness-*.tar.gz.enc 2>/dev/null | tail -n +$((REMOTE_KEEP + 1)) | while read -r old; do rm -f -- "$old" "$old.sha256"; done) ;;
  *:*)      scp -q -o BatchMode=yes "$enc" "$enc.sha256" "$BACKUP_REMOTE/"
            ssh -o BatchMode=yes "${BACKUP_REMOTE%%:*}" "cd '${BACKUP_REMOTE#*:}' && sha256sum -c '$name.sha256' >/dev/null && ls -1t 2jfitness-*.tar.gz.enc | tail -n +$((REMOTE_KEEP + 1)) | xargs -r rm -f --" ;;
  *)        mkdir -p "$BACKUP_REMOTE"; cp "$enc" "$enc.sha256" "$BACKUP_REMOTE/"; (cd "$BACKUP_REMOTE" && sha256sum -c "$name.sha256" >/dev/null) ;;
esac

# 6. local pruning of encrypted copies (the plain tarballs are pruned by backup-data.sh), 7. status for monitoring
find "$OUT_DIR" -name '2jfitness-*.tar.gz.enc*' -mtime "+$KEEP_DAYS" -delete
printf '{"at":"%s","file":"%s","bytes":%s,"sha256":"%s","remote":"%s"}\n' "$(date -u +%FT%TZ)" "$name" "$bytes" "$sha" "${BACKUP_REMOTE%%:*}" > "$OUT_DIR/last-offsite.json"
echo "✓ off-site backup: $name ($bytes bytes, sha256 $sha)"
