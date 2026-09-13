#!/usr/bin/env bash
# Nightly backup of ./data (profiles, passkeys, per-user state, workout history) — meant to run
# from cron on a production server, but safe to run by hand any time too. Keeps the last
# $BACKUP_KEEP_DAYS backups and prunes older ones so disk usage stays bounded on a long-running
# instance; a backup that only lives on this same machine doesn't protect against the machine
# itself failing, so copy $BACKUP_DIR off the server every so often too.
set -euo pipefail
cd "$(dirname "$0")/.."

OUT_DIR="${BACKUP_DIR:-$HOME/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
mkdir -p "$OUT_DIR"

stamp="$(date +%F_%H%M)"
tar czf "$OUT_DIR/2jfitness-$stamp.tar.gz" data
find "$OUT_DIR" -name '2jfitness-*.tar.gz' -mtime "+$KEEP_DAYS" -delete

echo "✓ backup saved: $OUT_DIR/2jfitness-$stamp.tar.gz"
