# Builds the SIGNED Android release APK and verifies it against what the server trusts.
#   .\scripts\android-release-build.ps1 -Keystore C:\path\to\2jfitness-release.jks
# Passwords are typed at the prompt (not echoed), live only in this process's environment for the Gradle run, and are never written to
# disk, git or logs. Alternative without this script: create frontend\android\keystore.properties (git-ignored) - see docs/ANDROID_RELEASE.md.
param(
  [Parameter(Mandatory = $true)][string]$Keystore,
  [string]$Alias = '2jfitness'
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$android = Join-Path $repo 'frontend\android'
if (-not (Test-Path -LiteralPath $Keystore)) { throw "Keystore not found: $Keystore" }
if (-not $env:JAVA_HOME) { $env:JAVA_HOME = Join-Path $env:LOCALAPPDATA '2JFitnessToolchain\jdk-21' }
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

# Remote-shell mode: the APK loads https://app.2jfitnesscenter.com (the generated file is git-ignored).
Copy-Item -Force (Join-Path $repo 'frontend\capacitor.remote.config.json') (Join-Path $android 'app\src\main\assets\capacitor.config.json')

function Read-Plain([string]$prompt) {
  $s = Read-Host $prompt -AsSecureString
  $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }
}
$names = '2J_KEYSTORE_FILE', '2J_KEYSTORE_PASSWORD', '2J_KEY_ALIAS', '2J_KEY_PASSWORD'
try {
  $store = Read-Plain 'Keystore password'
  $key = Read-Plain 'Key password (Enter = same as keystore)'
  if (-not $key) { $key = $store }
  [Environment]::SetEnvironmentVariable('2J_KEYSTORE_FILE', (Resolve-Path -LiteralPath $Keystore).Path, 'Process')
  [Environment]::SetEnvironmentVariable('2J_KEYSTORE_PASSWORD', $store, 'Process')
  [Environment]::SetEnvironmentVariable('2J_KEY_ALIAS', $Alias, 'Process')
  [Environment]::SetEnvironmentVariable('2J_KEY_PASSWORD', $key, 'Process')
  Push-Location $android
  try { & .\gradlew.bat --no-daemon assembleRelease; if ($LASTEXITCODE -ne 0) { throw "assembleRelease failed ($LASTEXITCODE)" } } finally { Pop-Location }
} finally {
  foreach ($n in $names) { [Environment]::SetEnvironmentVariable($n, $null, 'Process') }
  $store = $null; $key = $null
}
$apk = Join-Path $android 'app\build\outputs\apk\release\app-release.apk'
node (Join-Path $repo 'scripts\android-release-verify.mjs') $apk
exit $LASTEXITCODE
