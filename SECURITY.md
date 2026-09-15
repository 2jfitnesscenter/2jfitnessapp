# Security policy

2J Fitness Center is a self-hosted app: you run the server, you hold the data. This file says which
versions get fixes, how to report something privately, and — the part most people actually
need — what the app protects you from and what it doesn't.

## Supported versions

Only the **latest release**. Releases are semver tags (`v1.0.0` → `v1.2.3`, see
[CHANGELOG.md](CHANGELOG.md)); there is no LTS or maintenance branch and older tags are never
patched. A fix ships in the next release and in the `latest` images on ghcr.io.

Updating a self-hosted instance:

```bash
git pull && docker compose pull && docker compose up -d
```

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository — **Security** tab → **Report a
vulnerability**.

> Private reporting has to be switched on in the repository settings for that link to work
> (Settings → Advanced Security → Private vulnerability reporting). If it 404s, open a normal
> issue saying only *"I need a private channel for a security report"* — no details, no repro —
> and it will be enabled.

Please don't put a working exploit in a public issue if it can be used against other people's
instances. Everything else (a crash you can only trigger on your own box, a scanner warning)
is fine as a normal issue.

Useful in a report: the version or commit, whether you're running the prebuilt images or a
source build, your `RP_ID`/`ORIGIN` and what sits in front of the app, steps to reproduce, and
what an attacker gets out of it.

**On response times:** this is a hobby project maintained by one person alongside school. There
is no SLA and no bounty. Expect days rather than hours, and longer during exam periods. If a
week goes by with no reply, comment on the advisory thread — it's more likely to be a missed
notification than a decision. If a report goes unfixed and you want to disclose publicly, say so
in the thread; there's no objection, and no request to sit on it indefinitely.

## In scope

- **`api/server.js`** — forging or replaying a session cookie, bypassing passkey verification,
  reading or writing another user's data through `/api/data`, reaching `/api/admin/*` without
  being an admin, or creating a profile without a valid code while `INVITE_ONLY=1`.
- **Frontend** — XSS in the React app, or anything that lets a page on another origin read or
  change a signed-in user's data.
- **Shipped deployment config** — `docker-compose.yml`, `web/nginx.conf`, the two Dockerfiles:
  a default that exposes something a self-hoster wouldn't expect to be exposed.
- **The published images** `2jfitness-api` and `2jfitness-web`.

## Out of scope

- Anything that already assumes access to the host, to `./data`, or to the Docker socket. The
  operator is trusted by design — see the security model below.
- Admins reading their users' workout history. That is the documented purpose of the admin
  dashboard, not a leak.
- **Missing rate limiting**, brute force, or "I sent 100k requests and it got slow". The app
  has no rate limiting at all and doesn't pretend to; that belongs in the reverse proxy you put
  in front of it. Genuine amplification (one small request causing unbounded work) *is* in scope.
- **Missing security headers** (CSP, HSTS, X-Frame-Options) — `web/nginx.conf` sets none; TLS
  and headers are the reverse proxy's job. A concrete attack that headers would have stopped is
  still worth reporting.
- Instances served over plain `http://` on a LAN IP. Unsupported: passkeys don't work there and
  the session cookie isn't marked `Secure`.
- Scanner output with no working exploit, and `npm audit` findings in build-time
  devDependencies (Vite, Vitest, Capacitor CLI) that never reach a running instance.
- The GitHub Pages demo build — it has no backend at all, everything stays in that browser.
- Third-party content: the exercise image/GIF dataset and the CDN it's fetched from.

## Security model

Read this before hosting 2J Fitness Center for anyone other than yourself.

### What it does

- **Passkeys only.** No passwords, no email addresses, no reset flow. Registration and login are
  verified server-side by `@simplewebauthn/server` against `expectedOrigin: ORIGIN` and
  `expectedRPID: RP_ID`, and the authenticator's signature counter is stored and updated on every
  login (`api/server.js:292-318`, `api/server.js:338-358`).
- **Sessions are a signed cookie.** `gymsid` carries `<uid>:<expiry>:<version>` plus an
  HMAC-SHA256 tag over it, compared in constant time (`api/server.js:148-161`). The key is 32
  random bytes generated on first run and written to `./data/secret` with mode `0600`
  (`api/server.js:34-36`). The cookie is `HttpOnly` and `SameSite=Lax`, and gets `Secure` **only
  when `ORIGIN` starts with `https:`** (`api/server.js:29`, `api/server.js:198-201`).
- **Any user can end every session they have.** `POST /api/logout/all` increments that account's
  session version, and every authenticated request checks the version in the cookie against the
  one on the user record (`api/server.js:167`, `api/server.js:187-188`), so every cookie ever
  issued for the account — on every device, including a copy someone walked off with — stops
  verifying at once. Passkeys are untouched; signing back in works immediately.
- **Data is isolated per user by the session's uid.** `GET`/`PUT /api/data` only ever touch
  `state-<uid>.json` for the caller (`api/server.js:375-392`); no route lets a normal user name
  another user.
- **Disabling an account takes effect immediately.** Every authenticated request and every login
  is rejected for a disabled user (`api/server.js:184`, `api/server.js:357`).

### What it does not do

