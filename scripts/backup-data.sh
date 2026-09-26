#!/usr/bin/env bash
# Nightly backup of ./data (profiles, passkeys, per-user state, workout history) — meant to run
# from cron on a production server, but safe to run by hand any time too. Keeps the last
# $BACKUP_KEEP_DAYS backups and prunes older ones so disk usage stays bounded on a long-running
# instance; a backup that only lives on this same machine doesn't protect against the machine
# itself failing, so copy $BACKUP_DIR off the server every so often too.
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

OUT_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$OUT_DIR"

stamp="$(date +%F_%H%M%S)"
archive="$OUT_DIR/2jfitness-$stamp.tar.gz"
tmp="$archive.tmp"
listing="$archive.list.tmp"
trap 'rm -f "$tmp" "$listing"' EXIT
tar czf "$tmp" data
test -s "$tmp"
gzip -t "$tmp"
tar -tzf "$tmp" > "$listing"
grep -Fxq 'data/' "$listing"
if find data -maxdepth 1 -type f -name 'state-*.json' -print -quit | grep -q .; then
  grep -Eq '^data/state-.*\.json$' "$listing"
fi
mv "$tmp" "$archive"
find "$OUT_DIR" -name '2jfitness-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "✓ backup saved: $archive"
