$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Commit = '23226f635c1508600a17afafafb5f8bb31a79180'
$ShortCommit = '23226f6'
$ExpectedCurrentCommit = '6c5c46df09dcee57bea0a531c328d3a066b8d076'
$ExpectedCurrentShort = '6c5c46d'
$SyncBase = '51a221d8ef524776334d8d67109fb9102407eff2'
$Server = 'root@213.136.77.197'
$Release = Join-Path $env:TEMP "2jfitness-code-$ShortCommit.tar.gz"
$RollbackRelease = Join-Path $env:TEMP "2jfitness-code-$ExpectedCurrentShort.tar.gz"
$RemoteRelease = "/root/backups/2jfitness-code-$ShortCommit.tar.gz"
$RemoteRollback = "/root/backups/2jfitness-code-$ExpectedCurrentShort.tar.gz"
$RemoteRunner = "/root/backups/deploy-$ShortCommit.sh"
$LocalRunner = Join-Path $env:TEMP "deploy-$ShortCommit.sh"

Write-Host "Preparando el release exacto $Commit..."
$Head = (git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $Head -ne $Commit) {
  throw "HEAD no coincide con $Commit (actual: $Head)"
}
git diff --quiet --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Hay cambios tracked sin commit en el working tree' }
git diff --cached --quiet --exit-code
if ($LASTEXITCODE -ne 0) { throw 'Hay cambios staged sin commit en el working tree' }

if (Test-Path -LiteralPath $Release) { Remove-Item -LiteralPath $Release -Force }
git archive --format=tar.gz --output=$Release $Commit
if ($LASTEXITCODE -ne 0) { throw 'git archive failed' }
if (Test-Path -LiteralPath $RollbackRelease) { Remove-Item -LiteralPath $RollbackRelease -Force }
git archive --format=tar.gz --output=$RollbackRelease $ExpectedCurrentCommit
if ($LASTEXITCODE -ne 0) { throw 'git archive for rollback failed' }

$Marker = tar -xOf $Release SYNC_V2_ROLLBACK_BASE
if ($LASTEXITCODE -ne 0 -or ($Marker -join "`n") -notmatch [regex]::Escape($SyncBase)) {
  throw 'El release no contiene el checkpoint Sync V2 compatible'
}
$LocalHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $Release).Hash.ToLowerInvariant()
$RollbackMarker = tar -xOf $RollbackRelease SYNC_V2_ROLLBACK_BASE
if ($LASTEXITCODE -ne 0 -or ($RollbackMarker -join "`n") -notmatch [regex]::Escape($SyncBase)) {
  throw 'El rollback no contiene el checkpoint Sync V2 compatible'
}
$RollbackHash = (Get-FileHash -Algorithm SHA256 -LiteralPath $RollbackRelease).Hash.ToLowerInvariant()
Write-Host "LOCAL_RELEASE=$Release"
Write-Host "LOCAL_SHA256=$LocalHash"
Write-Host "LOCAL_ROLLBACK=$RollbackRelease"
Write-Host "LOCAL_ROLLBACK_SHA256=$RollbackHash"

$RemoteScript = @'
#!/usr/bin/env bash
set -Eeuo pipefail

APP=/opt/2jfitness
RELEASE=/root/backups/2jfitness-code-23226f6.tar.gz
ROLLBACK=/root/backups/2jfitness-code-6c5c46d.tar.gz
EXPECTED_HASH=__EXPECTED_HASH__
EXPECTED_ROLLBACK_HASH=__EXPECTED_ROLLBACK_HASH__
TARGET_COMMIT=23226f635c1508600a17afafafb5f8bb31a79180
ROLLBACK_COMMIT=6c5c46df09dcee57bea0a531c328d3a066b8d076
SYNC_BASE=51a221d8ef524776334d8d67109fb9102407eff2
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
STEP=bootstrap
DEPLOY_STARTED=0
STAMP=$(date +%F_%H%M%S)
LOG=/root/backups/deploy-23226f6-$STAMP.log
READINESS_TIMEOUT_SEC=120
SMOKE_TIMEOUT_SEC=45
RETRY_INTERVAL_SEC=2
exec > >(tee -a "$LOG") 2>&1

