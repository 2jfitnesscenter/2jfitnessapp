#!/usr/bin/env bash
# Moves the instance secret (session signing + at-rest encryption key) out of ./data so data backups no longer contain the key to
# their own ciphertext. NON-DESTRUCTIVE by default: it only COPIES ./data/secret to ./secrets/secret and checks the copy.
#   scripts/separate-secret.sh                      copy + verify, print the remaining manual steps
#   I_SAVED_AN_OFFLINE_COPY=yes scripts/separate-secret.sh --remove-legacy
#                                                   after SECRET_FILE is live and verified: delete ./data/secret (refuses otherwise)
# Full procedure and recovery: docs/KEY_SEPARATION.md
set -euo pipefail
cd "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/.."
DATA="${DATA_DIR:-data}"; SECRETS="${SECRETS_DIR:-secrets}"
test -s "$DATA/secret" || { echo "separate-secret: $DATA/secret not found" >&2; exit 2; }
mkdir -p "$SECRETS"; chmod 700 "$SECRETS" 2>/dev/null || true
if [ ! -s "$SECRETS/secret" ]; then cp "$DATA/secret" "$SECRETS/secret"; chmod 600 "$SECRETS/secret"; fi
cmp -s "$DATA/secret" "$SECRETS/secret" || { echo "separate-secret: $SECRETS/secret differs from $DATA/secret - refusing" >&2; exit 3; }
# same owner as ./data so the API user can read it (and nobody else)
if owner="$(stat -c %u:%g "$DATA" 2>/dev/null)"; then chown -R "$owner" "$SECRETS" 2>/dev/null || true; fi
if [ "${1:-}" = "--remove-legacy" ]; then
  [ "${I_SAVED_AN_OFFLINE_COPY:-}" = "yes" ] || { echo "separate-secret: refusing. Save an offline copy first (scripts/secret-export.sh), then set I_SAVED_AN_OFFLINE_COPY=yes" >&2; exit 4; }
  rm -f -- "$DATA/secret"; echo "✓ removed $DATA/secret; the key now lives only in $SECRETS/secret (+ your offline copy)"; exit 0
fi
cat <<MSG
✓ copied to $SECRETS/secret (identical to $DATA/secret). Next:
  1. add  SECRET_FILE=/secrets/secret  to .env and run:  docker compose up -d   (restart alone does not re-read .env)
  2. check /api/health and one login; every existing session and state file must still work (same key)
  3. save an offline copy:  scripts/secret-export.sh   (prints once; put it in your password manager)
  4. only then:  I_SAVED_AN_OFFLINE_COPY=yes scripts/separate-secret.sh --remove-legacy
MSG
