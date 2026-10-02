# 2J Fitness deploy kit — local Windows preparation (idempotent, safe to re-run).
#   · a dedicated ed25519 key, used for NOTHING else, kept OUTSIDE the repo (~/.ssh)
#   · a clear ssh alias `2j-prod` with strict host-key checking against a dedicated pinned known_hosts file
#   · owner-only permissions on the private key
# No secret is ever written to the repository, and nothing here contacts the server.
param(
  [string]$HostName = '213.136.77.197',
  [string]$KeyName = '2jfitness_deploy_ed25519'
)
$ErrorActionPreference = 'Stop'
$ssh = Join-Path $HOME '.ssh'
New-Item -ItemType Directory -Force -Path $ssh | Out-Null
$key = Join-Path $ssh $KeyName
$pub = "$key.pub"

if (-not (Test-Path -LiteralPath $key)) {
  # NO passphrase. Do not pass -N '""' from PowerShell: it reaches ssh-keygen as the two literal characters "" and the key gets
  # a passphrase, after which every BatchMode login fails at signing time. cmd.exe passes a real empty string.
  & cmd.exe /d /c "ssh-keygen -q -t ed25519 -a 64 -N `"`" -C 2jfitness-deploy@$($env:COMPUTERNAME) -f `"$key`""
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $pub)) { throw 'ssh-keygen failed' }
  Write-Host "KEY_CREATED=$key"
} else { Write-Host "KEY_EXISTS=$key" }

# owner-only ACL on the private key (OpenSSH for Windows refuses a key readable by others)
& icacls $key /inheritance:r | Out-Null
& icacls $key /grant:r "$($env:USERNAME):(R,W)" | Out-Null
& icacls $key /remove:g 'Everyone' 'Users' 'Authenticated Users' 2>$null | Out-Null

# pinned host key: take the ed25519 key this PC already trusted for the server (from earlier connections)
$pinned = Join-Path $ssh 'known_hosts_2j'
$known = Join-Path $ssh 'known_hosts'
if (-not (Test-Path -LiteralPath $pinned)) {
  $line = if (Test-Path -LiteralPath $known) { Get-Content $known | Where-Object { $_ -match ('^' + [regex]::Escape($HostName) + ' ssh-ed25519 ') } | Select-Object -First 1 } else { $null }
  if (-not $line) { throw "No trusted ed25519 host key for $HostName in $known. Connect once yourself (ssh root@$HostName) and confirm its fingerprint with your provider first." }
  Set-Content -LiteralPath $pinned -Value $line -Encoding ascii
  Write-Host "HOSTKEY_PINNED=$pinned"
} else { Write-Host "HOSTKEY_PIN_EXISTS=$pinned" }
Write-Host ("HOSTKEY_FINGERPRINT=" + ((& ssh-keygen -lf $pinned) -join ' '))

# ssh alias (a marked block, replaced in place on re-run)
$cfg = Join-Path $ssh 'config'
$begin = '# >>> 2j-prod (managed by ops/deploy-kit) >>>'
$end = '# <<< 2j-prod <<<'
$block = @"
$begin
Host 2j-prod
  HostName $HostName
  User deploy2j
  Port 22
  IdentityFile ~/.ssh/$KeyName
  IdentitiesOnly yes
  BatchMode yes
  StrictHostKeyChecking yes
  UserKnownHostsFile ~/.ssh/known_hosts_2j
  HostKeyAlgorithms ssh-ed25519
  ForwardAgent no
  ForwardX11 no
  ServerAliveInterval 20
  ServerAliveCountMax 6
  ConnectTimeout 15
$end
"@
$text = if (Test-Path -LiteralPath $cfg) { Get-Content -LiteralPath $cfg -Raw } else { '' }
$pattern = '(?s)' + [regex]::Escape($begin) + '.*?' + [regex]::Escape($end)
if ($text -match $pattern) { $text = [regex]::Replace($text, $pattern, { param($m) $block }) }
else { $text = ($text.TrimEnd() + "`r`n`r`n" + $block + "`r`n").TrimStart() }
Set-Content -LiteralPath $cfg -Value $text -Encoding ascii
Write-Host "SSH_ALIAS=2j-prod ($cfg)"
Write-Host ("PUBLIC_KEY=" + (Get-Content -LiteralPath $pub))
Write-Host 'LOCAL_PREPARE_OK'
