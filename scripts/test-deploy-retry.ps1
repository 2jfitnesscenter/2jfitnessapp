param([int]$TimeoutSeconds = 120, [string[]]$Cases = @('transient', 'timeout', 'services'))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$ScriptPath = Join-Path (Split-Path $PSScriptRoot -Parent) 'deploy-23226f6.ps1'
$Source = [IO.File]::ReadAllText($ScriptPath)
$Match = [regex]::Match($Source, "(?s)\`$RemoteScript = @'\r?\n(.*?)\r?\n'@")
if (-not $Match.Success) { throw 'Remote script not found' }
$Remote = $Match.Groups[1].Value.Replace("`r`n", "`n")
$FunctionsStart = $Remote.IndexOf('header_value() {')
$FunctionsEnd = $Remote.IndexOf('STEP=verify-transfer')
$Functions = $Remote.Substring($FunctionsStart, $FunctionsEnd - $FunctionsStart)
$CallerStart = $Remote.IndexOf('STEP=health-internal')
$CallerEnd = $Remote.IndexOf('STEP=health-external')
$Caller = $Remote.Substring($CallerStart, $CallerEnd - $CallerStart)
$Dir = Join-Path $env:TEMP ('2j-deploy-retry-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($Dir) | Out-Null
$Bash = 'C:\Program Files\Git\bin\bash.exe'
$Template = @'
#!/usr/bin/env bash
set -Eeuo pipefail
CASE_DIR=__DIR__
mkdir -p "$CASE_DIR/app"
APP="$CASE_DIR/app"
RELEASE="$CASE_DIR/release.tar.gz"
ROLLBACK="$CASE_DIR/rollback.tar.gz"
ROLLBACK_COMMIT=6c5c46df09dcee57bea0a531c328d3a066b8d076
COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
STEP=bootstrap
DEPLOY_STARTED=1
LOG="$CASE_DIR/output.log"
READINESS_TIMEOUT_SEC=__TIMEOUT__
SMOKE_TIMEOUT_SEC=45
RETRY_INTERVAL_SEC=2
exec > >(tee -a "$LOG") 2>&1
exec 9>"$CASE_DIR/trace.log"
BASH_XTRACEFD=9
PS4='+ ${BASH_SUBSHELL}:${LINENO}:${FUNCNAME[0]:-main}: '
set -x
# Only external side effects are stubbed. Production functions, ERR handler,
# rollback and the health caller below are extracted verbatim from the script.
curl() {
  local body='' headers='' arg n=0
  while (( $# )); do
    arg=$1; shift
    case "$arg" in
      -o) body=$1; shift ;;
      -D) headers=$1; shift ;;
    esac
  done
  if [[ "$body" == *rollback-body ]]; then
    printf '{"ok":true}' > "$body"
    printf 200
    return 0
  fi
  if [[ -f "$CASE_DIR/attempts" ]]; then read -r n < "$CASE_DIR/attempts"; fi
  n=$((n + 1))
  printf '%s\n' "$n" > "$CASE_DIR/attempts"
  if [[ '__MODE__' == timeout || "$n" == 1 ]]; then
    printf 'SIMULATED_CURL attempt=%s transport=56\n' "$n" >&2
    printf 000
    return 56
  elif [[ "$n" == 2 ]]; then
    printf 'SIMULATED_CURL attempt=2 status=503\n' >&2
    printf 503
    return 0
  fi
  printf '{"ok":true}' > "$body"
  printf 'HTTP/1.1 200 OK\r\n\r\n' > "$headers"
  printf 'SIMULATED_CURL attempt=%s status=200\n' "$n" >&2
  printf 200
}
docker() {
  if [[ " $* " == *' up '* ]]; then printf 'ROLLBACK_EXECUTION\n' >> "$CASE_DIR/rollbacks"; fi
  if [[ " $* " == *' ps '* ]]; then printf 'api\nweb\ncaddy\n'; fi
  return 0
}
tar() { return 0; }
chown() { return 0; }
__FUNCTIONS__
__CALLER__
printf 'CALLER_SUCCESS status=%s\n' "$INTERNAL_STATUS"
'@
$Utf8 = New-Object Text.UTF8Encoding($false)
foreach ($Mode in $Cases) {
  $CaseDir = Join-Path $Dir $Mode
  [IO.Directory]::CreateDirectory($CaseDir) | Out-Null
  $UnixDir = ($CaseDir.Replace('\', '/') -replace '^C:', '/c')
  $Shell = $Template.Replace('__DIR__', "'$UnixDir'").Replace('__MODE__', $Mode).Replace('__TIMEOUT__', [string]$TimeoutSeconds).Replace('__FUNCTIONS__', $Functions).Replace('__CALLER__', $Caller)
  if ($Mode -eq 'services') {
    $ServiceStart = $Remote.IndexOf('STEP=services')
    $ServiceEnd = $Remote.IndexOf('STEP=finalize')
    $Shell = $Shell.Replace($Caller, $Remote.Substring($ServiceStart, $ServiceEnd - $ServiceStart))
    $Shell = $Shell.Replace('"$INTERNAL_STATUS"', '"$RUNNING"')
  }
  # Redirect the real caller's scratch paths into this test's private directory.
  $Shell = $Shell.Replace('/tmp/2j-', "$UnixDir/2j-")
  $Path = Join-Path $CaseDir 'runner.sh'
  [IO.File]::WriteAllText($Path, $Shell, $Utf8)
  $UnixPath = $Path.Replace('\', '/') -replace '^C:', '/c'
  & $Bash -lc "bash -n '$UnixPath'"
  if ($LASTEXITCODE -ne 0) { throw 'Harness syntax failed' }
  $Start = [datetime]::UtcNow
  & $Bash -lc "bash '$UnixPath'"
  $ExitCode = $LASTEXITCODE
  $Elapsed = ([datetime]::UtcNow - $Start).TotalSeconds
  $Attempts = '0'
  if (Test-Path (Join-Path $CaseDir 'attempts')) { $Attempts = [IO.File]::ReadAllText((Join-Path $CaseDir 'attempts')).Trim() }
  $RollbackFile = Join-Path $CaseDir 'rollbacks'
  $Rollbacks = 0
  if (Test-Path $RollbackFile) { $Rollbacks = @([IO.File]::ReadAllLines($RollbackFile)).Count }
  Write-Output "CASE=$Mode EXIT=$ExitCode ATTEMPTS=$Attempts ROLLBACKS=$Rollbacks ELAPSED=$([math]::Round($Elapsed,1))s"
  if ($Mode -eq 'services') {
    if ($ExitCode -ne 0 -or $Rollbacks -ne 0) { throw 'Service caller failed' }
  } elseif ($Mode -eq 'transient') {
    if ($ExitCode -ne 0 -or $Attempts -ne '3' -or $Rollbacks -ne 0) { throw 'Transient scenario failed' }
  } else {
    if ($ExitCode -eq 0 -or [int]$Attempts -lt 2 -or $Rollbacks -ne 1 -or $Elapsed -lt ($TimeoutSeconds - 1)) { throw 'Timeout scenario failed' }
  }
}
Write-Output "EVIDENCE=$Dir"
