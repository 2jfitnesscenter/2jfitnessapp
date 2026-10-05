# Android release (sideload) — signed APK for the gym app

The gym app on Android is the Capacitor shell in **remote mode** (it loads `https://app.2jfitnesscenter.com`; passkeys, Sync V2 and the
Health Connect plugin `TwoJHealth` work inside it). It is distributed as a signed APK, not through Play Store.

Status (Sprint 3): the release build, Gradle signing hook, Digital Asset Links helper and WebAuthn origin hook are ready and tested.
**Not done, needs the owner:** creating the release keystore (below). Until then only the debug-signed APK validated on the Galaxy S25 Ultra exists.

## What the owner must do once (nothing here is stored in the repo)

1. Create the release keystore **on your own machine** and back it up somewhere safe (lose it and nobody can update the app without uninstalling):

   ```
   keytool -genkeypair -v -keystore 2jfitness-release.jks -alias 2jfitness -keyalg RSA -keysize 4096 -validity 10950
   ```

2. Create `frontend/android/keystore.properties` (git-ignored; alternatively export `2J_KEYSTORE_FILE`, `2J_KEYSTORE_PASSWORD`, `2J_KEY_ALIAS`, `2J_KEY_PASSWORD`):

   ```
   storeFile=C:/path/to/2jfitness-release.jks
   storePassword=...
   keyAlias=2jfitness
   keyPassword=...
   ```

3. Read the certificate fingerprint (public) and send it, or run the next step yourself:

   ```
   keytool -list -v -keystore 2jfitness-release.jks -alias 2jfitness     # copy the "SHA256:" line
   ```

## Build, sign, verify

Release fingerprint `5E:D9:E5:F3:…:DE:D1` (alias `2jfitness`) is already trusted by `assetlinks.json` and `api/lib/webauthn-origins.js` (hash `Xtnl80w2A-0scA3f4Jtf5D5UvAZ0dgJ7RTpZsbqv3tE`), next to the debug one. They take effect for passkeys when the API/web are deployed.

**Option A — helper (passwords typed at a prompt, never written anywhere):**
```
.\scripts\android-release-build.ps1 -Keystore C:\path\to\2jfitness-release.jks
```
**Option B — file.** Create `frontend/android/keystore.properties` (git-ignored) with exactly the keys Gradle reads (`app/build.gradle`):
```
storeFile=C:/path/to/2jfitness-release.jks
storePassword=<keystore password>
keyAlias=2jfitness
keyPassword=<key password (same as storePassword if you set one password)>
```
then `cd frontend\android` and `.\gradlew.bat assembleRelease`. (Equivalent environment variables: `2J_KEYSTORE_FILE`, `2J_KEYSTORE_PASSWORD`, `2J_KEY_ALIAS`, `2J_KEY_PASSWORD`.)

The remote-shell config (`frontend/capacitor.remote.config.json`) must be the one in `app/src/main/assets/capacitor.config.json` (git-ignored, generated; the helper copies it). The web bundle is NOT needed in this mode: the APK loads https://app.2jfitnesscenter.com.

Output: `frontend/android/app/build/outputs/apk/release/app-release.apk` (an `app-release-unsigned.apk` means no keystore was configured).

**Verify (no secrets involved):**
```
node scripts/android-release-verify.mjs frontend/android/app/build/outputs/apk/release/app-release.apk
```
It runs `apksigner verify`, prints the APK SHA-256 and the signer certificate SHA-256, and PASSes only if that certificate is valid, is **not** the debug one, is listed in `assetlinks.json`, its hash is allowed for WebAuthn, and the APK is zip-aligned.
Bump `versionCode`/`versionName` in `app/build.gradle` for every release (`versionCode` must increase or Android refuses the update).

## Passkeys in the signed app (do this BEFORE handing the APK out)

Credential Manager only accepts passkeys if the server trusts the signing certificate in two places. The helper derives both from the public fingerprint:

```
node scripts/android-release-hashes.mjs <SHA256 colon-hex> --apply
```

It adds the fingerprint to `frontend/public/.well-known/assetlinks.json` (Digital Asset Links; the debug one stays) and the `android:apk-key-hash:` value to
`api/lib/webauthn-origins.js` (exact values only, no wildcard). Then **deploy** (assetlinks is static; the API reads the origin list at boot). Without the API
hash the server rejects release-signed passkey ceremonies; without assetlinks Android will not offer the credential.

