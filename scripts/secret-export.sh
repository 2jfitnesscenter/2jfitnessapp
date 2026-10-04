#!/usr/bin/env bash
# Prints the instance secret ONCE to the terminal so you can store it offline (password manager / paper). It is not written anywhere.
# Without this value, encrypted state files cannot be recovered after losing the server. Never paste it into git, tickets or chat.
set -euo pipefail
cd "$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)/.."
f="${SECRET_FILE:-}"; [ -n "$f" ] && [ -s "$f" ] || f="${SECRETS_DIR:-secrets}/secret"; [ -s "$f" ] || f="${DATA_DIR:-data}/secret"
test -s "$f" || { echo "secret-export: no secret file found" >&2; exit 2; }
echo "Instance secret (from $f) - store it offline, then clear your terminal:" >&2
cat "$f"; echo
