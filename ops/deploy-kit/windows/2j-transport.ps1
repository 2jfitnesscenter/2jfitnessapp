# 2J Fitness deploy kit — transport + authorization functions, INLINED into every converted runner by convert-runner.mjs
# (so a runner stays one self-contained file, whichever branch is checked out). Uses only the `2j-prod` ssh alias: the dedicated
# restricted key, strict pinned host key, BatchMode (never prompts, never falls back to a password).

# The runner refuses to touch production unless the person typed the authorization phrase. This is a guard-rail for the
# agent workflow (an agent must pass back exactly what the owner wrote in chat); it is not a security boundary against the owner's own PC.
function Assert-2JAuthorized {
  param([string]$AuthorizedBy, [string]$Commit)
  if ($AuthorizedBy -cne 'AUTORIZO DEPLOY') {
    throw "NOT AUTHORIZED: a real deployment needs the owner's exact phrase. Re-run with -AuthorizedBy 'AUTORIZO DEPLOY' ONLY after the owner wrote it in chat for commit $Commit."
  }
  $dir = Join-Path $HOME '.2jfitness-deploy'
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  Add-Content -LiteralPath (Join-Path $dir 'audit.log') -Value ("{0} AUTHORIZED commit={1} user={2}" -f (Get-Date -Format o), $Commit, $env:USERNAME)
}

function Invoke-2JSsh {
  param([string[]]$Arguments)
  & ssh -o BatchMode=yes 2j-prod @Arguments
  return $LASTEXITCODE
}

# Harmless probe: key login works and the server-side forced command answers (no shell, no root).
function Test-2JChannel {
  $out = & ssh -o BatchMode=yes 2j-prod ping 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $out -notmatch 'gate=ok user=deploy2j') {
    throw "Deploy channel not ready (run ops/deploy-kit/windows/verify-2j-deploy.ps1). Production was not changed. $out"
  }
  Write-Host ("2J_CHANNEL_OK " + $out.Trim())
}

# Streams one file over the restricted channel (binary-safe through cmd redirection; the server checks the name, size and re-hashes).
function Send-2JFile {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Missing file to upload: $Path" }
  $name = Split-Path -Leaf $Path
  $out = & cmd.exe /d /c "ssh -o BatchMode=yes 2j-prod put $name < `"$Path`"" 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $out -notmatch ('put=ok name=' + [regex]::Escape($name))) {
    throw "Upload failed for $name (exit $LASTEXITCODE). Production was not changed. $out"
  }
  $local = (Get-FileHash -Algorithm SHA256 -LiteralPath $Path).Hash.ToLowerInvariant()
  if ($out -notmatch ('sha256=' + $local)) { throw "Upload hash mismatch for $name. Production was not changed. Remote said: $out" }
  Write-Host ("UPLOADED $name sha256=$local")
}

# Hands over to the root wrapper through sudo: the existing remote runner (backup, checks, install, probes, data validation, rollback) does everything.
function Invoke-2JRun {
  param([string]$Short, [string]$RollbackShort, [string]$RunId)
  & ssh -o BatchMode=yes 2j-prod run $Short $RollbackShort $RunId
  return $LASTEXITCODE
}
