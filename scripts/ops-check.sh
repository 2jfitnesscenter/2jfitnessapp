#!/usr/bin/env bash
# Cron-friendly alarm from the same files the admin ops view reads (no network, no API, no SaaS, and NO Node: pure shell + coreutils, so it
# runs on a host that only has Docker). Exit 1 and say why when:
#   the last backup failed or is older than 36 h (or never ran), the last restore rehearsal failed, or the disk is nearly full.
# A restore rehearsal that is "due" (> 100 days) or never done is only a note (the admin view shows it), not an alarm.
#   scripts/ops-check.sh [min_free_percent]      e.g.  */30 * * * * cd /opt/2jfitness && scripts/ops-check.sh   (installed by scripts/install-ops-cron.sh)
#   scripts/ops-check.sh --alert-test            sends one "test" through the alert command and exits (proves the wiring)
# Reads $OPS_DIR/backup-status.json and restore-status.json (default <repo>/data/ops, which may be mode 700 root:root: run it as root, as cron does).
#
# Alert hook (optional, provider-agnostic, nothing hardcoded): set OPS_ALERT_COMMAND to any command you trust (a mail wrapper, a curl
# script, ...). It is run through `bash -c "$OPS_ALERT_COMMAND" ops-alert "<message>"`, so inside it the message is "$1"; it is ALSO on
# stdin, and in the environment as OPS_ALERT_STATUS (alarm|recovered|test), OPS_ALERT_SUBJECT and OPS_ALERT_MESSAGE. The message is never
# spliced into the command line. Keep credentials in the command's own config/env on the server, never in this repo.
#   OPS_ALERT_REPEAT_MIN   minutes before the SAME alarm is sent again (default 360); a different alarm or a recovery is sent at once
#   OPS_ALERT_TIMEOUT_SEC  the command is killed after this (default 30) when `timeout` exists
# Without OPS_ALERT_COMMAND nothing is sent and nothing changes. The exit code is the check's own (1 on any alarm), whether or not an alert
# was sent or the command failed (a failing command is reported on stderr).
set -uo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
OPS_DIR="${OPS_DIR:-$SCRIPT_DIR/../data/ops}"
STATE="$OPS_DIR/alert-state"

alert() { # status subject message
  [ -n "${OPS_ALERT_COMMAND:-}" ] || return 0
  local t=(); command -v timeout >/dev/null 2>&1 && t=(timeout "${OPS_ALERT_TIMEOUT_SEC:-30}")
  printf '%s\n' "$3" | OPS_ALERT_STATUS="$1" OPS_ALERT_SUBJECT="$2" OPS_ALERT_MESSAGE="$3" "${t[@]}" bash -c "$OPS_ALERT_COMMAND" ops-alert "$3" >/dev/null 2>&1
  local rc=$?
  [ "$rc" -eq 0 ] || echo "ops-check: alert command failed (exit $rc)" >&2
  return "$rc"
}

# No OPS_ALERT_COMMAND but the owner has put a destination in /etc/2j-alert.conf: use the reference command shipped with the repo.
if [ -z "${OPS_ALERT_COMMAND:-}" ] && [ -s "${OPS_ALERT_CONF:-/etc/2j-alert.conf}" ]; then OPS_ALERT_COMMAND="bash '$SCRIPT_DIR/ops-alert.sh' \"\$1\""; fi

if [ "${1:-}" = "--alert-test" ]; then
  [ -n "${OPS_ALERT_COMMAND:-}" ] || { echo "ops-check: OPS_ALERT_COMMAND is not set" >&2; exit 2; }
  alert test "2J ops: alert test" "This is a test of the 2J ops alert command." || { echo "ops-check: test alert FAILED (the alert command did not exit 0)" >&2; exit 1; }
  echo "ops-check: test alert sent"; exit 0
fi

min_free="${1:-15}"
MAX_BACKUP_AGE_S=$(( 36 * 3600 )); REHEARSAL_DUE=$(( 100 * 86400 ))
now="$(date +%s)"
problems=(); notes=()