- **Health data is encrypted at rest; the rest of `./data` is not.** Each `state-<uid>.json` — a
  member's complete workout history, body-weight log and body-composition measurements (body
  fat %, muscle mass, visceral fat, water %, bone mass) — is AES-256-GCM encrypted on every write
  (`api/lib/state-store.js:36`, `api/lib/crypto.js:22`), transparently: the app reads and writes
  it as a normal object, only the bytes on disk change. `db.json` (users, passkey public keys,
  push subscriptions, invite codes), `social.json`, `chat.json`, `friends.json`, `coach/*.json`,
  `secret` and `vapid.json` are still plain JSON. **This is not protection against someone who
  can read the whole `./data` folder.** The encryption key is derived from `./data/secret`
  (`api/lib/crypto.js:14-21`) — the same file that signs session cookies and lives right next to
  the files it protects — so a full copy of `./data` (a host compromise, a backup of the whole
  directory) carries its own key with it and decrypts exactly as before. What it does stop: a
  *partial* leak — one `state-*.json` file exposed on its own (a misconfigured sync target, a
  bug, a single file that ends up somewhere it shouldn't) is unreadable without `secret`
  alongside it. **If you host 2J Fitness Center for other people, they are trusting you exactly as
  much as they'd trust any server operator** — this narrows one specific way their data could leak,
  it does not remove the trust.
  An existing instance upgrading to this version should run the one-time migration
  (`docker compose exec api node scripts/encrypt-existing-state.mjs`) right after updating, so no
  profile sits unconverted until its owner's next write; back up `./data` first, the same as
  before any change that rewrites every user's file. New writes encrypt automatically either way.
- **A bioimpedance scan photo leaves the server, briefly.** "Scan a report" (Measurements, and
  the admin panel's own bioimpedance entry) sends the photo to Google's Gemini API over HTTPS to
  read the printed values off it (`api/lib/measurements-scan.js`, `api/coach/adapters/gemini.js`)
  — that's the one place a health-adjacent file this app touches goes to a third party. The image
  is never written to disk on this server: it's held in memory for that one request and discarded
  once Gemini answers. Opt-in per scan, and only reachable at all if the instance's Coach is
  configured with a Gemini key in the first place.
- **Admins can read everything.** A user listed in `ADMIN_UIDS` (or flagged `admin: true` in
  `db.json`) gets every user's full history and body weight, can disable accounts, and can create
  or revoke invite codes (`api/server.js:460-540`). Off by default — a fresh instance has no admin.
- **Sessions can't be revoked one device at a time.** Revocation is per *account*, not per
  session: `POST /api/logout/all` kills all of them at once and there is no device list to pick
  from. `POST /api/logout` on its own only clears the cookie in that one browser
  (`api/server.js:361`) — a copy taken beforehand keeps working. Sessions last **90 days** by
  default, settable with `SESSION_DAYS` (`api/server.js:26`); each cookie carries the lifetime it
  was issued with, so changing the setting doesn't reach cookies that are already out. Deleting
  `./data/secret` and restarting still works as the instance-wide reset, and disabling an account
  still locks out one user completely.
- **CSRF protection is `SameSite=Lax` and nothing else.** There are no CSRF tokens.
- **User verification is preferred, not required.** Both handshakes pass
  `requireUserVerification: false` (`api/server.js:297`, `api/server.js:343`), so a passkey
  released without a biometric or PIN is still accepted. In practice: unlocked device ≈ account
  access.
- **One passkey per profile — recovery is admin-assisted, not self-service.** Every successful
  registration still creates a *new* profile; there is no email or automated reset path. A member
  who loses their only device can raise an unauthenticated "I lost my passkey" flag from the
  login screen (`POST /api/recover/request`, `api/server.js:608`), which just queues a request —
  it hands out nothing. Only an admin can turn that into access, by generating a link
  (`POST /api/admin/user/recovery-link`, `api/server.js:1114`) meant to be handed over in person:
  a 64-bit single-use token, dead in 15 minutes, and generating a new one for the same member
  retires any older one still unused. It lets them register a fresh passkey onto their *existing*
  profile (history intact) rather than starting a new one. There is still no instance without an
  admin able to recover a lost passkey on their own.
- **Disabling someone isn't a ban.** They can still register a fresh profile with a new passkey
  unless `INVITE_ONLY=1` is set.
- **HTTPS is required and the app doesn't provide it.** The API container speaks plain HTTP and
  nginx listens on `:80` (`web/nginx.conf`); TLS is your reverse proxy's job. Without it,
  browsers won't do passkeys at all (except on `http://localhost`) and the session cookie is sent
  in the clear.
- **No rate limiting anywhere.** Nothing throttles logins, registrations or writes, and
  `POST /api/register/options` still answers whether an invite code is valid
  (`api/server.js:272`), so an invite-only instance on the open internet should have a rate limit
  in front of it. New invite codes are 16 hex characters — 64 bits (`api/server.js:525`) — which
  makes guessing one impractical even unthrottled; codes generated by earlier versions are 8
  characters / 32 bits and still work, so revoke and reissue any that are still unused. The only
  hard limit
  in the app is a 5 MB request body (`api/server.js:27`).
- **A few endpoints answer without a session:** `/api/health` (which includes the total user
  count), `/api/config` (whether invite-only is on), `/api/push/public-key`, and the
  register/login handshakes.
- **Changing `RP_ID` invalidates every existing passkey.** They were bound to the old hostname
  and will fail verification against the new one. The data stays on disk but is unreachable until
  each user registers again — as a *new* profile. Choose your hostname before anyone registers.
- **Guest mode never reaches the backend.** That data lives unencrypted in the browser's
  `localStorage` and is gone when the browser storage is cleared.
