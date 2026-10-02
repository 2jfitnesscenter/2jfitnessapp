# 2J Fitness — automated deploys without a password

Goal: an agent (Claude) can run a prepared, validated release runner from the owner's Windows PC **without anyone typing the SSH
password**, while keeping every guarantee the runners already have (backup, checks, install, probes, data validation, rollback),
and **never deploying without the owner's explicit "AUTORIZO DEPLOY"**.

## Architecture

```
Windows PC                                           VPS 213.136.77.197
──────────                                           ──────────────────
deploy-<short>.2j.ps1  (converted runner)
  ssh 2j-prod ping            ─── dedicated key ───▶  sshd → forced command: /usr/local/sbin/2j-deploy-gate
  ssh 2j-prod put <file> < f  ─── (restrict) ──────▶    ping | put <name> | run <short> <rollback-short> <run-id>   (nothing else)
  ssh 2j-prod run a b id                                 └─ run → sudo → /usr/local/sbin/2j-deploy-run  (root-owned, the only sudo rule)
                                                           └─ re-validates files, flock, installs them into /root/backups,
                                                              then runs the SAME embedded runner script as root (env -i):
                                                              backup · checks · install · probes · data validation · rollback
```

* **Key**: `~/.ssh/2jfitness_deploy_ed25519`, used for nothing else, never inside the repo. Alias `2j-prod` in `~/.ssh/config`
  (`BatchMode yes` = never prompts and never falls back to a password; `StrictHostKeyChecking yes` against a dedicated pinned
  `known_hosts_2j`; `IdentitiesOnly`; no agent/X11 forwarding).
* **Server user** `deploy2j`: locked password, **no** docker/sudo/adm group, no shell reachable through the key. Its
  `authorized_keys` is **root-owned** (the user cannot edit its own restrictions) and reads
  `restrict,command="/usr/local/sbin/2j-deploy-gate" ssh-ed25519 …` — no pty, no port/agent/X11 forwarding, one fixed command.
* **Gate** (`server/2j-deploy-gate`): accepts only `ping`, `put <name>` (strict file-name whitelist for the three per-release
  files, 400 MiB cap, atomic, returns the SHA-256 so the PC can compare) and `run <short> <rollback-short> <run-id>` (hex-only
  arguments). Everything else is refused.
* **Root wrapper** (`server/2j-deploy-run`): the **only** thing sudoers allows `deploy2j` to run. It does not contain deploy logic:
  it validates the arguments and the three files (regular, not symlinks, owned by `deploy2j`, non-empty), takes a lock so two
  deployments can never overlap, moves the files into `/root/backups/` with the names and root ownership the existing runner expects,
  writes an audit line (`/var/log/2j-deploy-audit.log`) before and after, and runs the runner with a clean environment. The runner's
  exit code is passed back, so a failed deploy fails the local run exactly as before.
* **Runner conversion** (`windows/convert-runner.mjs`): the existing `deploy-<short>.ps1` is copied to `deploy-<short>.2j.ps1`
  with only (1) a new `-AuthorizedBy` parameter, (2) the inlined channel functions, (3) the final transport block (`scp` + `ssh -t root@…`
  replaced by `Send-2JFile` + `Invoke-2JRun`). All validation, hashing, simulation, backup and rollback logic is untouched. The
  original runners are never modified or deleted.
* **Authorization**: a real run is refused unless `-AuthorizedBy 'AUTORIZO DEPLOY'` is passed, and the use is logged to
  `~/.2jfitness-deploy/audit.log`. This is a guard-rail for the agent workflow, not a barrier against the owner's own PC (see Risks).

## One-time setup (the owner, once)

1. `.\ops\deploy-kit\windows\prepare-local.ps1` — creates the key, the pinned host key and the `2j-prod` alias (already done on this PC).
2. `.\ops\deploy-kit\windows\bootstrap-2j-deploy.ps1` — **the only step that needs the root password (typed once, by you)**:
   one ssh connection installs the user, the two scripts, the sudoers rule and the public key, then verifies the channel.
   `-DryRun` shows exactly what would be sent without contacting anything.
3. `.\ops\deploy-kit\windows\verify-2j-deploy.ps1` — harmless checks (PASS/FAIL), re-runnable any time.

Revoke everything: delete the line in `/home/deploy2j/.ssh/authorized_keys`, `userdel -r deploy2j`, `rm /etc/sudoers.d/2j-deploy /usr/local/sbin/2j-deploy-*`.

## Exact privileges of the deploy key

| Layer | Allowed | Not allowed |
|---|---|---|
| ssh (forced command) | `ping`, `put <whitelisted release file>`, `run <hex> <hex> <hex32>` | shell, pty, any other command, forwarding, agent |
| sudo (`/etc/sudoers.d/2j-deploy`) | `/usr/local/sbin/2j-deploy-run *` as root | any other command |
| files | write `/home/deploy2j/incoming` | `/opt/2jfitness`, `data/`, `.env`, docker, sshd config, its own `authorized_keys` |

## Flow for every release (agent workflow)

1. **Prepare** the release commit and its runner (same as today), then `node ops/deploy-kit/windows/convert-runner.mjs deploy-<short>.ps1`.
2. **PrepareOnly**: `.\deploy-<short>.2j.ps1 -PrepareOnly` — local validation, archives, simulation. No connection to production.
3. **Report** the delta, tests, hashes and rollback target, then **wait for the owner's exact text `AUTORIZO DEPLOY`** (for that commit).
   The agent never authorizes itself and never deploys because a commit exists.
4. **Run**: `.\deploy-<short>.2j.ps1 -AuthorizedBy 'AUTORIZO DEPLOY'` — channel probe, uploads (hash-checked), then the remote runner.
5. **Validate production**: the runner prints `DEPLOY_OK`, `HEALTH`, `DATA`, `ROLLBACK=NOT_NEEDED`…; confirm `https://app.2jfitnesscenter.com/api/health`,
   the release-specific smoke lines, and `git`/`.deployed-commit`. On any failure the runner rolls back as before; report it verbatim.
6. **Return** the result. No push is ever part of this.

## Risks (read before relying on it)

* **A key that can deploy can deploy anything.** Whoever holds the private key can run a release as root through the wrapper (the
  runner is arbitrary code). The restrictions remove shells and every other capability, and the audit log records each run, but the
  deploy key must be treated like root. Keep it only on this PC (owner-only ACL), never commit it, revoke it if the PC is lost.
* **No passphrase** on the key (needed for unattended use). An optional hardening: add a passphrase and load it into the Windows
  `ssh-agent` once per boot (`ssh-keygen -p`, `ssh-add`) — then unattended runs still work while the key at rest is encrypted.
* **The "AUTORIZO DEPLOY" check is behavioural.** The runner requires the phrase as a parameter and logs it, but anyone with this PC
  can type it. It guards the agent workflow, not the owner.
* **Pre-existing root key.** `~/.ssh/2jfitness_contabo` (older) logs in to the server as **root without a password or passphrase**.
  Anything with access to this PC can use it. After the new channel is verified, consider removing that line from the server's
  `/root/.ssh/authorized_keys` (and deleting the file) — it is outside this kit and left untouched.
* **Root password login is still enabled on the server** (`Permission denied (publickey,password)`). Disabling it
  (`PasswordAuthentication no`) once key access is confirmed would remove password guessing; it is not changed by this kit.
