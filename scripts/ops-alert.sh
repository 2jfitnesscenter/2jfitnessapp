#!/usr/bin/env bash
# Reference alert command for scripts/ops-check.sh. Provider-agnostic: it always logs locally, and sends to whatever the OWNER put in
# /etc/2j-alert.conf (root, mode 600, never in the repo):
#     ALERT_WEBHOOK_URL=https://...        # gets a form POST: status, subject, message
#     ALERT_MAIL_TO=you@example.com        # used when a `mail` command exists
# ops-check.sh uses this script on its own when /etc/2j-alert.conf exists and OPS_ALERT_COMMAND is not set; set OPS_ALERT_COMMAND to use
# something else. Receives the message as $1 (also OPS_ALERT_MESSAGE) and OPS_ALERT_STATUS / OPS_ALERT_SUBJECT from ops-check.sh.
# Exit 0 when everything configured was delivered (or nothing is configured: it only logs), 1 when a delivery failed (so ops-check retries).
# Test/relocation hooks: OPS_ALERT_CONF (default /etc/2j-alert.conf), OPS_ALERT_LOG (default /var/log/2j-alerts.log).
set -uo pipefail
CONF="${OPS_ALERT_CONF:-/etc/2j-alert.conf}"
[ -r "$CONF" ] && . "$CONF"
LOG="${OPS_ALERT_LOG:-/var/log/2j-alerts.log}"
status="${OPS_ALERT_STATUS:-?}"; subject="${OPS_ALERT_SUBJECT:-2J ops}"; msg="${1:-${OPS_ALERT_MESSAGE:-}}"
printf '%s [%s] %s: %s\n' "$(date -u +%FT%TZ)" "$status" "$subject" "$msg" >> "$LOG" 2>/dev/null || true
if command -v logger >/dev/null 2>&1; then logger -t 2j-ops -- "$status: $msg" 2>/dev/null || true; fi
rc=0
if [ -n "${ALERT_WEBHOOK_URL:-}" ]; then
  curl -fsS --max-time 15 -o /dev/null --data-urlencode "status=$status" --data-urlencode "subject=$subject" --data-urlencode "message=$msg" "$ALERT_WEBHOOK_URL" || rc=1
fi
if [ -n "${ALERT_MAIL_TO:-}" ] && command -v mail >/dev/null 2>&1; then
  printf '%s\n' "$msg" | mail -s "$subject" "$ALERT_MAIL_TO" || rc=1
fi
exit "$rc"
