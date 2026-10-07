# 2J Fitness deploy kit — safe verification of the deploy channel. Harmless: it never uploads a release or runs a deployment.
#   PASS lines are what must be true; every FAIL stops with a non-zero exit code.
$ErrorActionPreference = 'Continue'
$script:failed = 0
function Check([string]$name, [bool]$ok, [string]$detail = '') {
  if ($ok) { Write-Host "PASS  $name" } else { Write-Host "FAIL  $name  $detail"; $script:failed++ }
}
function Ssh2j { param([string[]]$a) $o = & ssh -o BatchMode=yes 2j-prod @a 2>&1; [pscustomobject]@{ Code = $LASTEXITCODE; Out = ($o | Out-String).Trim() } }

$r = Ssh2j @('ping')
Check 'key login without password; forced command answers' ($r.Code -eq 0 -and $r.Out -match 'gate=ok user=deploy2j') $r.Out

foreach ($bad in @('id', 'whoami', 'bash', 'cat /etc/passwd', 'sudo -n true', 'ls /root', 'put ../../etc/cron.d/x', 'put evil.sh', 'run zzz zzz zzz')) {
  $r = Ssh2j @($bad)
  Check "refused: '$bad'" ($r.Code -ne 0 -and $r.Out -match 'refused|not allowed') $r.Out
}
# only meaningful once authentication works: the gate itself must answer "refused" to a session without a command
$r = & ssh -o BatchMode=yes -tt 2j-prod 2>&1 | Out-String
Check 'no interactive shell (session without command is refused by the gate)' ($LASTEXITCODE -ne 0 -and $r -match 'PTY allocation request failed|refused' -and $r -notmatch 'Permission denied') $r

# a wrong run request reaches the wrapper (through sudo) and is refused for missing files — proving the sudo path works, with no side effect
$r = Ssh2j @('run 0000000 0000000 00000000000000000000000000000000')
Check 'sudo path reaches the root wrapper (refuses: files not uploaded)' ($r.Code -ne 0 -and $r.Out -match 'missing or not a regular file') $r.Out

# the host key is pinned: a different server would be refused
$r = & ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=NUL 2j-prod ping 2>&1 | Out-String
Check 'unknown host key is refused (strict checking)' ($LASTEXITCODE -ne 0 -and $r -match 'Host key verification failed|No ED25519 host key is known') $r

if ($script:failed -gt 0) { Write-Host "VERIFY_FAILED=$script:failed"; exit 1 }
Write-Host 'VERIFY_OK'