header_value() {
  local file=$1 name=$2
  awk -v wanted="$name" '{key=$0; sub(/:.*/, "", key); if (tolower(key) == tolower(wanted)) {sub(/^[^:]*:[[:space:]]*/, ""); sub(/\r$/, ""); print; exit}}' "$file"
}

http_probe() {
  local url=$1 body=$2 headers=$3 encoding=${4:-} method=${5:-GET} data=${6:-} max_time=${7:-10}
  local connect_time=4
  if (( max_time < connect_time )); then
    connect_time=$max_time
  fi
  local -a args=(--silent --show-error --connect-timeout "$connect_time" --max-time "$max_time" -D "$headers" -o "$body" --write-out '%{http_code}')
  : > "$headers"
  : > "$body"
  if [[ "$method" != GET ]]; then
    args+=(--request "$method")
  fi
  if [[ -n "$data" ]]; then
    args+=(-H 'Content-Type: application/json' --data "$data")
  fi
  if [[ -n "$encoding" ]]; then
    args+=(--compressed -H "Accept-Encoding: $encoding")
  fi
  curl "${args[@]}" "$url"
}

http_probe_for_retry() {
  # This function always runs inside wait_status' command-substitution
  # subshell. Keep the global ERR/rollback trap active everywhere else, but
  # do not let a transient curl transport error escape the retry boundary.
  trap - ERR
  set +e
  http_probe "$@"
}

wait_status() {
  local expected=$1 url=$2 body=$3 headers=$4 timeout=${5:-45} encoding=${6:-} method=${7:-GET} data=${8:-}
  local status=000 transport=0 deadline=$((SECONDS + timeout)) remaining attempt_time sleep_time attempt=0
  while (( SECONDS < deadline )); do
    attempt=$((attempt + 1))
    remaining=$((deadline - SECONDS))
    attempt_time=$((remaining < 10 ? remaining : 10))
    if (( attempt_time < 1 )); then
      attempt_time=1
    fi
    if status=$(http_probe_for_retry "$url" "$body" "$headers" "$encoding" "$method" "$data" "$attempt_time"); then
      transport=0
    else
      transport=$?
      status=000
    fi
    if [[ "$transport" == 0 && "$status" == "$expected" ]]; then
      printf 'HTTP_OK attempt=%s url=%s status=%s\n' "$attempt" "$url" "$status" >&2
      printf '%s' "$status"
      return 0
    fi
    printf 'HTTP_RETRY attempt=%s url=%s expected=%s status=%s transport=%s remaining=%ss\n' "$attempt" "$url" "$expected" "$status" "$transport" "$((deadline - SECONDS))" >&2
    if (( SECONDS >= deadline )); then
      break
    fi
    remaining=$((deadline - SECONDS))
    sleep_time=$((remaining < RETRY_INTERVAL_SEC ? remaining : RETRY_INTERVAL_SEC))
    if (( sleep_time > 0 )); then
      sleep "$sleep_time"
    fi
  done
  printf 'HTTP_RETRY_EXHAUSTED url=%s expected=%s status=%s transport=%s timeout=%ss\n' "$url" "$expected" "$status" "$transport" "$timeout" >&2
  printf '%s' "$status"
  return 1
}

wait_services() {
  local timeout=${1:-45}
  local deadline=$((SECONDS + timeout)) running missing service remaining sleep_time
  while (( SECONDS < deadline )); do
    running=$("${COMPOSE[@]}" ps --status running --services 2>/dev/null || true)
    missing=''
    for service in api web caddy; do
      awk -v wanted="$service" '$0 == wanted {found=1} END {exit !found}' <<< "$running" || missing="$missing $service"
    done
    if [[ -z "$missing" ]]; then printf '%s' "$running"; return 0; fi
    printf 'SERVICE_RETRY missing=%s remaining=%ss\n' "$missing" "$((deadline - SECONDS))" >&2
    remaining=$((deadline - SECONDS))
    sleep_time=$((remaining < RETRY_INTERVAL_SEC ? remaining : RETRY_INTERVAL_SEC))
    if (( sleep_time > 0 )); then
      sleep "$sleep_time"
    fi
  done
  printf 'SERVICE_RETRY_EXHAUSTED timeout=%ss\n' "$timeout" >&2
  return 1
}

