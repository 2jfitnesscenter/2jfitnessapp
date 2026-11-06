# Production proxy configuration reconciliation

The repository now records the Caddy configuration that was verified on the live host. `caddy-config/Caddyfile` is the file mounted by the production overlay; the root `Caddyfile` mirrors it so the two checked-in entry points cannot silently diverge. The production Compose overlay mounts the directory and explicitly joins the existing `2j-home-staging-proxy` and `2j-pwa-demo-edge` external networks as well as its default network.

The live Caddy routes app traffic to `web:80`, Home traffic to `2j-home-visual:8080`, and synthetic staging Home traffic to `2j-home-demo:8080`. The Home routes retain the operational-path 404 rules, HSTS, and `noindex` headers. The root Caddyfile found on the host at 15:11 on 2026-10-21 was an older, currently unmounted version (it named `client-demo:8080` and had fewer blocked paths); it has been aligned in Git with the active configuration rather than kept as a misleading fallback.

## Provenance and limits of attribution

The root Caddyfile was owned by `2jfitness:2jfitness`, mode 664, and had mtime 2026-10-21 15:11:27 +0200. `docker-compose.prod.yml` was owned by `root:root`, mode 644, and had mtime 15:24:35 +0200. A Platform staging Compose file had the same 15:24:35 timestamp and declares the `2j-pwa-demo-edge` network. There is no deploy log or backup created in the 15:00–15:30 window, no successful SSH/sudo login recorded there, and auditd was inactive. The timestamps and parallel staging configuration suggest manual/platform-stage work, but the actor and exact command cannot be proven from retained logs.

The active mounted `caddy-config/Caddyfile` was modified on 2026-10-22 19:05:29 +0200 and contains both the visual Home and staging routes. Read-only production checks confirmed the live app, Home, and staging routes returned successfully at the time of inspection. Replacing this active file with the old repository version would break Home routing; this reconciliation preserves the verified live upstreams and restrictions.

## Prior baseline differences

The earlier inventory's ten differing tracked files classify as follows:

| Path | Classification | Treatment |
| --- | --- | --- |
| `docker-compose.prod.yml` | Runtime | Reconcile with the live mount and explicitly preserve both external networks. |
| `Caddyfile` | Runtime configuration input, but not the currently mounted file | Align with the verified active Caddy configuration. |
| `.env.example` | Non-runtime sample | Keep the current Git sample as canonical; preserve the exact live historical sample for baseline/rollback. No credentials are copied. |
| `.env.production.example` | Non-runtime sample | Same exact, hash-pinned preservation. |
| `.gitattributes` | Git metadata | Exact hash-pinned preservation for the live baseline only. |
| `.gitignore` | Repository metadata | Exact hash-pinned preservation for the live baseline only. |
| `.github/workflows/test.yml` | CI-only | Exact hash-pinned preservation for the live baseline only. |
| `ops/deploy-kit/windows/generate-release-runner.mjs` | Local deploy tooling | Exact hash-pinned preservation; never deployed. |
| `ops/deploy-kit/windows/generate-release-runner.test.mjs` | Local deploy tooling test | Exact hash-pinned preservation; never deployed. |
| `ops/deploy-kit/windows/templates/release-runner.ps1.in` | Local runner template | Exact hash-pinned preservation; never deployed. |

The thirteen paths absent from the previous physical production inventory are likewise non-runtime: the `2J-089` contract fixture, two historical release manifests, and ten deploy-kit scripts/tests. The release manifest records their exact historical source (including explicit absence where appropriate). These are not broad ignores: every preserved path must be in the deploy-kit's fixed path allowlist and match its manifest SHA-256 or pinned absence. Runtime paths have a separate fixed allowlist and are checked byte-for-byte.

`.env.example` and `.env.production.example` contain sample configuration only. The reconciliation does not copy `.env`, `data/`, or any populated secret into Git or into the release.
