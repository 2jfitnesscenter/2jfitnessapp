#!/usr/bin/env bash
# Restore rehearsal: proves, on demand, that an off-site backup can really bring the app back — WITHOUT touching production.
#   BACKUP_PASSPHRASE_FILE=/root/.2j-backup-pass scripts/restore-rehearsal.sh [--boot] 2jfitness-<stamp>.tar.gz.enc [<empty-work-dir>]
#   (fetch the .enc from the off-site destination first; the file is read, never modified)
# Steps, each timed: verify (checksum + decrypts + valid archive) -> restore into a throw-away directory -> validate db/secret/every state file
# (scripts/validate-restore.mjs) -> optionally boot a throw-away API on a random port against the copy and ask /api/health (--boot).
# Guarantees: the work directory must be empty or new, must not be ./data or inside it, and is deleted afterwards (KEEP_REHEARSAL=1 keeps it).
# Production's ./data, ./data/secret and the running API are never read for the check; SECRET_FILE is ignored so the SECRET MUST come from the archive.
# Result: one line per step with seconds, and $OPS_DIR/restore-status.json {"ok":...} (default ./data/ops), which the admin ops view shows.
# Node for the validation step: NODE_COMMAND (default "node"; split on spaces, so no paths with spaces). On a host WITHOUT node, borrow one from a
#   throw-away container of the API image (offline, read-only mounts, no production volume, nothing of production readable), with a fixed work dir:
#   NODE_COMMAND="docker run --rm --network none --entrypoint node -v /root/ops-v1:/root/ops-v1:ro -v /root/ops-v1/tmp/w:/root/ops-v1/tmp/w:ro <api-image>" \n#     scripts/restore-rehearsal.sh <file.enc> /root/ops-v1/tmp/w      (--boot needs a full checkout with node_modules: use a machine that has one)
# Exit: 0 restorable; otherwise the code of the failing step (restore-backup.sh 2/4/5/6/7, validate 8).
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$SCRIPT_DIR/.." && pwd)"
OPS_DIR="${OPS_DIR:-$REPO/data/ops}"
boot=""; [ "${1:-}" = "--boot" ] && { boot="--boot"; shift; }
enc="${1:?usage: restore-rehearsal.sh [--boot] <file.tar.gz.enc> [<empty-work-dir>]}"; work="${2:-}"
log() { printf '%s restore-rehearsal: %s\n' "$(date -u +%FT%TZ)" "$*"; }
STARTED="$(date +%s)"; REASON="unexpected_error"; STAGE="start"; created=""
write_status() { mkdir -p "$OPS_DIR" 2>/dev/null || return 0
  printf '{"at":"%s","ok":%s,"seconds":%s,"file":"%s"%s}\n' "$(date -u +%FT%TZ)" "$1" "$(( $(date +%s) - STARTED ))" "$(basename "$enc")" "${2:-}" > "$OPS_DIR/restore-status.json.tmp" && mv "$OPS_DIR/restore-status.json.tmp" "$OPS_DIR/restore-status.json"; }
cleanup() { local rc=$?
  [ -n "$created" ] && [ -z "${KEEP_REHEARSAL:-}" ] && rm -rf -- "$work"
  if [ "$rc" -ne 0 ]; then log "FAILED at '$STAGE' (exit $rc)" >&2; write_status false ",\"stage\":\"$STAGE\",\"exit\":$rc"; fi; }
trap cleanup EXIT

STAGE="config"
NODE_CMD=(); read -r -a NODE_CMD <<< "${NODE_COMMAND:-node}"
command -v "${NODE_CMD[0]:-node}" >/dev/null 2>&1 || { echo "restore-rehearsal: Node not found: ${NODE_CMD[0]:-?} (install it or set NODE_COMMAND, see the header of this script)" >&2; exit 2; }
[ -n "${BACKUP_PASSPHRASE_FILE:-}" ] || { echo "restore-rehearsal: BACKUP_PASSPHRASE_FILE is not set" >&2; exit 2; }
if [ -z "$work" ]; then work="$(mktemp -d "${TMPDIR:-/tmp}/2j-rehearsal.XXXXXX")"; created=1
else
  mkdir -p "$work"; work="$(cd "$work" && pwd)"
  case "$work/" in "$REPO/data/"*|"$REPO/data") echo "restore-rehearsal: the work directory must not be production's ./data" >&2; exit 2 ;; esac
  [ -z "$(ls -A "$work")" ] || { echo "restore-rehearsal: $work is not empty" >&2; exit 7; }
  created=1
fi

STAGE="verify"; t=$(date +%s)
"$SCRIPT_DIR/restore-backup.sh" --verify-only "$enc"; t_verify=$(( $(date +%s) - t ))
log "verify: ${t_verify}s"
STAGE="restore"; t=$(date +%s)
"$SCRIPT_DIR/restore-backup.sh" "$enc" "$work" >/dev/null; t_restore=$(( $(date +%s) - t ))
log "restore into throw-away dir: ${t_restore}s"
STAGE="validate"; t=$(date +%s)
report="$("${NODE_CMD[@]}" "$SCRIPT_DIR/validate-restore.mjs" "$work/data" $boot)" || { echo "$report" >&2; exit 8; }
t_validate=$(( $(date +%s) - t ))
log "validate: ${t_validate}s $report"
users="$(printf '%s' "$report" | sed -n 's/.*"users":\([0-9]*\).*/\1/p')"; states="$(printf '%s' "$report" | sed -n 's/.*"states":\([0-9]*\).*/\1/p')"
STAGE="finish"
write_status true ",\"users\":${users:-0},\"states\":${states:-0},\"boot\":$([ -n "$boot" ] && echo true || echo false),\"verifySeconds\":$t_verify,\"restoreSeconds\":$t_restore,\"validateSeconds\":$t_validate"
log "OK: restorable (production untouched)"
