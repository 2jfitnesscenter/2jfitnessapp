#!/usr/bin/env bash
# Restores (or just verifies) an encrypted off-site backup made by backup-offsite.sh. It NEVER touches the live ./data:
# it extracts into an empty directory you name, so a restore can be rehearsed on any machine and then swapped in by hand.
#   scripts/restore-backup.sh --verify-only 2jfitness-<stamp>.tar.gz.enc        # decrypt + integrity check, writes nothing
#   scripts/restore-backup.sh 2jfitness-<stamp>.tar.gz.enc /tmp/restore-test    # extracts <dir>/data/...
# Needs BACKUP_PASSPHRASE_FILE (the same passphrase file used to create it).
set -euo pipefail
verify_only=0; [ "${1:-}" = "--verify-only" ] && { verify_only=1; shift; }
enc="${1:?usage: restore-backup.sh [--verify-only] <file.tar.gz.enc> [<empty-dir>]}"; dest="${2:-}"
: "${BACKUP_PASSPHRASE_FILE:?set BACKUP_PASSPHRASE_FILE}"
test -s "$enc" || { echo "restore: file not found" >&2; exit 2; }
if [ -s "$enc.sha256" ]; then (cd "$(dirname "$enc")" && sha256sum -c "$(basename "$enc").sha256" >/dev/null) || { echo "restore: checksum mismatch - copy is corrupt" >&2; exit 4; }; fi
dec() { openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -in "$enc" -pass "file:$BACKUP_PASSPHRASE_FILE"; }
dec | gzip -t || { echo "restore: wrong passphrase or damaged file" >&2; exit 5; }
# Read the WHOLE listing first, then look for data/ in it: `tar -t | grep -q` makes grep quit on the first line, the writers get SIGPIPE and
# pipefail reports a good archive as broken. A real openssl/gzip/tar error still fails the capture below.
listing="$(dec | tar -tzf -)" || { echo "restore: archive could not be listed" >&2; exit 6; }
grep -Fxq 'data/' <<<"$listing" || { echo "restore: archive has no data/ directory" >&2; exit 6; }
if [ "$verify_only" = 1 ]; then echo "✓ backup decrypts and is a valid 2J data archive"; exit 0; fi
: "${dest:?give an empty directory to restore into}"
mkdir -p "$dest"
[ -z "$(ls -A "$dest")" ] || { echo "restore: $dest is not empty; refusing" >&2; exit 7; }
dec | tar -xzf - -C "$dest"
echo "✓ restored into $dest/data - review it, then stop the API and swap it in (keep the old ./data until the app has been checked)"