chown_archive_files() {
  local archive=$1
  while IFS= read -r rel; do
    [[ -z "$rel" || "$rel" == data || "$rel" == data/* ]] && continue
    [[ -e "$APP/$rel" || -L "$APP/$rel" ]] && chown -h 2jfitness:2jfitness "$APP/$rel"
  done < <(tar -tzf "$archive")
}

remove_obsolete_release_files() {
  local old_archive=$1 new_archive=$2 old_list new_list
  old_list=$(mktemp /tmp/2j-old-release.XXXXXX)
  new_list=$(mktemp /tmp/2j-new-release.XXXXXX)
  tar -tzf "$old_archive" | sort > "$old_list"
  tar -tzf "$new_archive" | sort > "$new_list"
  while IFS= read -r rel; do
    [[ -z "$rel" || "$rel" == */ || "$rel" == data || "$rel" == data/* ]] && continue
    rm -f -- "$APP/$rel"
  done < <(comm -23 "$old_list" "$new_list")
  rm -f -- "$old_list" "$new_list"
}

rollback() {
  local original_status=$1 original_command=$2 original_step=$3
  trap - ERR
  set +e
  printf 'ORIGINAL_FAIL_STEP=%s\n' "$original_step"
  printf 'ORIGINAL_STATUS=%s\n' "$original_status"
  printf 'ORIGINAL_COMMAND=%s\n' "$original_command"
  if [[ "$DEPLOY_STARTED" != 1 ]]; then
    printf 'ROLLBACK=NOT_NEEDED_PRODUCTION_UNTOUCHED\n'
    exit "$original_status"
  fi

  cd "$APP" || true
  "${COMPOSE[@]}" logs --tail=80 --no-color api web caddy || true
  remove_obsolete_release_files "$RELEASE" "$ROLLBACK"
  tar -xzf "$ROLLBACK" -C "$APP"
  local extract_status=$?
  if [[ $extract_status -eq 0 ]]; then chown_archive_files "$ROLLBACK"; fi
  printf '%s\n' "$ROLLBACK_COMMIT" > "$APP/.deployed-commit"
  "${COMPOSE[@]}" up -d --build
  local compose_status=$?
  local rollback_health=000
  if [[ $extract_status -eq 0 && $compose_status -eq 0 ]]; then
    rollback_health=$(wait_status 200 http://localhost:8080/api/health /tmp/2j-rollback-body /tmp/2j-rollback-headers "$READINESS_TIMEOUT_SEC" || true)
  fi
  if [[ $extract_status -eq 0 && $compose_status -eq 0 && "$rollback_health" == 200 ]]; then
    printf 'ROLLBACK=OK:%s\n' "$ROLLBACK_COMMIT"
  else
    printf 'ROLLBACK=FAILED:extract=%s,compose=%s\n' "$extract_status" "$compose_status"
  fi
  printf 'ROLLBACK_HEALTH=%s\n' "$rollback_health"
  printf 'LOG=%s\n' "$LOG"
  exit "$original_status"
}

on_error() {
  local status=$?
  local command=${BASH_COMMAND:-unknown}
  local step=$STEP
  # ERR is inherited by command substitutions. They must propagate failure;
  # only the top-level shell may mutate production by executing rollback.
  if (( BASH_SUBSHELL > 0 )); then
    printf 'SUBSHELL_FAIL_STEP=%s STATUS=%s COMMAND=%s\n' "$step" "$status" "$command" >&2
    exit "$status"
  fi
  rollback "$status" "$command" "$step"
}
trap on_error ERR

STEP=verify-transfer
test -s "$RELEASE"
REMOTE_HASH=$(sha256sum "$RELEASE" | awk '{print $1}')
[[ "$REMOTE_HASH" == "$EXPECTED_HASH" ]]
gzip -t "$RELEASE"
RELEASE_MARKER=$(tar -xOf "$RELEASE" SYNC_V2_ROLLBACK_BASE)
[[ "$RELEASE_MARKER" == *"$SYNC_BASE"* ]]
printf 'REMOTE_SHA256=%s\n' "$REMOTE_HASH"

STEP=verify-rollback
test -s "$ROLLBACK"
ROLLBACK_REMOTE_HASH=$(sha256sum "$ROLLBACK" | awk '{print $1}')
[[ "$ROLLBACK_REMOTE_HASH" == "$EXPECTED_ROLLBACK_HASH" ]]
gzip -t "$ROLLBACK"
ROLLBACK_MARKER=$(tar -xOf "$ROLLBACK" SYNC_V2_ROLLBACK_BASE)
[[ "$ROLLBACK_MARKER" == *"$SYNC_BASE"* ]]
printf 'ROLLBACK_OK=%s sha256=%s\n' "$ROLLBACK" "$ROLLBACK_REMOTE_HASH"

STEP=verify-current-production
test -d "$APP/data"
test -s "$APP/data/db.json"
test -s "$APP/data/secret"
test -s "$APP/.deployed-commit"
[[ "$(cat "$APP/.deployed-commit")" == "$ROLLBACK_COMMIT" ]]
CURRENT_CHECK_DIR=$(mktemp -d /tmp/2j-current-6c5c46d.XXXXXX)
tar -xzf "$ROLLBACK" -C "$CURRENT_CHECK_DIR"
tar -tzf "$ROLLBACK" | sort > "$CURRENT_CHECK_DIR/rollback-files.txt"
tar -tzf "$RELEASE" | sort > "$CURRENT_CHECK_DIR/target-files.txt"
while IFS= read -r rel; do
  [[ -z "$rel" || -d "$CURRENT_CHECK_DIR/$rel" ]] && continue
  if [[ -L "$CURRENT_CHECK_DIR/$rel" ]]; then
    [[ -L "$APP/$rel" && "$(readlink "$APP/$rel")" == "$(readlink "$CURRENT_CHECK_DIR/$rel")" ]] || {
      printf 'CURRENT_MISMATCH=%s\n' "$rel"
      false
    }
  else
    test -f "$APP/$rel"
    cmp -s "$CURRENT_CHECK_DIR/$rel" "$APP/$rel" || {
      printf 'CURRENT_MISMATCH=%s\n' "$rel"
      false
    }
  fi
done < "$CURRENT_CHECK_DIR/rollback-files.txt"
while IFS= read -r rel; do
  [[ -z "$rel" || "$rel" == data || "$rel" == data/* ]] && continue
  if [[ -e "$APP/$rel" || -L "$APP/$rel" ]]; then
    printf 'UNEXPECTED_TARGET_FILE_ALREADY_PRESENT=%s\n' "$rel"
    false
  fi
done < <(comm -23 "$CURRENT_CHECK_DIR/target-files.txt" "$CURRENT_CHECK_DIR/rollback-files.txt")
rm -rf -- "$CURRENT_CHECK_DIR"
printf 'PREDEPLOY_PRODUCTION=%s source-tree=exact-release-match\n' "$ROLLBACK_COMMIT"

STEP=backup-data
BACKUP=/root/backups/2jfitness-predeploy-23226f6-$STAMP.tar.gz
tar -czf "$BACKUP" -C "$APP" data
test -s "$BACKUP"
gzip -t "$BACKUP"
tar -tzf "$BACKUP" data/db.json data/secret >/dev/null
STATE_COUNT=$(tar -tzf "$BACKUP" | awk '/^data\/state-.*\.json$/ {count++} END {print count+0}')
[[ "$STATE_COUNT" -gt 0 ]]
SECRET_HASH_BEFORE=$(sha256sum "$APP/data/secret" | awk '{print $1}')
DATA_OWNER_BEFORE=$(stat -c '%U:%G' "$APP/data")
printf 'BACKUP_OK=%s\n' "$BACKUP"
printf 'BACKUP_STATE_FILES=%s\n' "$STATE_COUNT"

STEP=install-release
DEPLOY_STARTED=1
remove_obsolete_release_files "$ROLLBACK" "$RELEASE"
tar -xzf "$RELEASE" -C "$APP"
chown_archive_files "$RELEASE"
printf '%s\n' "$TARGET_COMMIT" > "$APP/.deployed-commit"
cd "$APP"
grep -Fq "$SYNC_BASE" SYNC_V2_ROLLBACK_BASE

STEP=docker-build-up
"${COMPOSE[@]}" up -d --build

STEP=health-internal
INTERNAL_STATUS=$(wait_status 200 http://localhost:8080/api/health /tmp/2j-internal-body /tmp/2j-internal-headers "$READINESS_TIMEOUT_SEC")
awk 'index($0,"\"ok\":true") {found=1} END {exit !found}' /tmp/2j-internal-body

STEP=health-external
EXTERNAL_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/api/health /tmp/2j-external-body /tmp/2j-external-headers "$READINESS_TIMEOUT_SEC")
awk 'index($0,"\"ok\":true") {found=1} END {exit !found}' /tmp/2j-external-body

STEP=data-sync-smoke
DATA_STATUS=$(wait_status 401 https://app.2jfitnesscenter.com/api/data /tmp/2j-data-body /tmp/2j-data-headers "$SMOKE_TIMEOUT_SEC")
SYNC_STATUS=$(wait_status 401 https://app.2jfitnesscenter.com/api/sync /tmp/2j-sync-body /tmp/2j-sync-headers "$SMOKE_TIMEOUT_SEC")
test -s "$APP/data/db.json"
test -s "$APP/data/secret"
[[ "$(sha256sum "$APP/data/secret" | awk '{print $1}')" == "$SECRET_HASH_BEFORE" ]]
[[ "$(stat -c '%U:%G' "$APP/data")" == "$DATA_OWNER_BEFORE" ]]

STEP=bunker-smoke
BUNKER_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/api/bunker/board /tmp/2j-bunker-body /tmp/2j-bunker-headers "$SMOKE_TIMEOUT_SEC")
awk 'index($0,"\"sessions\"") && index($0,"\"todayPrs\"") {found=1} END {exit !found}' /tmp/2j-bunker-body
BUNKER_SETTINGS_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/api/bunker/settings /tmp/2j-bunker-settings-body /tmp/2j-bunker-settings-headers "$SMOKE_TIMEOUT_SEC")

STEP=social-smoke
SOCIAL_STATUS=$(wait_status 401 https://app.2jfitnesscenter.com/api/social/wall /tmp/2j-social-body /tmp/2j-social-headers "$SMOKE_TIMEOUT_SEC")

STEP=affected-api-smoke
AUX_STATUS=$(wait_status 401 https://app.2jfitnesscenter.com/api/admin/aux-ai /tmp/2j-aux-body /tmp/2j-aux-headers "$SMOKE_TIMEOUT_SEC")
IMPORT_MATCH_STATUS=$(wait_status 401 https://app.2jfitnesscenter.com/api/exercises/import-match \
  /tmp/2j-import-match-body /tmp/2j-import-match-headers "$SMOKE_TIMEOUT_SEC" '' POST '{"items":[]}')

STEP=pwa-assets-smoke
INDEX_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/ /tmp/2j-index-body /tmp/2j-index-headers "$SMOKE_TIMEOUT_SEC")
MANIFEST_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/manifest.json /tmp/2j-manifest-body /tmp/2j-manifest-headers "$SMOKE_TIMEOUT_SEC")
SW_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/sw.js /tmp/2j-sw-body /tmp/2j-sw-headers "$SMOKE_TIMEOUT_SEC")
ICON192_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/icon-192.png /tmp/2j-icon192-body /tmp/2j-icon192-headers "$SMOKE_TIMEOUT_SEC")
ICON512_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/icon-512.png /tmp/2j-icon512-body /tmp/2j-icon512-headers "$SMOKE_TIMEOUT_SEC")

STEP=main-asset-smoke
ASSET_READY=0
ASSET=''
STYLE=''
ASSET_STATUS=000
STYLE_STATUS=000
ASSET_DEADLINE=$((SECONDS + SMOKE_TIMEOUT_SEC))
while (( SECONDS < ASSET_DEADLINE )); do
  remaining=$((ASSET_DEADLINE - SECONDS))
  attempt_timeout=$((remaining < 10 ? remaining : 10))
  INDEX_STATUS=$(wait_status 200 https://app.2jfitnesscenter.com/ /tmp/2j-index-body /tmp/2j-index-headers "$attempt_timeout" || true)
  ASSET=$(tr '"' '\n' < /tmp/2j-index-body | awk '/^\/assets\/index-[A-Za-z0-9_-]+\.js$/ {print; exit}')
  STYLE=$(tr '"' '\n' < /tmp/2j-index-body | awk '/^\/assets\/index-[A-Za-z0-9_-]+\.css$/ {print; exit}')
  if [[ -n "$ASSET" && -n "$STYLE" ]]; then
    remaining=$((ASSET_DEADLINE - SECONDS))
    attempt_timeout=$((remaining < 10 ? remaining : 10))
    (( attempt_timeout < 1 )) && attempt_timeout=1
    ASSET_STATUS=$(wait_status 200 "https://app.2jfitnesscenter.com$ASSET" /tmp/2j-asset-body /tmp/2j-asset-headers "$attempt_timeout" gzip || true)
    remaining=$((ASSET_DEADLINE - SECONDS))
    (( remaining > 0 )) || break
    attempt_timeout=$((remaining < 10 ? remaining : 10))
    STYLE_STATUS=$(wait_status 200 "https://app.2jfitnesscenter.com$STYLE" /tmp/2j-style-body /tmp/2j-style-headers "$attempt_timeout" gzip || true)
    if [[ "$ASSET_STATUS" == 200 && "$STYLE_STATUS" == 200 ]] \
      && awk 'index($0,"Today at 2J") {found=1} END {exit !found}' /tmp/2j-asset-body \
      && awk 'index($0,"Same muscle / related") {found=1} END {exit !found}' /tmp/2j-asset-body \
      && awk 'index($0,"Different movement") {found=1} END {exit !found}' /tmp/2j-asset-body \
      && awk 'index($0,"bk-extab-name") {found=1} END {exit !found}' /tmp/2j-asset-body \
      && awk 'index($0,".bk-multi-grid.users-3") {grid=1} index($0,".bk-extab-name") {name=1} END {exit !(grid && name)}' /tmp/2j-style-body; then
      ASSET_READY=1
      break
    fi
  fi
  printf 'ASSET_RETRY js=%s js_status=%s css=%s css_status=%s remaining=%ss\n' "$ASSET" "$ASSET_STATUS" "$STYLE" "$STYLE_STATUS" "$((ASSET_DEADLINE - SECONDS))" >&2
  (( SECONDS >= ASSET_DEADLINE )) && break
  sleep "$RETRY_INTERVAL_SEC"
done
[[ "$ASSET_READY" == 1 ]]

STEP=headers-gzip-cache
INDEX_CACHE=$(header_value /tmp/2j-index-headers Cache-Control)
INDEX_NOSNIFF=$(header_value /tmp/2j-index-headers X-Content-Type-Options)
INDEX_FRAME=$(header_value /tmp/2j-index-headers X-Frame-Options)
INDEX_REFERRER=$(header_value /tmp/2j-index-headers Referrer-Policy)
INDEX_HSTS=$(header_value /tmp/2j-index-headers Strict-Transport-Security)
ASSET_CACHE=$(header_value /tmp/2j-asset-headers Cache-Control)
ASSET_ENCODING=$(header_value /tmp/2j-asset-headers Content-Encoding)
STYLE_CACHE=$(header_value /tmp/2j-style-headers Cache-Control)
STYLE_ENCODING=$(header_value /tmp/2j-style-headers Content-Encoding)
[[ "$INDEX_CACHE" == *no-cache* ]]
[[ "$INDEX_NOSNIFF" == nosniff ]]
[[ "$INDEX_FRAME" == SAMEORIGIN ]]
[[ "$INDEX_REFERRER" == strict-origin-when-cross-origin ]]
[[ "$INDEX_HSTS" == *max-age=31536000* ]]
[[ "$ASSET_CACHE" == *max-age=31536000* && "$ASSET_CACHE" == *immutable* ]]
[[ "$ASSET_ENCODING" == gzip ]]
[[ "$STYLE_CACHE" == *max-age=31536000* && "$STYLE_CACHE" == *immutable* ]]
[[ "$STYLE_ENCODING" == gzip ]]
printf 'GZIP=OK js=%s css=%s\n' "$ASSET_ENCODING" "$STYLE_ENCODING"
printf 'CACHE=OK index=%s js=%s css=%s\n' "$INDEX_CACHE" "$ASSET_CACHE" "$STYLE_CACHE"
printf 'HEADERS=OK nosniff=%s frame=%s referrer=%s hsts=%s\n' "$INDEX_NOSNIFF" "$INDEX_FRAME" "$INDEX_REFERRER" "$INDEX_HSTS"

STEP=services
RUNNING=$(wait_services "$READINESS_TIMEOUT_SEC")
"${COMPOSE[@]}" ps

STEP=finalize
[[ "$(cat "$APP/.deployed-commit")" == "$TARGET_COMMIT" ]]
printf 'DEPLOY_OK=%s\n' "$TARGET_COMMIT"
printf 'HEALTH=OK internal=%s external=%s\n' "$INTERNAL_STATUS" "$EXTERNAL_STATUS"
printf 'DATA=OK status=%s\n' "$DATA_STATUS"
printf 'SYNC=OK status=%s\n' "$SYNC_STATUS"
printf 'BUNKER=OK board=%s settings=%s\n' "$BUNKER_STATUS" "$BUNKER_SETTINGS_STATUS"
printf 'SOCIAL=OK status=%s\n' "$SOCIAL_STATUS"
printf 'AUX_IMPORT=OK aux=%s import=%s\n' "$AUX_STATUS" "$IMPORT_MATCH_STATUS"
printf 'PWA=OK manifest=%s sw=%s icons=%s/%s\n' "$MANIFEST_STATUS" "$SW_STATUS" "$ICON192_STATUS" "$ICON512_STATUS"
printf 'ASSET=%s status=%s style=%s style_status=%s\n' "$ASSET" "$ASSET_STATUS" "$STYLE" "$STYLE_STATUS"
printf 'SERVICES=OK api,web,caddy\n'
printf 'LOG=%s\n' "$LOG"
'@

$RemoteScript = $RemoteScript.Replace('__EXPECTED_HASH__', $LocalHash)
$RemoteScript = $RemoteScript.Replace('__EXPECTED_ROLLBACK_HASH__', $RollbackHash)
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($LocalRunner, ($RemoteScript -replace "`r`n", "`n"), $Utf8NoBom)

Write-Host ''
Write-Host 'OpenSSH will request the password to transfer the release and runner.'
& scp $Release $RollbackRelease $LocalRunner "${Server}:/root/backups/"
if ($LASTEXITCODE -ne 0) {
  throw "SCP failed with code $LASTEXITCODE. Production was not changed."
}

Write-Host ''
Write-Host 'OpenSSH will request the password to run the verified remote deployment.'
& ssh -t $Server "bash $RemoteRunner"
if ($LASTEXITCODE -ne 0) {
  throw "Remote deployment ended with code $LASTEXITCODE. Check ORIGINAL_FAIL_STEP and ROLLBACK in the output."
}

Write-Host ''
Write-Host "DEPLOY_SCRIPT_OK=$Commit"
