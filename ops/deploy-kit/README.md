# 2J Fitness — restricted deployment channel proposal

## Status

This kit is versioned tooling, not an active production channel. It has **not** been installed or verified on the production VPS. The previously validated deployment path remains interactive SSH. This work did not create or copy keys, change SSH/server configuration, edit `authorized_keys`, install server scripts, or change sudoers.

Do not run `prepare-local.ps1` or `bootstrap-2j-deploy.ps1` as routine release preparation. They are setup tools that create local SSH material and/or modify server users, `authorized_keys`, sudoers and root-owned scripts. Any future installation requires a separately reviewed and explicitly approved operator task.

## Proposed channel design

The kit contains:

- `windows/generate-release-runner.mjs`: renders a release-specific PowerShell runner from a versioned config and template, validating full SHA-40 values, exact delta paths and rollback identity.
- `windows/convert-runner.mjs` and `windows/2j-transport.ps1`: proposed restricted transport wrapper for release files and runner invocation.
- `server/2j-deploy-gate` and `server/2j-deploy-run`: proposed forced-command gate and narrowly scoped root wrapper. These files are not installed on production.
- Local validation and isolated Docker tests for runner generation, transfer contracts, permissions and simulated install behavior.

The release runner remains responsible for backup, exact code/data guards, health/smoke checks and code-only rollback. No production run is authorized merely by generating or testing a runner. The production operator must explicitly approve any real deployment through the existing project process.

## Local validation

- Generator tests: `node --test ops/deploy-kit/windows/generate-release-runner.test.mjs ops/deploy-kit/windows/frontend-test-policy.test.mjs`.
- Bash/permission tests: `ops/deploy-kit/tests/run-tests-in-docker.sh` uses a throwaway Ubuntu container and removes it afterward.
- PowerShell scripts can be parsed locally without contacting production.

A successful local simulation does not prove the server-side channel is installed or safe to activate.

## Security boundaries

- Never commit SSH private keys, passwords, VAPID private keys, tokens, backups, production data or deployment logs containing secrets.
- Do not copy or print credentials. Server-side installation and SSH hardening are outside this proposal.
- The proposed constrained deploy identity must be treated as equivalent to root for the deployment capability it would hold. Review the root wrapper, forced-command gate, file ownership, sudoers and revocation procedure before any installation.
- Existing SSH identities, authentication methods and server configuration remain outside the kit and have not been inspected or changed by this work.

## Future activation checklist

Only in a separately approved operations task: review the scripts and threat model; confirm a recoverable production backup and exact rollback; choose operator-managed credentials without placing them in Git; install through a controlled maintenance procedure; verify the resulting channel with read-only checks; and retain an immediate revocation path. Do not disable an existing SSH method as part of initial installation.