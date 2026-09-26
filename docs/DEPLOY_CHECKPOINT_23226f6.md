# Deployment checkpoint 23226f6

Preserved operational reference from the successful deployment on 22 September 2026.
This is not a pending deployment or a generic deploy command for the current branch.

## Files preserved

- `deploy-23226f6.ps1`: final reviewed PowerShell/SCP/SSH runner and embedded Bash.
  Fixed target: `23226f635c1508600a17afafafb5f8bb31a79180`; expected previous production
  and rollback: `6c5c46df09dcee57bea0a531c328d3a066b8d076`.
  It deliberately refuses another local HEAD or another server source tree.
  The current documentation/tooling HEAD is newer, and production already has the target.
  Do not bypass these guards to rerun this completed deployment.
- `scripts/test-deploy-retry.ps1`: extracts the actual functions, error handler,
  rollback and caller; simulates HTTP/Docker/archive operations in temporary directories.
  Exercises 56 -> 503 -> 200, real timeout with one rollback, and service readiness.
- `scripts/test-deploy-assets.ps1`: extracts the actual asset/header smoke and retry
  functions; uses built JS/CSS with simulated HTTP headers/transport. Exercises success,
  missing CSS selector, and two DNS errors 28 followed by success. This does not test a
  live gzip encoder or server; production header/encoding checks were separately confirmed.

The superseded local `deploy-6c5c46d.ps1` is not versioned: it targets the older transition,
lacks the final fixes and contains no unique required application work. It is not the
rollback mechanism; the preserved runner contains that mechanism. Do not delete local copies
automatically, but do not use them as the deployment reference.

## Local regression tests (no SSH or production access)

Prerequisites: Windows PowerShell, Git for Windows Bash at
`C:\Program Files\Git\bin\bash.exe`, repository and temporary directory on drive C.
The asset test additionally needs the frontend build (generated assets are not committed).
On a fresh clone of this checkpoint, run `npm ci` then `npm run build` inside `frontend`.
Return to the repository root and run:

```powershell
.\scripts\test-deploy-retry.ps1
.\scripts\test-deploy-assets.ps1
```

The default retry test takes about 125 seconds and enforces a 120-second timeout.
`-TimeoutSeconds 6` is available for a quick local check; it is not the production deadline.
Asset paths come from `frontend/dist/index.html`; the expected content belongs to this
release and must be deliberately reviewed if a future release changes it.
Evidence and simulated data are written under `%TEMP%`, never committed.

## Protections to preserve

Binary SCP, local/remote SHA-256, exact source-tree check, verified data backup, Sync V2
rollback marker, strict smoke, bounded retries, rollback only from the main shell,
separate timeout initialization, CSS selectors checked in CSS and JS content in JS.
No passwords or private keys are stored in these files. SSH uses the operator's terminal.
The script writes a backup containing runtime data on the server; never commit or publish it.

Any future deployment requires explicit authorization and a release-specific review of
target/origin/rollback and smoke. No deployment was performed to publish this reference.
