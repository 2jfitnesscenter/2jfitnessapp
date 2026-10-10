#!/usr/bin/env bash
# Installs (idempotently) what keeps Security/Ops V1 running by itself on the VPS: the daily off-site backup, the periodic ops-check, and the
# log rotation. Safe to run any number of times; the release runner runs it after every good deploy, and by hand it is:
#     sudo /opt/2jfitness/scripts/install-ops-cron.sh            (--print shows what it would install and changes nothing)
# - root crontab: ONE managed block (# BEGIN 2j-ops ... # END 2j-ops). The older hand-made lines for backup-offsite.sh / ops-check.sh are removed
#   so nothing runs twice; every other crontab line is left alone.
# - /etc/logrotate.d/2j-ops: weekly, rotate 8, compress, missingok, notifempty, `su root root` (the logs live in /var/log, owned by root).
# - Jobs read their settings from /etc/2j-ops.env (paths and names only: BACKUP_PASSPHRASE_FILE, BACKUP_REMOTE, BACKUP_DIR, RCLONE_CONFIG,
#   OPS_ALERT_COMMAND...). It must already exist; this script never creates or prints it, and no secret goes into the crontab.
# Test/relocation hooks: OPS_APP_DIR (default: the checkout this script is in), OPS_ETC_DIR (default /etc), OPS_CRONTAB_CMD (default crontab).
# Exit: 0 ok · 2 not root · 3 /etc/2j-ops.env missing or incomplete.
set -euo pipefail
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
APP="${OPS_APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
ETC="${OPS_ETC_DIR:-/etc}"; CRONTAB="${OPS_CRONTAB_CMD:-crontab}"
ENVF="$ETC/2j-ops.env"
print_only=0; [ "${1:-}" = "--print" ] && print_only=1

block="# BEGIN 2j-ops (managed by scripts/install-ops-cron.sh; change it there, not here)
SHELL=/bin/bash
17 3 * * * cd $APP && set -a && . $ENVF && set +a && scripts/backup-offsite.sh >> /var/log/2j-backup.log 2>&1
*/30 * * * * cd $APP && set -a && . $ENVF && set +a && scripts/ops-check.sh >> /var/log/2j-ops-check.log 2>&1
# END 2j-ops"
logrotate="/var/log/2j-*.log {
  su root root
  weekly
  rotate 8
  compress
  missingok
  notifempty
}"

if [ "$print_only" = 1 ]; then printf '%s\n\n# %s/logrotate.d/2j-ops\n%s\n' "$block" "$ETC" "$logrotate"; exit 0; fi

[ "$(id -u)" -eq 0 ] || [ -n "${OPS_ETC_DIR:-}" ] || { echo "install-ops-cron: run as root" >&2; exit 2; }
[ -s "$ENVF" ] || { echo "install-ops-cron: $ENVF is missing; create it first (see docs/SECURITY_OPS_V1.md)" >&2; exit 3; }
for k in BACKUP_PASSPHRASE_FILE BACKUP_REMOTE; do
  grep -q "^$k=" "$ENVF" || { echo "install-ops-cron: $ENVF does not define $k" >&2; exit 3; }
done
mode="$(stat -c %a "$ENVF" 2>/dev/null || true)"
case "$mode" in ''|600|400) ;; *) echo "install-ops-cron: note: $ENVF is mode $mode (600 recommended)" >&2 ;; esac

current="$($CRONTAB -l 2>/dev/null || true)"
kept="$(printf '%s\n' "$current" \
  | awk '/^# BEGIN 2j-ops/ {skip=1} !skip {print} /^# END 2j-ops/ {skip=0}' \
  | grep -v -e 'scripts/backup-offsite\.sh' -e 'scripts/ops-check\.sh' || true)"
if [ -n "$kept" ]; then wanted="$kept"$'\n'"$block"; else wanted="$block"; fi

if [ "$wanted" = "$current" ]; then cron_state=unchanged
else printf '%s\n' "$wanted" | $CRONTAB - ; cron_state=updated; fi
[ "$($CRONTAB -l 2>/dev/null | grep -c 'scripts/backup-offsite\.sh')" -eq 1 ] || { echo "install-ops-cron: crontab check failed" >&2; exit 1; }

lr="$ETC/logrotate.d/2j-ops"
if [ -f "$lr" ] && [ "$(cat "$lr")" = "$logrotate" ]; then lr_state=unchanged
else mkdir -p "$ETC/logrotate.d"; printf '%s\n' "$logrotate" > "$lr"; chmod 644 "$lr"; lr_state=updated; fi

echo "install-ops-cron: crontab $cron_state, logrotate $lr_state (backup 03:17 daily, ops-check every 30 min)"
