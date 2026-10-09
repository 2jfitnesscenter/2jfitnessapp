# Mi 2J V2 — catalogue and account / devices / access

Two independent lanes in one release. Nothing here replaces an existing system: it completes the catalogue (Train2J, guided routines and programs,
collections) and the account side (passkeys, sessions, recovery) with the smallest additions that make them whole.

## A. Catalogue

| What | How |
|---|---|
| Save an official routine | `saveOfficialRoutine` (lib/train2j.js): the same snapshot a session starts from or a trainer assigns, plus `from2j: { id, v, rev, at }`. Independent in both directions; the same routine is never saved twice. |
| Save an official program | `saveGuidedProgram` (lib/guided-programs.js): the pinned copy a start builds, status `assigned` (what a trainer's assignment already uses), so the program screen offers "Start program". Start and save share one builder. |
| Favourite routines | `S.favRoutines` in the synced state, like `S.favEx`. The old per-device list is folded in once (`migrateLegacyFavorites`): union without duplicates, and the old key is removed only after the state is confirmed with the server. |
| Goals | A **goal filter** over the `goal` field every routine already carries. Two goal collections built from existing sessions: *Fat loss* (conditioning formats, 15–30 min) and *Health and movement* (low-impact, beginner). There is **no OCR collection**: the catalogue has no obstacle-course content (carries, crawls, grip work), and none was invented. |
| "For you" | Still deterministic and explainable. Two more signals from the member's own state: the favourites (a favourite is offered back; similar formats say "Like your favorites") and the active gym (a routine that needs other equipment is never offered; a home/hotel/custom place is named). |
| Official history | `lib/guided-history.js`: before an admin changes an official routine, program or collection, the version it had is kept (ten per item, only real content changes — never featured/order/badge). Admins list it and restore through the normal validated save. |
| Train2J first screen | On a phone: search and filters, then "For you", then the featured workout (shorter). Wider screens keep the hero on top. |

## B. Account, devices and access

**Recovery.** Completing a recovery link ends every earlier session (the session version moves on) and, by default, removes every earlier passkey of the
account; the new passkey is added first and never removed, so an account is never left without a way in. An admin can keep the old passkeys
(`keepExisting`) for a member who only needs one more. A link made before the flag existed is treated as the safe default.

**Passkeys.** Each credential now carries a name, a creation time and a last-use time. Credentials from before that keep working and are listed as
"Earlier". A signed-in person lists, adds (up to ten), renames and removes their own passkeys. Adding and removing need a **step-up**: a fresh passkey
assertion with user verification, which earns a signed five-minute token for one purpose (`passkeys` or `device-link`), bound to the person. The last
passkey can never be removed. Removing one also ends the sessions it created. Everything is scoped to the signed-in account; another account's passkey
answers 404. Shared-computer PIN sessions never manage passkeys.

**Sessions / devices.** Every passkey sign-in (and recovery, and approved QR link) gets a session record — coarse platform and browser ("Android · Chrome"),
created, last used, how it started — and a cookie that names it. One session can be ended on its own; "sign out everywhere" still ends all. No IP and no raw
user-agent are kept. A cookie from before this has no record: it keeps working and is reported as "unlisted" (it ends with "sign out everywhere" or at expiry).
A person keeps at most 25 live sessions; the least recently used is ended first.

**QR linking.** Device A (signed out) asks for a link and shows a QR that holds only a public id, plus a four-digit code. Device B (signed in with a
passkey) opens it, types the code and approves after a step-up. A claims with a 256-bit secret only it holds and receives an ordinary session once. Links
live in memory only, for three minutes; approved once, claimed once (a replay is refused); three wrong codes end the link. Residual risk, stated plainly: as with
every QR login, a person can be talked into approving a link an attacker started. The approval screen names the requesting platform, asks for the code
shown on that device and for a passkey, and says to approve only what is in front of you.

**Security log.** `db.securityEvents` (3,000, bounded): sign-ins, failed sign-ins for a known account, recovery requested / link created / completed,
passkey added / renamed / removed, role changes, disable/enable, sign-out everywhere, session ended, device linked, step-up. An event holds the code, who it
happened to, who did it when somebody else did, a time and a few allow-listed scalar facts. Never a credential, token, key, PIN, IP, user-agent or name.
A member reads their own (without the actor's identity); admins read all.

### `requireUserVerification` — audit and decision

| Ceremony | userVerification asked | Enforced |
|---|---|---|
| Registration, sign-in | `preferred` | no |
| Step-up, shared-staff passkey actions, account erasure | `required` | yes |

Platform authenticators on iOS (Face ID / Touch ID / passcode), Android (screen lock / biometrics) and Windows Hello ask for the person whenever the
ceremony allows it, so `preferred` almost always yields user verification. The exceptions are exactly the ones enforcement would lock out: passkeys held
by some password managers, and security keys without a PIN, can report no verification. **Decision: sign-in is not hardened.** The sensitive actions already
require it. Instead, the flag each sign-in reports is now recorded (`login_ok` with `uv`) and shown in the member's activity ("without device verification"),
which is the evidence needed to decide later: enforce only when real sign-ins show it would not turn legitimate people away.

## Not touched
Shared Staff (PIN, device authorization, step-up), Sync V2, Bunker, Coach, Training Quality, Library, Health.
