// Converts a per-release deploy runner (deploy-<short>.ps1) from "root password over ssh/scp" to the restricted 2j-prod channel,
// WITHOUT touching any of its validation, backup, install, probe, data-protection or rollback logic (those live in the local
// preparation and in the remote script the runner embeds; only the final transport block changes).
//   node ops/deploy-kit/windows/convert-runner.mjs deploy-abc1234.ps1 [out.ps1]      (default out = deploy-abc1234.2j.ps1)
// Adds -AuthorizedBy 'AUTORIZO DEPLOY' (mandatory for a real run; -PrepareOnly needs nothing). The original is never modified.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NL = String.fromCharCode(10), CRLF = String.fromCharCode(13, 10)
const src = process.argv[2]
if (!src) { console.error('usage: node convert-runner.mjs <runner.ps1> [out.ps1]'); process.exit(2) }
const out = process.argv[3] || src.replace(/\.ps1$/, '.2j.ps1')
const here = path.dirname(fileURLToPath(import.meta.url))
const transport = fs.readFileSync(path.join(here, '2j-transport.ps1'), 'utf8').split(CRLF).join(NL)
let s = fs.readFileSync(src, 'utf8'); const crlf = s.includes(CRLF); s = s.split(CRLF).join(NL)

const must = (cond, msg) => { if (!cond) { console.error('CONVERT_FAILED: ' + msg); process.exit(1) } }
must(!s.includes('Assert-2JAuthorized'), 'already converted')

// 1) parameter
const p0 = 'param([switch]$PrepareOnly)'
must(s.includes(p0), 'param block not found')
s = s.replace(p0, () => "param([switch]$PrepareOnly, [string]$AuthorizedBy = '')")

// 2) functions right after Set-Location
const anchor = 'Set-Location -LiteralPath $PSScriptRoot' + NL
must(s.includes(anchor), 'Set-Location anchor not found')
s = s.replace(anchor, () => anchor + NL + '# ---- 2J restricted deploy channel (ops/deploy-kit) ----' + NL + transport.trim() + NL + '# ---- end channel ----' + NL)

// 3) the transport tail
const t0 = s.indexOf("Write-Host 'OpenSSH will request the password to transfer the release and runner.'")
must(t0 > 0, 'scp block not found')
const tStart = s.lastIndexOf("Write-Host ''", t0)
const endMarker = 'Check ORIGINAL_FAIL_STEP and ROLLBACK in the output."' + NL + '}'
const e0 = s.indexOf(endMarker, t0)
must(e0 > 0, 'ssh block end not found')
const tEnd = e0 + endMarker.length
const replacement = [
  "Assert-2JAuthorized -AuthorizedBy $AuthorizedBy -Commit $Commit",
  "Write-Host '2J_DEPLOY_CHANNEL=2j-prod (dedicated restricted key, no password)'",
  "Test-2JChannel",
  "Send-2JFile $Release",
  "Send-2JFile $RollbackRelease",
  "Send-2JFile $LocalRunner",
  "$RunCode = Invoke-2JRun -Short $ShortCommit -RollbackShort $ExpectedCurrentShort -RunId $RunId",
  "if ($RunCode -ne 0) {",
  '  throw "Remote deployment ended with code $RunCode. Check ORIGINAL_FAIL_STEP and ROLLBACK in the output."',
  "}",
].join(NL)
s = s.slice(0, tStart) + replacement + s.slice(tEnd)
must(!s.includes('& scp '), 'scp call still present')
must(!s.includes('ssh -t $Server'), 'old ssh -t still present')

fs.writeFileSync(out, crlf ? s.split(NL).join(CRLF) : s)
console.log('CONVERTED ' + src + ' -> ' + out)
