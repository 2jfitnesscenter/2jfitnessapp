# 2J Fitness deploy kit — ONE-TIME server bootstrap. Run this yourself, once, from a normal PowerShell window.
#
# It opens ONE ssh connection to the server as root (you type the root password ONCE, or point -RootKey at a key you choose),
# verifies the server against the PINNED host key (a wrong server aborts before any password is sent), installs the restricted
# `deploy2j` user + the two root-owned scripts + the single-command sudoers rule + the dedicated public key, and then checks
# the result through the new key. Nothing is stored: the password goes to ssh only.
#
#   .\ops\deploy-kit\windows\bootstrap-2j-deploy.ps1
#   .\ops\deploy-kit\windows\bootstrap-2j-deploy.ps1 -RootKey "$HOME\.ssh\<a key you already use for root>"
#   .\ops\deploy-kit\windows\bootstrap-2j-deploy.ps1 -DryRun        (prints what would be sent; contacts nothing)
param(
  [string]$HostName = '213.136.77.197',
  [string]$RootUser = 'root',
  [string]$RootKey = '',
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$kit = Split-Path -Parent $PSScriptRoot
& (Join-Path $PSScriptRoot 'prepare-local.ps1') -HostName $HostName | Out-Host

$ssh = Join-Path $HOME '.ssh'
$pubKey = (Get-Content -LiteralPath (Join-Path $ssh '2jfitness_deploy_ed25519.pub') -Raw).Trim()
$lf = { param($p) ([IO.File]::ReadAllText($p) -replace "`r`n", "`n") }      # the shell scripts must reach the server with LF endings
$b64 = { param($text) [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($text)) }
$gateText = & $b64 (& $lf (Join-Path $kit 'server\2j-deploy-gate'))
$runText = & $b64 (& $lf (Join-Path $kit 'server\2j-deploy-run'))
$installer = Join-Path $kit 'server\install-on-server.sh'
$tmpInstaller = Join-Path $env:TEMP ('2j-install-' + [guid]::NewGuid().ToString('N') + '.sh')
[IO.File]::WriteAllText($tmpInstaller, (& $lf $installer), (New-Object Text.UTF8Encoding($false)))

$opts = @('-o', 'StrictHostKeyChecking=yes', '-o', "UserKnownHostsFile=$ssh\known_hosts_2j", '-o', 'HostKeyAlgorithms=ssh-ed25519', '-o', 'ConnectTimeout=15')
if ($RootKey) { $opts += @('-i', $RootKey, '-o', 'IdentitiesOnly=yes', '-o', 'BatchMode=yes') }
else { $opts += @('-o', 'PreferredAuthentications=password,keyboard-interactive', '-o', 'PubkeyAuthentication=no') }
$argLine = ($opts | ForEach-Object { if ($_ -match '\s') { '"' + $_ + '"' } else { $_ } }) -join ' '

if ($DryRun) {
  Write-Host ("DRYRUN ssh $argLine $RootUser@$HostName `"GATE_B64=<$($gateText.Length) chars> RUN_B64=<$($runText.Length) chars> PUBKEY=<$($pubKey.Split(' ')[0]) ...> bash -s`" < server\install-on-server.sh")
  Remove-Item -LiteralPath $tmpInstaller -Force -ErrorAction SilentlyContinue
  return
}

Write-Host ''
Write-Host "Connecting to $RootUser@$HostName (host key is pinned; you will be asked for the root password ONCE unless -RootKey is used)..."
$remote = "GATE_B64='$gateText' RUN_B64='$runText' PUBKEY='$pubKey' bash -s"
& cmd.exe /d /c "ssh $argLine $RootUser@$HostName `"$remote`" < `"$tmpInstaller`""
$code = $LASTEXITCODE
Remove-Item -LiteralPath $tmpInstaller -Force -ErrorAction SilentlyContinue
if ($code -ne 0) { throw "Server setup failed (exit $code). Nothing else was changed on this PC beyond the local key/alias." }

Write-Host ''
Write-Host 'Verifying through the NEW key (no password, restricted)...'
& (Join-Path $PSScriptRoot 'verify-2j-deploy.ps1')
