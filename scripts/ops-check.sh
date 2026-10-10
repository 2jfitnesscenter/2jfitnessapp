#!/usr/bin/env bash
# Cron-friendly alarm from the same files the admin ops view reads (no network, no API, no SaaS). Exit 1 and say why when:
#   the last backup failed or is older than 36 h (or never ran), the last restore rehearsal failed, or the disk is nearly full.
#   scripts/ops-check.sh [min_free_percent]      e.g.  */30 * * * * cd /opt/2jfitness && scripts/ops-check.sh
#   scripts/ops-check.sh --alert-test            sends one "test" through the alert command and exits (proves the wiring)
# A restore rehearsal that is merely "due" (> 100 days) or never done is reported but is not an alarm here (see the admin view).
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

if [ "${1:-}" = "--alert-test" ]; then
  [ -n "${OPS_ALERT_COMMAND:-}" ] || { echo "ops-check: OPS_ALERT_COMMAND is not set" >&2; exit 2; }
  alert test "2J ops: alert test" "This is a test of the 2J ops alert command."
  echo "ops-check: test alert sent"; exit 0
fi

min_free="${1:-15}"
out="$(OPS_DIR="$OPS_DIR" MIN_FREE="$min_free" node --input-type=module -e '
import fs from "node:fs";
const rd = f => { try { return JSON.parse(fs.readFileSync(process.env.OPS_DIR + "/" + f, "utf8")); } catch { return null; } };
const problems = [], notes = [];
const b = rd("backup-status.json");
if (!b) problems.push("backup: never ran (no backup-status.json)");
else if (b.ok !== true) problems.push("backup: last run FAILED (" + (b.reason || "unknown") + " at " + (b.stage || "?") + ", " + b.at + ")");
else if (!(Date.now() - Date.parse(b.at) < 36 * 3600000)) problems.push("backup: last success is older than 36 h (" + b.at + ")");
const r = rd("restore-status.json");
if (!r) notes.push("restore rehearsal: never done");
else if (r.ok !== true) problems.push("restore rehearsal: last run FAILED (" + (r.stage || "?") + ", " + r.at + ")");
else if (!(Date.now() - Date.parse(r.at) < 100 * 86400000)) notes.push("restore rehearsal: due (" + r.at + ")");
try { const s = fs.statfsSync(process.env.OPS_DIR); const free = Number(s.bavail) / Number(s.blocks) * 100; if (free < Number(process.env.MIN_FREE)) problems.push("disk: " + free.toFixed(1) + "% free"); } catch {}
for (const n of notes) console.log("note: " + n);
for (const p of problems) console.log("ALARM: " + p);
process.exit(problems.length ? 1 : 0);
')"; rc=$?
[ -n "$out" ] && echo "$out"
[ "$rc" -eq 0 ] && echo "ops-check: ok"

# alert hook: tell someone when the alarm starts or changes (then at most every OPS_ALERT_REPEAT_MIN), and once when it clears
if [ -n "${OPS_ALERT_COMMAND:-}" ]; then
  alarms="$(printf '%s\n' "$out" | grep '^ALARM: ' || true)"
  sig="$(printf '%s' "$alarms" | cksum | cut -d' ' -f1)"
  now="$(date +%s)"; prev_sig=""; prev_at=0
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
