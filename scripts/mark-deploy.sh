#!/usr/bin/env bash
# Leaves the deploy marker the admin ops view shows: which release is running and since when. Run it on the server after a release:
#   scripts/mark-deploy.sh <git-sha> ["short note"]
# Writes ./data/ops/deploy-marker.json (or $OPS_DIR). Touches nothing else; safe to run any time; refuses anything that is not a git sha.
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
sha="${1:?usage: mark-deploy.sh <git-sha> [note]}"; note="${2:-}"
case "$sha" in *[!0-9a-fA-F]*|'') echo "mark-deploy: not a git sha" >&2; exit 2 ;; esac
[ "${#sha}" -ge 7 ] && [ "${#sha}" -le 40 ] || { echo "mark-deploy: sha must be 7-40 hex characters" >&2; exit 2; }
note="$(printf '%s' "$note" | tr -cd 'A-Za-z0-9 ._:-' | cut -c1-80)"
OPS_DIR="${OPS_DIR:-$SCRIPT_DIR/../data/ops}"
mkdir -p "$OPS_DIR"
printf '{"sha":"%s","at":"%s","note":"%s"}\n' "$sha" "$(date -u +%FT%TZ)" "$note" > "$OPS_DIR/deploy-marker.json.tmp"
mv "$OPS_DIR/deploy-marker.json.tmp" "$OPS_DIR/deploy-marker.json"
echo "✓ deploy marker: $sha"