# --- tiny JSON readers for the flat files our own scripts write (fixed words, numbers, ISO times; no nesting) ---
field() { # file key -> value ("" when absent)
  sed -n "s/.*\"$2\":[[:space:]]*\"\{0,1\}\([^\",}]*\)\"\{0,1\}.*/\1/p" "$1" 2>/dev/null | head -n 1
}
epoch() { # ISO-8601 UTC -> epoch seconds ("" when unparsable); GNU date first, BSD date as a fallback
  date -u -d "$1" +%s 2>/dev/null || date -u -j -f '%Y-%m-%dT%H:%M:%SZ' "$1" +%s 2>/dev/null || true
}
# status of one file: missing | unreadable | present
presence() { if [ -e "$1" ]; then if [ -r "$1" ]; then echo present; else echo unreadable; fi; else echo missing; fi; }

# --- backup ---
bf="$OPS_DIR/backup-status.json"
case "$(presence "$bf")" in
  missing) problems+=("backup: never ran (no backup-status.json)") ;;
  unreadable) problems+=("backup: status file is not readable by this user (run it as root / check permissions)") ;;
  present)
    b_at="$(field "$bf" at)"; b_ok="$(field "$bf" ok)"; b_ts="$(epoch "$b_at")"
    if [ "$b_ok" != "true" ]; then b_reason="$(field "$bf" reason)"; b_stage="$(field "$bf" stage)"; problems+=("backup: last run FAILED (${b_reason:-unknown} at ${b_stage:-?}, $b_at)")
    elif [ -z "$b_ts" ] || [ $(( now - b_ts )) -ge "$MAX_BACKUP_AGE_S" ]; then problems+=("backup: last success is older than 36 h ($b_at)")
    fi ;;
esac

# --- restore rehearsal ---
rf="$OPS_DIR/restore-status.json"
case "$(presence "$rf")" in
  missing) notes+=("restore rehearsal: never done") ;;
  unreadable) problems+=("restore rehearsal: status file is not readable by this user (run it as root / check permissions)") ;;
  present)
    r_at="$(field "$rf" at)"; r_ok="$(field "$rf" ok)"; r_ts="$(epoch "$r_at")"
    if [ "$r_ok" != "true" ]; then problems+=("restore rehearsal: last run FAILED ($(field "$rf" stage), $r_at)")
    elif [ -z "$r_ts" ] || [ $(( now - r_ts )) -ge "$REHEARSAL_DUE" ]; then notes+=("restore rehearsal: due ($r_at)")
    fi ;;
esac

# --- disk (same rule as disk-check.sh: percent still free on the filesystem holding the ops dir) ---
disk_path="$OPS_DIR"; [ -d "$disk_path" ] || disk_path="$(dirname "$OPS_DIR")"
used="$(df -P "$disk_path" 2>/dev/null | awk 'NR==2 {gsub("%","",$5); print $5}')"
if [ -n "$used" ] && [ "$used" -eq "$used" ] 2>/dev/null; then
  free=$(( 100 - used ))
  [ "$free" -lt "$min_free" ] && problems+=("disk: ${free}% free")
fi

out=""; rc=0
for n in "${notes[@]+"${notes[@]}"}"; do out+="note: $n"$'\n'; done
for p in "${problems[@]+"${problems[@]}"}"; do out+="ALARM: $p"$'\n'; rc=1; done
printf '%s' "$out"
[ "$rc" -eq 0 ] && echo "ops-check: ok"

# alert hook: tell someone when the alarm starts or changes (then at most every OPS_ALERT_REPEAT_MIN), and once when it clears
if [ -n "${OPS_ALERT_COMMAND:-}" ]; then
  alarms="$(printf '%s' "$out" | grep '^ALARM: ' || true)"
  sig="$(printf '%s' "$alarms" | cksum | cut -d' ' -f1)"
  prev_sig=""; prev_at=0
  [ -f "$STATE" ] && read -r prev_sig prev_at < "$STATE" 2>/dev/null
  if [ "$rc" -ne 0 ]; then
    if [ "$sig" != "$prev_sig" ] || [ $(( now - ${prev_at:-0} )) -ge $(( ${OPS_ALERT_REPEAT_MIN:-360} * 60 )) ]; then
      alert alarm "2J ops ALARM" "$alarms" && { mkdir -p "$OPS_DIR" 2>/dev/null; echo "$sig $now" > "$STATE" 2>/dev/null; }
    fi
  elif [ -n "$prev_sig" ] && [ "$prev_sig" != "ok" ]; then
    alert recovered "2J ops recovered" "All 2J ops checks are fine again." && { mkdir -p "$OPS_DIR" 2>/dev/null; echo "ok $now" > "$STATE" 2>/dev/null; }
  fi
fi
exit "$rc"