## Install (sideload)

- From a computer: `adb install -r app-release.apk`.
- From the phone: host the APK on a page you control, open it in the browser, allow "install unknown apps" for that browser once, install. Updates install over
  the old version only when signed with the same keystore and a higher `versionCode`.
- Android 13 and older also need the Health Connect app from Play; on Android 14+ it is part of the system.

## Health Connect checklist (what the app does and does not do)

- Read: exercise sessions (required), active calories, heart rate, steps (optional, each can be denied). Write: the workout session (after "send 2J workouts to Health")
  and, only when no external energy exists after a grace period, one labelled `2j:<id>:kcal-est` estimate that is deleted if an external source later appears.
- Idempotent writes: record id `2j:<id>`; re-reading drops 2J's own records. 2J never edits or deletes records it did not create.
- Revoking a permission in Health Connect makes the next read return `permission_denied`; the UI then shows the connect state again and keeps no health cache.
- Energy reconciliation (`lib/energy-reconcile.js`): measured wearable > aggregated Health > 2J estimate; never summed.
- Auto-Backup is **off** (`allowBackup=false`): the WebView storage of the shell (session, Sync V2 journal, health aggregates) is never copied to Google Drive backups.
- Validated on a Galaxy S25 Ultra with the debug build. **To validate on the release build once the keystore exists:** passkey login, a Health Connect read,
  a workout write and permission revocation (10 minutes on the phone). Nothing in the code differs between debug and release except the signature.

## Checklist — Galaxy S25 Ultra, release build (≈15 min)
Pre: keystore created, fingerprint applied (`--apply`), server deployed with the new `assetlinks.json` and origin list, APK built with `assembleRelease` and verified with `apksigner verify --print-certs` (SHA-256 must equal the one you gave).
1. Uninstall the debug build first (different signature; Android will not update over it). `adb install app-release.apk`.
2. Open the app → it loads `https://app.2jfitnesscenter.com` (no certificate or CSP errors).
3. Passkey: sign out, sign in with the existing passkey (Credential Manager sheet shows 2J). Then create nothing new — only verify login. If it fails: the fingerprint in assetlinks or the origin hash is wrong.
4. Data: Sync V2 pill shows synced; open a workout from history.
5. Health Connect: Settings → Health → Connect → grant read (workouts, calories, heart rate, steps). Last workout shows its external data.
6. Write: finish a short workout with "send 2J workouts to Health" on → it appears once in Health Connect; finish/edit again → no duplicate. Energy: with a wearable feeding Health Connect, 2J writes no calories; without one, one labelled estimate only after the grace period.
7. Revocation: Health Connect → 2J → revoke → back in 2J the connect state returns, no stale data, no crash.
8. Backup/privacy: Settings → Apps → 2J → storage; "Auto-backup" is off (`allowBackup=false`); Settings → Export my data works inside the shell.
9. Kill the app, reopen offline (airplane mode): shell loads cached app, a workout can be logged and syncs when back online.
10. Record the APK SHA-256 and `versionCode` in `AI_HANDOFF.md`.

## Health onboarding (first sign-in) — checks on the phone
The Android app shows ONE invitation ("Conecta tu salud con 2J") after the first successful sign-in, once the app is stable (not mid-workout, profile wizards done). The flag is device-local (`health_onboarding_v1:<uid>`), never synced.
1. Clean install (or clear app data), sign in → the sheet appears after ~2 s. Tap **Ahora no** → restart the app: it does not return.
2. Clear app data again → **Activar datos de salud** → the Health Connect permission sheet opens (workouts, calories, heart rate, steps only).
3. Grant → it never returns, Settings → Health & activity shows connected. Refuse or cancel on another clean install → it never returns either.
4. Revoke the permissions in Health Connect afterwards → Settings → Health & activity offers reconnect; the onboarding does NOT reappear.
5. Grant access in Health Connect BEFORE the first sign-in (clean app data) → the invitation still appears (2J has no consent of its own yet); **Activar datos de salud** turns 2J on directly, without reopening Health Connect. If 2J is already connected on that account, no popup at all.
6. Phone without Health Connect / outdated → the sheet says so and its button opens Health Connect in the Play Store.
