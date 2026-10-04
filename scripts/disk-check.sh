#!/usr/bin/env bash
# Cron-friendly disk guard: exit 1 (and say so) when a filesystem is nearly full - backups, state files and the journal all grow.
#   scripts/disk-check.sh [path] [min_free_percent]      default: /  and 15
set -euo pipefail
path="${1:-/}"; min="${2:-15}"
used="$(df -P "$path" | awk 'NR==2 {gsub("%","",$5); print $5}')"
free=$((100 - used))
if [ "$free" -lt "$min" ]; then echo "disk-check: $path has ${free}% free (< ${min}%)" >&2; exit 1; fi
echo "disk-check: $path ${free}% free"
