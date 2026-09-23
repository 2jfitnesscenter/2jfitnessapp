$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$Root = Split-Path $PSScriptRoot -Parent
$Tokens = $null; $Errors = $null
$Ast = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $Root 'deploy-23226f6.ps1'), [ref]$Tokens, [ref]$Errors)
if ($Errors.Count) { throw 'PowerShell syntax error' }
$Assignment = $Ast.Find({param($n) $n -is [System.Management.Automation.Language.AssignmentStatementAst] -and $n.Left.Extent.Text -eq '$RemoteScript' -and $n.Right.Extent.Text.StartsWith("@'")}, $true)
$Remote = $Assignment.Right.Expression.Value.Replace("`r`n", "`n")
$Functions = $Remote.Substring($Remote.IndexOf('header_value() {'), $Remote.IndexOf('chown_archive_files() {') - $Remote.IndexOf('header_value() {'))
$Block = $Remote.Substring($Remote.IndexOf('STEP=main-asset-smoke'), $Remote.IndexOf('STEP=services') - $Remote.IndexOf('STEP=main-asset-smoke'))
$Dir = Join-Path $env:TEMP ('2j-assets-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($Dir) | Out-Null
$Utf8 = New-Object Text.UTF8Encoding($false)
$Bash = 'C:\Program Files\Git\bin\bash.exe'
$Template = @'
#!/usr/bin/env bash
set -Eeuo pipefail
cd '__DIR__'
SMOKE_TIMEOUT_SEC=8
RETRY_INTERVAL_SEC=2
trap 'rc=$?; printf "FAILED step=%s ready=%s status=%s command=%s\n" "$STEP" "$ASSET_READY" "$rc" "$BASH_COMMAND" >&2; exit "$rc"' ERR
__FUNCTIONS__
# Replace only the external HTTP transport; use actual built release bodies.
curl() {
  local body='' headers='' url='' n=0
  while (( $# )); do
    case "$1" in
      -o) body=$2; shift 2 ;;
      -D) headers=$2; shift 2 ;;
      *) url=$1; shift ;;
    esac
  done
  case "$url" in
    */) cp index.html "$body"
      printf 'HTTP/1.1 200 OK\r\nCache-Control: no-cache\r\nX-Content-Type-Options: nosniff\r\nX-Frame-Options: SAMEORIGIN\r\nReferrer-Policy: strict-origin-when-cross-origin\r\nStrict-Transport-Security: max-age=31536000\r\n\r\n' > "$headers" ;;
    *.js) cp asset.js "$body" ;;
    *.css)
      if [[ '__CASE__' == dns ]]; then
        if [[ -f count ]]; then read -r n < count; fi
        n=$((n+1)); printf '%s\n' "$n" > count
        if (( n <= 2 )); then printf 000; return 28; fi
      fi
      cp asset.css "$body" ;;
    *) return 99 ;;
  esac
  if [[ "$url" != */ ]]; then
    printf 'HTTP/1.1 200 OK\r\nCache-Control: max-age=31536000, immutable\r\nContent-Encoding: gzip\r\n\r\n' > "$headers"
  fi
  printf 200
}
__BLOCK__
printf 'ASSET_READY=%s\n' "$ASSET_READY"
'@
$Dist = Join-Path $Root 'frontend/dist'
$IndexPath = Join-Path $Dist 'index.html'
if (-not (Test-Path -LiteralPath $IndexPath)) { throw 'Build required: run npm ci and npm run build in frontend first' }
$Index = [IO.File]::ReadAllText($IndexPath)
$JsMatch = [regex]::Match($Index, '"(/assets/index-[A-Za-z0-9_-]+\.js)"')
$CssMatch = [regex]::Match($Index, '"(/assets/index-[A-Za-z0-9_-]+\.css)"')
if (-not $JsMatch.Success -or -not $CssMatch.Success) { throw 'Main JS/CSS assets not found in dist/index.html' }
$JsUrl = $JsMatch.Groups[1].Value
$CssUrl = $CssMatch.Groups[1].Value
$Js = [IO.File]::ReadAllText((Join-Path $Dist $JsUrl.TrimStart('/')))
$Css = [IO.File]::ReadAllText((Join-Path $Dist $CssUrl.TrimStart('/')))
foreach ($Case in @('positive', 'negative', 'dns')) {
  $CaseDir = Join-Path $Dir $Case
  [IO.Directory]::CreateDirectory($CaseDir) | Out-Null
  [IO.File]::WriteAllText((Join-Path $CaseDir 'index.html'), $Index, $Utf8)
  [IO.File]::WriteAllText((Join-Path $CaseDir 'asset.js'), $Js, $Utf8)
  $CaseCss = $Css
  if ($Case -eq 'negative') { $CaseCss = $Css.Replace('.bk-multi-grid.users-3', '.missing-grid') }
  [IO.File]::WriteAllText((Join-Path $CaseDir 'asset.css'), $CaseCss, $Utf8)
  $UnixDir = $CaseDir.Replace('\','/') -replace '^C:', '/c'
  $Shell = $Template.Replace('__DIR__', $UnixDir).Replace('__CASE__', $Case).Replace('__FUNCTIONS__', $Functions).Replace('__BLOCK__', $Block).Replace('/tmp/2j-', "$UnixDir/2j-")
  $Path = Join-Path $CaseDir 'test.sh'
  [IO.File]::WriteAllText($Path, $Shell, $Utf8)
  $UnixPath = $Path.Replace('\','/') -replace '^C:', '/c'
  & $Bash -lc "bash -n '$UnixPath'"
  if ($LASTEXITCODE) { throw 'Bash syntax error' }
  $Output = (& $Bash -lc "bash '$UnixPath'" 2>&1 | Out-String)
  $Code = $LASTEXITCODE
  Write-Output $Output
  if ($Case -eq 'negative') {
    if ($Code -eq 0 -or $Output -notmatch 'ready=0') { throw 'Negative case failed to reject missing selector' }
  } else {
    if ($Code -ne 0 -or $Output -notmatch 'ASSET_READY=1' -or $Output -notmatch 'HEADERS=OK') { throw "$Case case failed" }
    if ($Case -eq 'dns' -and ([IO.File]::ReadAllText((Join-Path $CaseDir 'count')).Trim() -ne '3')) { throw 'DNS retries were not exercised' }
  }
  Write-Output "CASE=$Case PASS exit=$Code"
}
Write-Output "EVIDENCE=$Dir"
